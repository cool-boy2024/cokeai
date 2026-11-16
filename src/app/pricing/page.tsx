import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { query } from "@/lib/db";
import { listCatalogModels } from "@/lib/model-catalog";
import { formatCny } from "@/lib/money";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";

export const metadata: Metadata = {
  title: "价格",
  description: "CokeAI 数字商品小店，提供账号、接码与订阅相关商品。",
};

export const dynamic = "force-dynamic";

type Plan = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  highlight: boolean;
};

function priceCell(cnyPerMtok: number): string {
  if (!Number.isFinite(cnyPerMtok) || cnyPerMtok <= 0) return "—";
  return formatCny(cnyPerMtok * 1_000_000);
}

export default async function PricingPage() {
  if (!PUBLIC_API_SALES_ENABLED) redirect("/shop");

  const [models, plans] = await Promise.all([
    listCatalogModels(),
    query<Plan>(
      `SELECT id, name, tagline, price_micros, credits_micros, highlight
         FROM plans
        WHERE active = TRUE AND kind = 'topup' AND id <> 'custom'
        ORDER BY sort_order`,
    ),
  ]);

  const featured =
    plans.rows.find((plan) => plan.highlight) || plans.rows[0];
  const orderedPlans = featured
    ? [featured, ...plans.rows.filter((plan) => plan.id !== featured.id)]
    : [];

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main pricing-page">
        <div className="container">
          <div className="page-head">
            <div>
              <div className="kicker">Pricing</div>
              <h1>按量付费，<br />不为闲置买单。</h1>
              <p>按实际用量结算，输入与输出分别计价。</p>
            </div>
            <Link className="btn btn-primary" href="/register">
              创建账号 <ArrowRight size={16} />
            </Link>
          </div>

          <section className="panel mb-24">
            <div className="panel-head">
              <div>
                <h2>模型价格</h2>
                <p>单位：人民币 / 100 万 Token。表内价格即结算价。</p>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th className="col-platform">平台</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th className="col-cache">缓存读</th>
                  </tr>
                </thead>
                <tbody>
                  {models.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="table-empty">
                          <div>
                            <strong>当前没有可售模型</strong>
                            <p>模型开放后，价格会直接显示在这里。</p>
                          </div>
                          <Link className="text-link" href="/docs">
                            查看接入文档 <ArrowRight size={14} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    models.map((model) => (
                      <tr key={model.id}>
                        <td>
                          <span className="mono small">{model.id}</span>
                        </td>
                        <td className="small muted col-platform">{model.platform}</td>
                        <td className="mono small">
                          {priceCell(model.inputCnyPerMtok)}
                        </td>
                        <td className="mono small">
                          {priceCell(model.outputCnyPerMtok)}
                        </td>
                        <td className="mono small col-cache">
                          {priceCell(model.cacheReadCnyPerMtok)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <Reveal>
              <div className="section-head">
                <div>
                  <div className="kicker">Credits</div>
                  <h2>充值包</h2>
                </div>
                <p>1 元 = 1 额度。</p>
              </div>
              <div className="plan-grid plan-editorial">
                {orderedPlans.map((plan) => (
                  <article
                    key={plan.id}
                    className={`plan-card${plan.highlight ? " highlight" : ""}`}
                  >
                    {plan.highlight ? (
                      <span className="plan-badge">推荐</span>
                    ) : null}
                    <h3 className="plan-name">{plan.name}</h3>
                    <p className="plan-tagline">{plan.tagline}</p>
                    <div className="plan-price">
                      <strong>
                        {formatCny(Number(plan.price_micros)).replace("¥", "")}
                      </strong>
                      <span>元</span>
                    </div>
                    <div className="plan-credit">
                      <span>到账额度</span>
                      <strong>
                        {formatCny(Number(plan.credits_micros))}
                      </strong>
                    </div>
                    <div className="plan-actions">
                      <Link
                        className={`btn ${
                          plan.highlight ? "btn-primary" : "btn-dark"
                        } btn-block`}
                        href="/dashboard/billing"
                      >
                        充值 <ArrowRight size={14} />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </Reveal>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
