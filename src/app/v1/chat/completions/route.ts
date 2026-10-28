import { randomUUID } from "node:crypto";
import { authenticateApiKey } from "@/lib/auth";
import { config } from "@/lib/config";
import {
  estimateOutputTokens,
  reserveUsage,
  settleUsage,
  tokensFromUsage,
} from "@/lib/gateway";
import { calculateUsageCost, estimatePromptTokens } from "@/lib/money";
import {
  acquireConcurrencySlot,
  fixedWindowLimit,
  releaseConcurrencySlot,
} from "@/lib/rate-limit";
import {
  getGatewayModel,
  requestedMaxOutputTokens,
  sanitizeChatRequest,
  upstreamErrorMessage,
  upstreamFetch,
  type ChatRequestBody,
} from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function apiError(
  message: string,
  status: number,
  code = "invalid_request",
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { message, type: "cokeai_error", code } },
    { status, headers: { ...CORS_HEADERS, ...headers, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth.user) {
    return apiError(auth.error || "鉴权失败", auth.status || 401, "unauthorized");
  }
  const user = auth.user;

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 10 * 1024 * 1024) {
    return apiError("请求体超过 10MB 限制。", 413, "request_too_large");
  }

  let body: ChatRequestBody;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 10 * 1024 * 1024) {
      return apiError("请求体超过 10MB 限制。", 413, "request_too_large");
    }
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return apiError("请求体必须是 JSON 对象。", 400, "invalid_json");
    }
    body = parsed as ChatRequestBody;
  } catch {
    return apiError("无法解析 JSON 请求体。", 400, "invalid_json");
  }

  const modelId = typeof body.model === "string" ? body.model : "";
  if (!modelId) return apiError("缺少 model 参数。", 400, "missing_model");

  const gatewayModel = await getGatewayModel(modelId);
  if (!gatewayModel || !gatewayModel.enabled) {
    return apiError(`模型 ${modelId} 未开放。`, 404, "model_not_found");
  }
  if (!gatewayModel.upstream_enabled || !gatewayModel.api_key_encrypted) {
    return apiError("该模型的上游服务尚未配置完成。", 503, "upstream_not_configured");
  }

  let upstreamBody: ChatRequestBody;
  try {
    upstreamBody = sanitizeChatRequest(
      body,
      gatewayModel.upstream_model,
      config.hardMaxOutputTokens,
    );
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "请求参数无效。",
      400,
      "invalid_parameters",
    );
  }

  const maxOutputTokens = requestedMaxOutputTokens(upstreamBody);
  const estimatedPromptTokens = estimatePromptTokens({
    messages: body.messages,
    tools: body.tools,
  });
  if (estimatedPromptTokens + maxOutputTokens > gatewayModel.context_window) {
    return apiError(
      `输入与最大输出超过了 ${gatewayModel.context_window.toLocaleString()} token 的上下文窗口。`,
      400,
      "context_length_exceeded",
    );
  }

  const rpm = await fixedWindowLimit(
    `rl:api:${user.apiKeyId}:${Math.floor(Date.now() / 60_000)}`,
    config.apiRequestsPerMinute,
    65,
  );
  if (!rpm.allowed) {
    return apiError("请求过于频繁，请稍后重试。", 429, "rate_limit_exceeded", {
      "Retry-After": String(rpm.resetSeconds),
      "X-RateLimit-Limit": String(config.apiRequestsPerMinute),
      "X-RateLimit-Remaining": "0",
    });
  }

  const slot = await acquireConcurrencySlot(user.userId, config.apiConcurrency);
  if (!slot.acquired) {
    return apiError("并发请求数已达上限，请等待当前请求完成。", 429, "concurrency_limit");
  }

  let handedOffToStream = false;
  let usageId: string | null = null;
  let reservedMicros = 0;

  try {
    const quote = calculateUsageCost(estimatedPromptTokens, maxOutputTokens, gatewayModel);
    reservedMicros = Math.max(1_000, Math.ceil(quote.chargedMicros * 1.1));
    const reservation = await reserveUsage({
      userId: user.userId,
      apiKeyId: user.apiKeyId,
      modelId: gatewayModel.id,
      estimatedPromptTokens,
      maxOutputTokens,
      model: gatewayModel,
      reserveMicros: reservedMicros,
    });

    if (!reservation) {
      return apiError("余额不足，请充值。", 402, "insufficient_balance");
    }
    usageId = reservation.usageId;
    reservedMicros = reservation.reservedMicros;
    const requestId = randomUUID();

    let upstream: Response;
    try {
      upstream = await upstreamFetch(gatewayModel, upstreamBody, request.signal);
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      await settleUsage({
        usageId,
        model: gatewayModel,
        reservedMicros,
        inputTokens: 0,
        outputTokens: 0,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        errorCode: timeout ? "upstream_timeout" : "upstream_unreachable",
      });
      usageId = null;
      return apiError(
        timeout ? "上游响应超时。" : "无法连接上游服务。",
        timeout ? 504 : 502,
        timeout ? "upstream_timeout" : "upstream_unreachable",
      );
    }

    if (!upstream.ok) {
      const raw = (await upstream.text()).slice(0, 8_192);
      await settleUsage({
        usageId,
        model: gatewayModel,
        reservedMicros,
        inputTokens: 0,
        outputTokens: 0,
        status: "failed",
        latencyMs: Date.now() - startedAt,
        errorCode: `upstream_${upstream.status}`,
      });
      usageId = null;
      const status = upstream.status === 429 ? 429 : upstream.status === 400 ? 400 : 502;
      return apiError(
        upstreamErrorMessage(upstream.status, raw),
        status,
        `upstream_${upstream.status}`,
      );
    }

    const isStream =
      upstreamBody.stream === true &&
      (upstream.headers.get("content-type") || "").includes("text/event-stream");

    if (!isStream) {
      const raw = await upstream.text();
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        await settleUsage({
          usageId,
          model: gatewayModel,
          reservedMicros,
          inputTokens: 0,
          outputTokens: 0,
          status: "failed",
          latencyMs: Date.now() - startedAt,
          errorCode: "invalid_upstream_response",
        });
        usageId = null;
        return apiError("上游返回了无法解析的响应。", 502, "invalid_upstream_response");
      }

      const tokens =
        tokensFromUsage(payload) ||
        {
          inputTokens: estimatedPromptTokens,
          outputTokens: estimateOutputTokens(JSON.stringify(payload)),
        };

      await settleUsage({
        usageId,
        model: gatewayModel,
        reservedMicros,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
      });
      usageId = null;

      return Response.json(payload, {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          "X-RateLimit-Limit": String(config.apiRequestsPerMinute),
          "X-RateLimit-Remaining": String(rpm.remaining),
        },
      });
    }

    handedOffToStream = true;
    const upstreamReader = upstream.body?.getReader();
    if (!upstreamReader) {
      await settleUsage({
        usageId,
        model: gatewayModel,
        reservedMicros,
        inputTokens: 0,
        outputTokens: 0,
        status: "failed",
        errorCode: "empty_stream",
      });
      usageId = null;
      handedOffToStream = false;
      return apiError("上游未返回数据流。", 502, "empty_stream");
    }

    let streamSettled = false;
    let lineBuffer = "";
    let outputText = "";
    let reportedTokens: { inputTokens: number; outputTokens: number } | null = null;
    const decoder = new TextDecoder();

    const finalize = async (
      status: "succeeded" | "failed",
      errorCode?: string,
    ): Promise<void> => {
      if (streamSettled || !usageId) return;
      streamSettled = true;
      const tokens = reportedTokens || {
        inputTokens: estimatedPromptTokens,
        outputTokens: estimateOutputTokens(outputText),
      };
      try {
        await settleUsage({
          usageId,
          model: gatewayModel,
          reservedMicros,
          inputTokens: status === "failed" && !outputText ? 0 : tokens.inputTokens,
          outputTokens: status === "failed" && !outputText ? 0 : tokens.outputTokens,
          status,
          latencyMs: Date.now() - startedAt,
          errorCode,
        });
        usageId = null;
      } catch (error) {
        console.error("[gateway] settle failed", error);
      }
      await releaseConcurrencySlot(slot.key);
    };

    const parseLine = (line: string): void => {
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const payload = JSON.parse(data) as {
          usage?: unknown;
          choices?: Array<{
            delta?: { content?: unknown; reasoning_content?: unknown };
          }>;
        };
        const tokens = tokensFromUsage(payload);
        if (tokens) reportedTokens = tokens;
        for (const choice of payload.choices || []) {
          const content = choice.delta?.content;
          const reasoning = choice.delta?.reasoning_content;
          if (typeof content === "string") outputText += content;
          if (typeof reasoning === "string") outputText += reasoning;
          if (Array.isArray(content)) outputText += JSON.stringify(content);
        }
      } catch {
        // Ignore non-JSON comment/heartbeat events.
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await upstreamReader.read();
          if (done) {
            if (lineBuffer) parseLine(lineBuffer);
            await finalize(outputText ? "succeeded" : "failed", outputText ? undefined : "empty_stream");
            controller.close();
            return;
          }
          controller.enqueue(value);
          lineBuffer += decoder.decode(value, { stream: true });
          let newline = lineBuffer.indexOf("\n");
          while (newline >= 0) {
            const line = lineBuffer.slice(0, newline);
            lineBuffer = lineBuffer.slice(newline + 1);
            parseLine(line);
            newline = lineBuffer.indexOf("\n");
          }
        } catch (error) {
          await finalize(
            outputText ? "succeeded" : "failed",
            error instanceof Error ? error.name : "stream_error",
          );
          controller.error(error);
        }
      },
      async cancel() {
        try {
          await upstreamReader.cancel();
        } catch {
          // Upstream may already be closed.
        }
        await finalize(outputText ? "succeeded" : "failed", "client_closed");
      },
    });

    return new Response(stream, {
     headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Request-Id": requestId,
        "X-RateLimit-Limit": String(config.apiRequestsPerMinute),
        "X-RateLimit-Remaining": String(rpm.remaining),
      },
    });
  } catch (error) {
    console.error("[gateway]", error);
    if (usageId) {
      try {
        await settleUsage({
          usageId,
          model: gatewayModel,
          reservedMicros,
          inputTokens: 0,
          outputTokens: 0,
          status: "failed",
          latencyMs: Date.now() - startedAt,
          errorCode: "internal_error",
        });
      } catch (settleError) {
        console.error("[gateway] failure refund failed", settleError);
      }
    }
    return apiError("平台内部错误，请稍后重试。", 500, "internal_error");
  } finally {
    if (!handedOffToStream) {
      await releaseConcurrencySlot(slot.key);
    }
  }
}
