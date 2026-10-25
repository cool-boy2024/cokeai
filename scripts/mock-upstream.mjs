import http from "node:http";

const port = Number(process.env.MOCK_UPSTREAM_PORT || 4010);
const expectedKey = process.env.MOCK_UPSTREAM_KEY || "mock-upstream-key";

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/v1/health")) {
    json(res, 200, { status: "ok" });
    return;
  }

  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    json(res, 404, { error: { message: "not found" } });
    return;
  }

  if (req.headers.authorization !== `Bearer ${expectedKey}`) {
    json(res, 401, { error: { message: "invalid upstream key" } });
    return;
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      json(res, 400, { error: { message: "invalid json" } });
      return;
    }

    const id = `chatcmpl-mock-${Date.now()}`;
    if (body.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          model: body.model,
          choices: [{ index: 0, delta: { role: "assistant", content: "Hello" } }],
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          model: body.model,
          choices: [{ index: 0, delta: { content: " from CokeAI mock." } }],
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          model: body.model,
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    json(res, 200, {
      id,
      object: "chat.completion",
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello from CokeAI mock." },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock upstream listening on http://127.0.0.1:${port}/v1`);
});
