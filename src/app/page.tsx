import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  Code2,
  Gauge,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { config } from "@/lib/config";
import { query, toNumber } from "@/lib/db";
import { formatCny, retailCnyPerMillion } from "@/lib/money";

export const dynamic = "force-dynamic";

type LandingPlan = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  duration_days: number;
  features: unknown;
  highlight: boolean;
};

type LandingModel = {
  id: string;
  display_name: string;
  description: string;
  context_window: number;
  input_price_usd_micros_per_mtok: string;
  output_price_usd_micros_per_mtok: string;
  markup_bps: string;
  enabled: boolean;
  upstream_enabled: boolean;
  api_key_encrypted: string | null;
  upstream_name: string;
};

export default async function HomePage() {
  const [planResult, modelResult] = await Promise.all([
    query<LandingPlan>(
      `SELECT id, name, tagline, price_micros, credits_micros, duration_days, features, highlight
         FROM plans WHERE active = TRUE ORDER BY sort_order`,
    ),
    query<LandingModel>(
      `SELECT m.id, m.display_name, m.description, m.context_window,
              m.input_price_usd_micros_per_mtok, m.output_price_usd_micros_per_mtok,
              m.markup_bps, m.enabled, u.enabled AS upstream_enabled,
              u.api_key_encrypted, u.name AS upstream_name
         FROM models m JOIN upstreams u ON u.id = m.upstream_id
        ORDER BY m.sort_order, m.display_name`,
    ),
  ]);

  const baseUrl = `${config.appUrl}/v1`;
  const featuredPlan = planResult.rows.find((plan) => plan.highlight);
  const readyModels = modelResult.rows.filter(
    (model) => model.enabled && model.upstream_enabled && model.api_key_encrypted,
  ).length;

  return (
    <>
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                AI API infrastructure · Built for budgets
              </div>
              <h1>
                把 AI 接入业务，
                <br />
                <em>不再被账单偷袭。</em>
              </h1>
              <p className="hero-lead">
                一个兼容 OpenAI SDK 的 API，接入多家具备商业授权的模型。
                按 Token 透明计费，每次请求先预授权，额度见底前自动拦截。
              </p>
              <div className="hero-actions">
                <Link className="btn btn-primary" href="/register">
                  创建开发者账户 <ArrowRight size={16} />
                </Link>
                <Link className="btn btn-light" href="/docs">
                  查看 API 文档
                </Link>
              </div>
              <div className="hero-proof">
                <span className="proof-pill">
                  <Check size={13} /> OpenAI SDK 兼容
                </span>
                <span className="proof-pill">
                  <Check size={13} /> 人民币计费
                </span>
                <span className="proof-pill">
                  <Check size={13} /> 请求级硬预算
                </span>
                <span className="proof-pill">
                  <Check size={13} /> 不保存提示词
                </span>
              </div>
              <div className="hero-note">
                {readyModels > 0
                  ? `${readyModels} 个模型已就绪 · 上游服务由平台运营团队配置`
                  : "上游模型正在完成商业授权与接入验证"}
              </div>
            </div>

            <div className="hero-console" aria-hidden="true">
              <div className="console-bar">
                <span>cokeai / developer-console</span>
                <span className="console-dots">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
              <div className="console-body">
                <div className="console-label">Quickstart.py</div>
                <pre className="console-code">
<span className="c">from</span> openai <span className="c">import</span> OpenAI{"\n\n"}
client = OpenAI({"\n"}  api_key=<span className="g">&quot;sk-coke-••••&quot;</span>,{"\n"}  base_url=<span className="g">&quot;{baseUrl}&quot;</span>{"\n"}){"\n\n"}
res = client.chat.completions.create({"\n"}  model=<span className="g">&quot;deepseek-chat&quot;</span>,{"\n"}  messages=[{"{"}&quot;role&quot;: <span className="g">&quot;user&quot;</span>,{"\n"}    &quot;content&quot;: <span className="g">&quot;Ship it.&quot;</span>{"}"}]{"\n"})
                </pre>
                <div className="console-meter">
                  <div className="meter-head">
                    <span>本月可用额度</span>
                    <strong>¥ 27.40</strong>
                  </div>
                  <div className="meter-track">
                    <div className="meter-fill" />
                  </div>
                  <div className="meter-foot">
                    <span>已用 ¥17.60</span>
                    <span>硬预算保护 · ON</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="capabilities">
          <div className="container">
            <div className="section-head">
              <div>
                <div className="kicker">Not another cheap proxy</div>
                <h2>不是更便宜的代理，<br />而是更可控的 AI 基础设施。</h2>
              </div>
              <p>
                低价本身不是壁垒。稳定的上游、透明的成本、不会失控的预算，
                才是团队愿意长期使用的理由。
              </p>
            </div>

            <div className="feature-grid">
              <article className="feature-card">
                <div className="feature-icon">
                  <Wallet size={21} />
                </div>
                <h3>先预授权，再调用</h3>
                <p>
                  每次请求按最大可能成本预留余额，完成后按实际 Token 结算并退回差额。
                  余额不足时在请求入口直接拦截。
                </p>
              </article>
              <article className="feature-card">
                <div className="feature-icon">
                  <ShieldCheck size={21} />
                </div>
                <h3>授权清晰，数据克制</h3>
                <p>
                  仅接入具备商业使用与转售授权的 API 上游，不共享个人订阅。
                  默认不保存提示词与模型输出，只记录计量所需元数据。
                </p>
              </article>
              <article className="feature-card">
                <div className="feature-icon">
                  <BarChart3 size={21} />
                </div>
                <h3>每一分钱可解释</h3>
                <p>
                  按 Key、模型和日期查看 Token 与费用。站内余额直接对应人民币金额，
                  不用研究虚拟美元与倍率换算。
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section-tight" style={{ background: "var(--surface)" }}>
          <div className="container split">
            <div className="split-copy">
              <div className="kicker">Drop-in compatibility</div>
              <h2>你现有代码，几乎不用改。</h2>
              <p>
                把 API Base URL 指向 CokeAI，换上平台 Key，即可继续使用 OpenAI
                Python、Node.js 或任意兼容客户端。聊天补全与流式输出均支持。
              </p>
              <ul className="check-list">
                <li>
                  <Check size={15} /> /v1/chat/completions 与 /v1/models
                </li>
                <li>
                  <Check size={15} /> SSE 流式响应、工具调用、JSON 输出参数透传
                </li>
                <li>
                  <Check size={15} /> 每次请求返回独立 Request ID，便于排障
                </li>
                <li>
                  <Check size={15} /> 按 API Key 隔离，可随时撤销
                </li>
              </ul>
            </div>
            <div className="code-card">
              <div className="code-card-head">
                <span>curl · streaming</span>
                <span>HTTPS</span>
              </div>
              <pre>{`curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer $COKEAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [
      { "role": "user", "content": "Explain vector search" }
    ],
    "stream": true
  }'`}</pre>
            </div>
          </div>
        </section>

        <section className="section" id="models">
          <div className="container">
            <div className="section-head">
              <div>
                <div className="kicker">Model catalog</div>
                <h2>一个入口，多种模型选择。</h2>
              </div>
              <p>
                每个模型独立定价、独立上游配置。平台只展示已完成授权和接入验证的模型；
                未就绪模型会在上线后自动出现在这里。
              </p>
            </div>

            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>上下文</th>
                      <th>输入 / 百万 Token</th>
                      <th>输出 / 百万 Token</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelResult.rows.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty">模型目录正在配置中。</div>
                        </td>
                      </tr>
                    ) : (
                      modelResult.rows.map((model) => {
                        const ready =
                          model.enabled &&
                          model.upstream_enabled &&
                          Boolean(model.api_key_encrypted);
                        return (
                          <tr key={model.id}>
                            <td>
                              <div className="table-model">
                                <span className="model-mark">
                                  {model.display_name.slice(0, 2).toUpperCase()}
                                </span>
                                <div>
                                  <strong>{model.display_name}</strong>
                                  <span>{model.id}</span>
                                </div>
                              </div>
                            </td>
                            <td className="mono small">
                              {Math.round(model.context_window / 1000)}K
                            </td>
                            <td className="mono small">
                              ¥
                              {retailCnyPerMillion(
                                model.input_price_usd_micros_per_mtok,
                                model.markup_bps,
                              ).toFixed(2)}
                            </td>
                            <td className="mono small">
                              ¥
                              {retailCnyPerMillion(
                                model.output_price_usd_micros_per_mtok,
                                model.markup_bps,
                              ).toFixed(2)}
                            </td>
                            <td>
                              <span
                                className={`badge ${ready ? "badge-green" : "badge-yellow"}`}
                              >
                                {ready ? "可用" : "接入中"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="small muted mt-12">
              价格以实际请求时的计费规则为准；上游价格变化时会同步更新平台售价。
            </p>
          </div>
        </section>

        <section className="section" id="pricing" style={{ background: "var(--surface)" }}>
          <div className="container">
            <div className="section-head">
              <div>
                <div className="kicker">Simple pricing</div>
                <h2>按需开始，<br />额度写清楚。</h2>
              </div>
              <p>
                套餐购买后直接转为人民币用量额度并激活有效期。
                不使用自动续费，不玩“虚拟美元”，不承诺不存在的无限量。
              </p>
            </div>

            <div className="plan-grid">
              {planResult.rows.map((plan) => {
                const features = Array.isArray(plan.features)
                  ? (plan.features as string[])
                  : [];
                return (
                  <article
                    className={`plan-card${plan.highlight ? " highlight" : ""}`}
                    key={plan.id}
                  >
                    {plan.highlight ? <span className="plan-badge">Popular</span> : null}
                    <h3 className="plan-name">{plan.name}</h3>
                    <p className="plan-tagline">{plan.tagline}</p>
                    <div className="plan-price">
                      <strong>{formatCny(plan.price_micros).replace("¥", "")}</strong>
                      <span>CNY / {plan.duration_days} 天</span>
                    </div>
                    <div className="plan-credit">
                      <span>到账用量额度</span>
                      <strong>{formatCny(plan.credits_micros)}</strong>
                    </div>
                    <ul className="plan-features">
                      {features.map((feature) => (
                        <li key={feature}>
                          <Check size={13} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <div className="plan-actions">
                      <Link
                        className={`btn ${plan.highlight ? "btn-primary" : "btn-dark"} btn-block`}
                        href="/register"
                      >
                        选择{plan.name}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="flex-between mt-24 flex-wrap">
              <p className="small muted" style={{ margin: 0 }}>
                {featuredPlan
                  ? `大多数开发者首选「${featuredPlan.name}」，约合 ${formatCny(featuredPlan.credits_micros)} 的模型调用额度。`
                  : "所有套餐均为预付额度，不自动续费。"}
              </p>
              <Link className="text-link small" href="/pricing">
                查看完整价格与规则 →
              </Link>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="section-head">
              <div>
                <div className="kicker">Built for real usage</div>
                <h2>从个人项目，到客户交付。</h2>
              </div>
              <p>
                控制台把技术细节收敛成几个明确动作：创建 Key、查看花费、设置余额提醒、续费套餐。
              </p>
            </div>

            <div className="grid-3">
              <div className="feature-card">
                <div className="feature-icon">
                  <KeyRound size={20} />
                </div>
                <h3>多个 Key，按项目隔离</h3>
                <p>每个项目使用独立 Key，可单独撤销、单独查看使用记录，不共用一把万能钥匙。</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">
                  <Gauge size={20} />
                </div>
                <h3>速率与并发保护</h3>
                <p>按用户执行每分钟请求数与并发上限。超出后返回明确的 429 与重试时间。</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">
                  <LockKeyhole size={20} />
                </div>
                <h3>密钥只保存哈希</h3>
                <p>平台 API Key 仅显示一次，数据库只保存哈希。上游密钥加密存储，不进入前端。</p>
              </div>
            </div>

            <div className="panel mt-24" style={{ padding: 28 }}>
              <div className="grid-3">
                <div className="vertical-align">
                  <Sparkles size={17} />
                  <span className="small">请求级预算预授权</span>
                </div>
                <div className="vertical-align">
                  <Zap size={17} />
                  <span className="small">流式输出实时计量</span>
                </div>
                <div className="vertical-align">
                  <Code2 size={17} />
                  <span className="small">标准 OpenAI 错误结构</span>
                </div>
                <div className="vertical-align">
                  <Wallet size={17} />
                  <span className="small">人民币余额与账单</span>
                </div>
                <div className="vertical-align">
                  <ShieldCheck size={17} />
                  <span className="small">不保存请求正文</span>
                </div>
                <div className="vertical-align">
                  <BarChart3 size={17} />
                  <span className="small">模型级用量拆解</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section-tight">
          <div className="container-narrow faq">
            <div className="kicker">FAQ</div>
            <h2 style={{ margin: "0 0 18px", fontSize: 34, letterSpacing: "-0.05em" }}>
              上线前，先把问题说清楚。
            </h2>
            <details>
              <summary>平台会保存我的提示词和代码吗？</summary>
              <div className="faq-body">
                不会默认保存请求正文和模型输出。计费与排障只需要模型、Token、延迟、
                状态与 Request ID。若未来提供可选的调试日志，会单独征得同意并提供删除能力。
              </div>
            </details>
            <details>
              <summary>为什么不做 ChatGPT 会员拼车？</summary>
              <div className="faq-body">
                个人会员订阅不等于可商业转售的 API 额度，共享、转售或自动化提取通常被上游条款禁止。
                CokeAI 只接入有明确商业授权和区域许可的 API 服务，避免用户业务依赖随时可能失效的账号池。
              </div>
            </details>
            <details>
              <summary>余额用完会怎样？</summary>
              <div className="faq-body">
                新的模型请求会在入口处被拒绝，返回 402 与明确错误信息。已开始的流式请求会按实际
                消耗结算；不会产生无法解释的负余额，也不会未经授权自动扣款。
              </div>
            </details>
            <details>
              <summary>支持退款吗？</summary>
              <div className="faq-body">
                未开始使用、已支付且未消耗额度的订单，可在购买后 72 小时内联系客服申请审核。
                已实际调用上游模型产生的费用无法退回。具体规则以服务条款和订单页面说明为准。
              </div>
            </details>
            <details>
              <summary>我可以用它接 Claude Code 或自己的应用吗？</summary>
              <div className="faq-body">
                任何兼容 OpenAI Chat Completions 的客户端或 SDK 都可以接入。请先确认该客户端
                支持自定义 Base URL，并参考文档完成环境变量配置。
              </div>
            </details>
          </div>
        </section>

        <section className="cta-band">
          <div className="container cta-inner">
            <div>
              <h2>先小规模验证，再放大规模。</h2>
              <p>从一张体验套餐开始，用真实用量数据决定下一步。</p>
            </div>
            <Link className="btn" href="/register">
              创建账户 <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
