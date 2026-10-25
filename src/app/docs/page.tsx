import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CopyButton } from "@/components/CopyButton";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API 文档",
  description:
    "CokeAI OpenAI 兼容 API 文档：鉴权、聊天补全、流式输出、用量计费与错误码。",
};

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

export default function DocsPage() {
  const baseUrl = `${config.appUrl}/v1`;

  return (
    <>
      <SiteHeader />
      <main className="container doc-layout">
        <aside className="doc-nav">
          <div className="sidebar-label">Documentation</div>
          <a href="#quickstart">快速开始</a>
          <a href="#auth">鉴权</a>
          <a href="#models">模型列表</a>
          <a href="#chat">聊天补全</a>
          <a href="#streaming">流式输出</a>
          <a href="#billing">计费与预算</a>
          <a href="#limits">限制</a>
          <a href="#errors">错误码</a>
          <a href="#privacy">数据与隐私</a>
        </aside>

        <article className="doc-content">
          <h1>API 文档</h1>
          <p>
            CokeAI 提供兼容 OpenAI Chat Completions 的 API。你可以继续使用 OpenAI
            官方 SDK、兼容客户端或任意 HTTP 工具，只需替换 Base URL 和 API Key。
          </p>
          <div className="doc-callout">
            仅支持通过 API Key 鉴权。平台不提供账号密码共享，也不支持使用个人会员订阅凭据。
          </div>

          <h2 id="quickstart">快速开始</h2>
          <p>
            Base URL：<code className="inline-code">{baseUrl}</code>
            <br />
            鉴权方式：<code className="inline-code">Authorization: Bearer sk-coke-...</code>
          </p>
          <p>
            先登录控制台创建 API Key，并确认账户已购买有效套餐。API Key 只在创建时显示一次。
          </p>
          <CodeBlock
            title="curl · 非流式"
            code={`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $COKEAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "用三句话解释什么是向量数据库。"}
    ]
  }'`}
          />

          <h3>Python（OpenAI SDK）</h3>
          <CodeBlock
            title="python"
            code={`from openai import OpenAI

client = OpenAI(
    api_key="sk-coke-your-key",
    base_url="${baseUrl}",
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "user", "content": "Hello, CokeAI"}
    ],
)

print(response.choices[0].message.content)`}
          />

          <h3>Node.js（OpenAI SDK）</h3>
          <CodeBlock
            title="typescript"
            code={`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.COKEAI_API_KEY,
  baseURL: "${baseUrl}",
});

const result = await client.chat.completions.create({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(result.choices[0]?.message?.content);`}
          />

          <h2 id="auth">鉴权</h2>
          <p>
            每个请求都需要在 HTTP Header 中携带 API Key。Key 形如{" "}
            <code className="inline-code">sk-coke-...</code>，绑定单个用户，可随时在控制台撤销。
          </p>
          <p>
            不要把 Key 写进前端代码、公开仓库或移动应用安装包。浏览器直连场景建议通过你自己的
            后端代理，并设置域名白名单与速率限制。
          </p>
          <p>
            平台数据库仅保存 API Key 的 SHA-256 哈希；创建后无法再次查看明文，只能撤销并重新创建。
          </p>

          <h2 id="models">模型列表</h2>
          <p>
            <code className="inline-code">GET /v1/models</code> 返回当前套餐可用的模型，
            包括上下文窗口与人民币每百万 Token 零售价。该接口同样需要 API Key。
          </p>
          <CodeBlock
            title="GET /v1/models"
            code={`curl ${baseUrl}/models \\
  -H "Authorization: Bearer $COKEAI_API_KEY"`}
          />

          <h2 id="chat">聊天补全</h2>
          <p>
            <code className="inline-code">POST /v1/chat/completions</code>
          </p>
          <p>
            支持字段：<code className="inline-code">messages</code>、
            <code className="inline-code">temperature</code>、
            <code className="inline-code">top_p</code>、
            <code className="inline-code">max_tokens / max_completion_tokens</code>、
            <code className="inline-code">stop</code>、
            <code className="inline-code">tools</code>、
            <code className="inline-code">tool_choice</code>、
            <code className="inline-code">response_format</code>、
            <code className="inline-code">seed</code> 等常用参数。
            请求中的 <code className="inline-code">model</code> 必须使用控制台展示的模型 ID。
          </p>
          <p>
            当前不支持 <code className="inline-code">n &gt; 1</code> 的多候选生成。
            平台会强制流式请求附带 <code className="inline-code">stream_options.include_usage</code>，
            以保证按真实 Token 结算。
          </p>

          <h2 id="streaming">流式输出</h2>
          <p>
            设置 <code className="inline-code">&quot;stream&quot;: true</code> 后，服务端返回标准 SSE 流，
            最后一帧通常包含 <code className="inline-code">usage</code>。若客户端提前断开，
            平台会根据已产生的内容进行保守计量，避免只消耗上游而不计费。
          </p>
          <CodeBlock
            title="curl · stream"
            code={`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $COKEAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "stream": true,
    "messages": [{"role": "user", "content": "Count to five."}]
  }'`}
          />

          <h2 id="billing">计费与预算</h2>
          <p>
            计费单位为人民币（CNY）。每次请求进入网关时，平台会估算最大可能成本并从余额中预授权；
            上游返回后按实际 input/output Token 结算，差额自动退回。
          </p>
          <ul>
            <li>预授权金额不足时，请求不会发往上游，返回 402。</li>
            <li>同一用户存在并发上限，超出时返回 429。</li>
            <li>不支持负余额调用；余额为 0 或套餐到期后立即停止服务。</li>
            <li>上游服务异常导致的失败请求会释放预授权，不产生模型费用。</li>
            <li>平台记录 Token、费用、模型、延迟与 Request ID，不记录提示词正文。</li>
          </ul>
          <p>
            单价在请求发起时确定。你可以通过 <code className="inline-code">/v1/models</code>{" "}
            或控制台「用量账单」查看实时价格与消费明细。
          </p>

          <h2 id="limits">限制</h2>
          <ul>
            <li>单次请求体最大 10MB。</li>
            <li>默认每用户每分钟 60 次请求、并发 4 个请求，可在运营配置中调整。</li>
            <li>输出 Token 上限受模型、套餐与平台硬上限约束。</li>
            <li>上下文超限会在本地提前拒绝，避免无效上游调用。</li>
          </ul>

          <h2 id="errors">错误码</h2>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>HTTP</th>
                    <th>code</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">400</td>
                    <td className="mono">invalid_request</td>
                    <td>参数、JSON 或上下文窗口无效。</td>
                  </tr>
                  <tr>
                    <td className="mono">401</td>
                    <td className="mono">unauthorized</td>
                    <td>缺少或无效 API Key。</td>
                  </tr>
                  <tr>
                    <td className="mono">402</td>
                    <td className="mono">insufficient_balance</td>
                    <td>余额不足，需要购买或续费套餐。</td>
                  </tr>
                  <tr>
                    <td className="mono">403</td>
                    <td className="mono">plan_upgrade_required</td>
                    <td>当前套餐不包含该模型，或套餐已到期。</td>
                  </tr>
                  <tr>
                    <td className="mono">404</td>
                    <td className="mono">model_not_found</td>
                    <td>模型 ID 不存在或未开放。</td>
                  </tr>
                  <tr>
                    <td className="mono">429</td>
                    <td className="mono">rate_limit_exceeded</td>
                    <td>触发速率或并发限制，请遵循 Retry-After 重试。</td>
                  </tr>
                  <tr>
                    <td className="mono">502 / 504</td>
                    <td className="mono">upstream_*</td>
                    <td>上游不可用、超时或返回格式异常。</td>
                  </tr>
                  <tr>
                    <td className="mono">503</td>
                    <td className="mono">upstream_not_configured</td>
                    <td>该模型的上游尚未完成配置。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p>
            所有错误遵循 OpenAI 风格：
            <code className="inline-code">
              {`{ "error": { "message", "type", "code" } }`}
            </code>
          </p>

          <h2 id="privacy">数据与隐私</h2>
          <p>
            网关默认不持久化保存请求正文和模型输出。日志仅包含计量字段、状态、延迟和请求 ID，
            用于计费、故障排查和防滥用。上游 API 提供商会按其自身政策处理请求内容；
            请勿向任何第三方模型发送你无权处理的敏感数据。
          </p>
          <p>
            需要企业数据处理协议、脱敏日志或独立计费主体，请联系{" "}
            <a className="text-link" href={`mailto:${process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd"}`}>
              {process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd"}
            </a>
            。
          </p>

          <div className="notice mt-24">
            文档中的示例模型 ID 需要平台实际开放后才能调用。登录{" "}
            <Link className="text-link" href="/dashboard">
              控制台
            </Link>{" "}
            查看你的可用模型与余额。
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
