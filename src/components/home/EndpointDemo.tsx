"use client";

import { useState } from "react";

type Tab = "curl" | "python" | "node";

const DEFAULT_BASE = "https://cokeai.cc.cd/v1";

function cleanBase(value: string) {
  const trimmed = value.trim();
  const withoutSlash = trimmed.replace(/\/+$/, "");
  return withoutSlash || DEFAULT_BASE;
}

function samples(base: string, modelId: string): Record<Tab, string> {
  return {
    curl: `curl ${base}/chat/completions \\
  -H "Authorization: Bearer $COKEAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelId}",
    "messages": [{ "role": "user", "content": "你好" }]
  }'`,
    python: `import os
from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key=os.environ["COKEAI_API_KEY"],
)

reply = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "你好"}],
)
print(reply.choices[0].message.content)`,
    node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}",
  apiKey: process.env.COKEAI_API_KEY,
});

const reply = await client.chat.completions.create({
  model: "${modelId}",
  messages: [{ role: "user", content: "你好" }],
});
console.log(reply.choices[0].message.content);`,
  };
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "curl", label: "curl" },
  { id: "python", label: "Python" },
  { id: "node", label: "Node" },
];

export function EndpointDemo({ modelId }: { modelId: string }) {
  const [base, setBase] = useState(DEFAULT_BASE);
  const [tab, setTab] = useState<Tab>("curl");
  const code = samples(cleanBase(base), modelId)[tab];

  return (
    <div className="endpoint">
      <h2>接入地址</h2>
      <label className="endpoint-line">
        <span className="sr-only">API Base URL</span>
        <input
          value={base}
          onChange={(event) => setBase(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="API Base URL"
        />
      </label>
      <div className="endpoint-body">
        <p className="endpoint-hint">
          换成你自己的域名也可以，路径保持 /v1。下面的请求会跟着地址一起变。
        </p>

        <div className="endpoint-sample">
          <div className="endpoint-tabs" role="tablist" aria-label="示例语言">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "is-on" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <pre className="endpoint-code">
            <code>{code}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
