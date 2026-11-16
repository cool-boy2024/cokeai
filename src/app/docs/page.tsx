import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CopyButton } from "@/components/CopyButton";
import { config } from "@/lib/config";
import { listCatalogModels } from "@/lib/model-catalog";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";

export const metadata: Metadata = {
  title: "接入教程",
  description: "CokeAI 数字商品小店使用说明。",
};

export const dynamic = "force-dynamic";

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="code-card">
      <div className="code-card-head">
        <span>{title}</span>
        <CopyButton value={code} />
      </div>
      <pre>{code}</pre>
    </div>
  );
}

export default async function DocsPage() {
  if (!PUBLIC_API_SALES_ENABLED) redirect("/shop");

  const baseUrl = `${config.appUrl}/v1`;
  const models = await listCatalogModels();
  const sample = models[0]?.id || "gpt-4.1-mini";

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="container doc-layout public-main">
        <aside className="doc-nav">
          <div className="sidebar-label">教程</div>
          <a href="#quickstart">快速开始</a>
          <a href="#auth">鉴权</a>
          <a href="#models">模型</a>
          <a href="#chat">聊天补全</a>
          <a href="#streaming">流式输出</a>
          <a href="#errors">错误码</a>
        </aside>

        <article className="doc-content">
          <h1>接入教程</h1>
          <p>这里是小店的使用说明。</p>

          <h2 id="quickstart">快速开始</h2>
          <p>
            Base URL：<code className="inline-code">{baseUrl}</code>
            <br />
            鉴权：<code className="inline-code">Authorization: Bearer sk-coke-...</code>
          </p>
          <p>在控制台充值并创建 Key 后即可调用。Key 仅显示一次。</p>

          <CodeBlock
            title="curl"
            code={`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $COKEAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sample}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
          />

          <h3>Python</h3>
          <CodeBlock
            title="python"
            code={`from openai import OpenAI

client = OpenAI(
    api_key="sk-coke-your-key",
    base_url="${baseUrl}",
)

res = client.chat.completions.create(
    model="${sample}",
    messages=[{"role": "user", "content": "Hello"}],
)

print(res.choices[0].message.content)`}
          />

          <h3>Node.js</h3>
          <CodeBlock
            title="typescript"
            code={`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.COKEAI_API_KEY,
  baseURL: "${baseUrl}",
});

const res = await client.chat.completions.create({
  model: "${sample}",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(res.choices[0]?.message?.content);`}
          />

          <h2 id="auth">鉴权</h2>
          <p>
            每个请求携带 <code className="inline-code">Authorization: Bearer sk-coke-...</code>。
            可在控制台随时撤销 Key。
          </p>

          <h2 id="models">模型</h2>
          <p>
            <code className="inline-code">GET /v1/models</code> 返回当前可用模型。价格见{" "}
            <a className="text-link" href="/pricing">价格页</a>。
          </p>
          <CodeBlock
            title="GET /v1/models"
            code={`curl ${baseUrl}/models \\
  -H "Authorization: Bearer $COKEAI_API_KEY"`}
          />

          <h2 id="chat">聊天补全</h2>
          <p>
            <code className="inline-code">POST /v1/chat/completions</code>。支持常用参数：
            messages、temperature、top_p、max_tokens、stop、tools、tool_choice、
            response_format、seed。
          </p>

          <h2 id="streaming">流式输出</h2>
          <p>
            设置 <code className="inline-code">&quot;stream&quot;: true</code>，服务端返回 SSE。
          </p>
          <CodeBlock
            title="curl · stream"
            code={`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $COKEAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${sample}",
    "stream": true,
    "messages": [{"role": "user", "content": "Count to five."}]
  }'`}
          />

          <h2 id="errors">错误码</h2>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>HTTP</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">400</td>
                    <td>请求参数或 JSON 无效。</td>
                  </tr>
                  <tr>
                    <td className="mono">401</td>
                    <td>API Key 缺失或无效。</td>
                  </tr>
                  <tr>
                    <td className="mono">402</td>
                    <td>余额不足，请充值。</td>
                  </tr>
                  <tr>
                    <td className="mono">429</td>
                    <td>请求过于频繁。</td>
                  </tr>
                  <tr>
                    <td className="mono">502</td>
                    <td>上游暂时不可用，请稍后重试。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
