import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { query } from "@/lib/db";
import { formatCny, retailCnyPerMillion } from "@/lib/money";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "价格",
  description:
    "CokeAI 套餐与模型计费价格。人民币预付额度、明确有效期，无自动续费。",
};

type PlanRow = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  duration_days: number;
  features: unknown;
  highlight: boolean;
};

type ModelRow = {
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

export default async function PricingPage() {
  const [plans, models] = await Promise.all([
    query<PlanRow>(
      `SELECT id, name, tagline, price_micros, credits_micros, duration_days, features, highlight
         FROM plans WHERE active = TRUE ORDER BY sort_order`,
    ),
    query<ModelRow>(
      `SELECT m.id, m.display_name, m.description, m.context_window,
              m.input_price_usd_micros_per_mtok, m.output_price_usd_micros_per_mtok,
              m.markup_bps, m.enabled, u.enabled AS upstream_enabled,
              u.api_key_encrypted, u.name AS upstream_name
         FROM models m JOIN upstreams u ON u.id = m.upstream_id
        ORDER BY m.sort_order`,
    ),
  ]);

  return (
    <>
      <SiteHeader />
      <main>
        <section className="section-tight" style={{ background: "var(--ink)", color: "#fff" }}>
          <div className="container">
            <div className="eyebrow">
              <span className="eyebrow-dot" /> Pricing & metering
            </div>
            <h1
              style={{
                margin: 0,
                maxWidth: 720,
                fontSize: "clamp(40px,6vw,66px)",
                letterSpacing: "-0.06em",
                lineHeight: 1.06,
              }}
            >
              价格写明白，
              <br />
              预算才可控。
            </h1>
            <p style={{ maxWidth: 560, margin: "20px 0 0", color: "#aaa9a3", lineHeight: 1.8 }}>
              套餐费用直接转为人民币用量额度。模型调用按输入和输出 Token 分别计费，
              每次请求先预授权，结束后按实际用量结算。
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="plan-grid">
              {plans.rows.map((plan) => {
                const features = Array.isArray(plan.features)
                  ? (plan.features as string[])
                  : [];
                return (
                  <article
                    key={plan.id}
                    className={`plan-card${plan.highlight ? " highlight" : ""}`}
                  >
                    {plan.highlight ? <span className="plan-badge">Popular</span> : null}
                    <h2 className="plan-name">{plan.name}</h2>
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
                          <Check size={13} /> {feature}
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
          </div>
        </section>

        <section className="section-tight" style={{ background: "var(--surface)" }}>
          <div className="container">
            <div className="section-head">
              <div>
                <div className="kicker">Token pricing</div>
                <h2>模型单价。</h2>
              </div>
              <p>
                下表为人民币零售价，已包含平台转发、计量、账单与运营服务成本。
                价格变化以请求时的配置为准。
              </p>
            </div>
            <div className="table-card">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>模型</th>
                      <th>上游</th>
                      <th>上下文</th>
                      <th>输入 / 1M</th>
                      <th>输出 / 1M</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.rows.map((model) => {
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
                          <td className="small muted">{model.upstream_name}</td>
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
                            <span className={`badge ${ready ? "badge-green" : "badge-yellow"}`}>
                              {ready ? "可用" : "接入中"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container-narrow">
            <div className="kicker">Billing rules</div>
            <h2 style={{ margin: "0 0 24px", fontSize: 36, letterSpacing: "-0.05em" }}>
              计费与退款规则
            </h2>
            <div className="faq">
              <details open>
                <summary>额度如何计算？</summary>
                <div className="faq-body">
                  输入 Token 与输出 Token 分别按上表价格计费，结果以人民币精度计入账单。
                  套餐购买金额会转换为等值或增值后的站内可用额度，直接用于抵扣模型调用费用。
                </div>
              </details>
              <details>
                <summary>为什么每次调用会先冻结额度？</summary>
                <div className="faq-body">
                  为防止自动编程或批量任务突然消耗超额费用，网关会先按本次请求的最大可能成本
                  冻结余额，上游完成后按真实 usage 结算，差额自动退回。余额不足时请求不会发往上游。
                </div>
              </details>
              <details>
                <summary>套餐到期后余额还在吗？</summary>
                <div className="faq-body">
                  套餐到期后 API 调用暂停，但剩余余额记录保留。续费任意套餐后可继续使用。
                  如需退款或余额处理，请在产品购买后 72 小时内联系客服审核。
                </div>
              </details>
              <details>
                <summary>会产生自动扣费吗？</summary>
                <div className="faq-body">
                  不会。当前所有套餐均为一次付清、非自动续费。平台不会保存并自动扣取你的银行卡。
                  支付页面由 Stripe 托管，或由管理员人工确认到账。
                </div>
              </details>
              <details>
                <summary>价格会变化吗？</summary>
                <div className="faq-body">
                  上游供应商可能调整 API 价格。平台会同步更新模型零售价，并在控制台显示。
                  已购买的额度不会因价格上涨而被追溯扣减。
                </div>
              </details>
            </div>
            <div className="notice mt-24">
              套餐价格是服务费与额度组合，不是对任何个人订阅产品的拆分销售。
              平台仅面向合法区域和已获授权用途提供服务。
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
