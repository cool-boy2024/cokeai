import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code,
  Storefront,
  Wallet,
} from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { TaglineReveal } from "@/components/TaglineReveal";
import { HeroBrandStrip } from "@/components/home/HeroBrandStrip";
import { HeroOrbit } from "@/components/home/HeroOrbit";
import { ShopRing } from "@/components/home/ShopRing";
import { ProductCard } from "@/components/shop/ProductCard";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { listCatalogModels } from "@/lib/model-catalog";
import { formatCny } from "@/lib/money";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";
import { listPublicProducts } from "@/lib/shop/catalog";
import { applyMemberPricing } from "@/lib/shop/member-pricing";

export const dynamic = "force-dynamic";

type LandingPlan = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  highlight: boolean;
};

const SHOP_FAQ = [
  {
    question: "怎么购买？",
    answer:
      "在商品页点「购买」，再选择结算页显示的支付方式，按页面金额付款即可。",
  },
  {
    question: "小店商品多久发货？",
    answer:
      "人工处理，商品页会标注预计发货时间。付款后可以在订单页查看进度。",
  },
  {
    question: "小店支持退款吗？",
    answer:
      "未开始处理的订单可以申请退款；已交付、已兑换或已到账的订单不支持。退款由人工审核处理。",
  },
  {
    question: "订单在哪里查看？",
    answer: "登录后进入控制台，在订单页查看处理进度和交付内容。",
  },
];

const FAQ = SHOP_FAQ;

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default async function HomePage() {
  const [models, planResult, catalog, user] = await Promise.all([
    listCatalogModels(),
    // Only top-up packs belong here; membership is sold on its own page and the
    // hidden "custom" row only exists to satisfy orders.plan_id.
    query<LandingPlan>(
      `SELECT id, name, tagline, price_micros, credits_micros, highlight
         FROM plans
        WHERE active = TRUE AND kind = 'topup' AND id <> 'custom'
        ORDER BY sort_order`,
    ),
    listPublicProducts().catch(() => []),
    getCurrentUser(),
  ]);
  // Members see their discounted price on the home page cards too; the order
  // action recomputes it server-side before charging.
  const shopProducts = await applyMemberPricing(catalog, user);

  const showcase = models.slice(0, 8);
  const newProducts = shopProducts.slice(0, 3);
  const featuredPlan =
    planResult.rows.find((plan) => plan.highlight) || planResult.rows[0];
  const orderedPlans = featuredPlan
    ? [
        featuredPlan,
        ...planResult.rows.filter((plan) => plan.id !== featuredPlan.id),
      ]
    : [];
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main home-page">
        <section className="hero home-hero">
          <div className="hero-atmosphere" aria-hidden="true">
            <span className="hero-aurora hero-aurora-a" />
            <span className="hero-aurora hero-aurora-b" />
            <span className="hero-aurora hero-aurora-c" />
          </div>

          <HeroOrbit />

          <div className="hero-float hero-float-a" aria-hidden="true">
            <Check size={16} />
            <div>
              <strong>人工审核</strong>
              <span>订单进度可查</span>
            </div>
          </div>
          <div className="hero-float hero-float-b" aria-hidden="true">
            <Storefront size={16} />
            <div>
              <strong>
                {shopProducts.length > 0
                  ? `${shopProducts.length} 件商品在售`
                  : "小店上新中"}
              </strong>
              <span>人工发货 · 订单可查</span>
            </div>
          </div>

          <div className="container hero-center">
            <div className="hero-eyebrow">
              <i />
              数字商品 · 人工审核
            </div>
            <h1 className="hero-title">
              <span className="hero-line">
                <span>CokeAI 小店</span>
              </span>
              <span className="hero-line hero-line-sub">
                <span>订阅、账号、接码，都在这里。</span>
              </span>
            </h1>
            <p className="hero-lead">
              订阅、卡密、代充，人工审核后发货。
              <br />
              下单后订单进度随时可查。
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/shop">
                逛逛小店 <ArrowRight size={16} />
              </Link>
              <Link className="hero-secondary" href="/dashboard/shop">
                查看订单 <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="hero-proof">
              <span className="proof-pill">
                <Check size={14} /> 人工审核后发货
              </span>
              <span className="proof-pill">
                <Wallet size={14} /> 订单进度可查
              </span>
              <span className="proof-pill">
                <Check size={14} /> 质保按商品标注
              </span>
            </div>
            <HeroBrandStrip />
            <div className="hero-note">
              {shopProducts.length > 0
                ? `${shopProducts.length} 件商品在售`
                : "品牌仅作生态示意"}
            </div>
          </div>
        </section>

        <TaglineReveal />

        {shopProducts.length > 0 ? (
          <section className="section shop-collection">
            <ShopRing products={shopProducts.slice(0, 8)} />
            <div className="container shop-collection-center">
              <Reveal>
                <div className="hero-eyebrow">
                  <i />
                  Shop · 小店
                </div>
                <h2 className="shop-collection-title">小店上新</h2>
                <p className="shop-collection-lead">
                  订阅、卡密、代充。挑一件今天要用的。
                </p>
                <div className="shop-collection-actions">
                  <Link className="text-link" href="/shop">
                    全部商品 <ArrowRight size={14} />
                  </Link>
                </div>
                <div className="shop-collection-meta">
                  {shopProducts.length} 件商品在售 · 人工发货
                </div>
              </Reveal>
            </div>
            <div className="container shop-collection-mobile">
              <div className="shop-grid shop-grid-home">
                {newProducts.map((product, index) => (
                  <ProductCard
                    product={product}
                    featured={newProducts.length >= 3 && index === 0}
                    key={product.id}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {PUBLIC_API_SALES_ENABLED ? (
        <>
        <section className="section home-bento">
          <div className="container">
            <Reveal>
              <div className="bento-grid">
                <article className="bento-card bento-large">
                  <div>
                    <div className="kicker">Billing</div>
                    <h2>
                      按量计费，
                      <br />
                      不买用不完的套餐。
                    </h2>
                    <p>
                      每次调用按 Token 结算。用量、费用和 Key
                      限额在控制台一次看清。
                    </p>
                  </div>
                  <div className="usage-panel" aria-hidden="true">
                    <div className="usage-head">
                      <span>计费结构示意</span>
                      <span>按 Token 结算</span>
                    </div>
                    <div className="usage-row">
                      <span>输入</span>
                      <div className="usage-track">
                        <i style={{ width: "76%" }} />
                      </div>
                    </div>
                    <div className="usage-row">
                      <span>输出</span>
                      <div className="usage-track">
                        <i style={{ width: "48%" }} />
                      </div>
                    </div>
                    <div className="usage-row">
                      <span>缓存</span>
                      <div className="usage-track">
                        <i style={{ width: "24%" }} />
                      </div>
                    </div>
                  </div>
                </article>

                <Link className="bento-card bento-link" href="/docs">
                  <div>
                    <div className="bento-icon">
                      <Code size={20} />
                    </div>
                    <h3>接入教程，单独放在一处</h3>
                    <p>Base URL、鉴权、流式输出和错误码，在教程里一次看完。</p>
                  </div>
                  <span className="bento-arrow">
                    <ArrowUpRight size={16} />
                  </span>
                </Link>

                <Link className="bento-card bento-link" href="/shop">
                  <div>
                    <div className="kicker">Storefront</div>
                    <h3>订阅和代充，也在同一家店</h3>
                    <p>
                      ChatGPT、Claude、Gemini、Grok、Muse。人工处理，订单进度随时可查。
                    </p>
                  </div>
                  <span className="bento-arrow">
                    <ArrowUpRight size={16} />
                  </span>
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="section steps-section" id="how-it-works">
          <div className="container">
            <Reveal>
              <div className="section-head">
                <div>
                  <div className="kicker">How it works</div>
                  <h2>三步接上，然后按量付费。</h2>
                </div>
                <p>注册免费，充值后创建 Key 就能调用。</p>
              </div>
              <ol className="steps-grid">
                <li className="step-item">
                  <span className="step-index">01</span>
                  <h3>注册账号</h3>
                  <p>邮箱注册后进入控制台，不需要信用卡。</p>
                </li>
                <li className="step-item">
                  <span className="step-index">02</span>
                  <h3>充值余额</h3>
                  <p>在控制台选择 USDT 网络，链上确认后额度到账。</p>
                </li>
                <li className="step-item">
                  <span className="step-index">03</span>
                  <h3>创建 Key</h3>
                  <p>生成 API Key，替换 Base URL 就可以调用。</p>
                </li>
              </ol>
            </Reveal>
          </div>
        </section>
        </>
        ) : null}

        {PUBLIC_API_SALES_ENABLED ? (
        <>
        <section className="section" id="models">
          <div className="container">
            <Reveal>
              <div className="section-head">
                <div>
                  <div className="kicker">Models</div>
                  <h2>模型与价格</h2>
                </div>
                <Link className="text-link" href="/pricing">
                  全部模型 <ArrowRight size={14} />
                </Link>
              </div>

              <div className="table-card">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>模型</th>
                        <th className="col-platform">平台</th>
                        <th>输入 / 1M</th>
                        <th>输出 / 1M</th>
                      </tr>
                    </thead>
                    <tbody>
                      {showcase.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
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
                        showcase.map((model) => (
                          <tr key={model.id}>
                            <td>
                              <span className="mono small">{model.id}</span>
                            </td>
                            <td className="small muted col-platform">{model.platform}</td>
                            <td className="mono small">
                              {formatCny(model.inputCnyPerMtok * 1_000_000)}
                            </td>
                            <td className="mono small">
                              {formatCny(model.outputCnyPerMtok * 1_000_000)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="table-footnote">
                表内价格即结算价，按实际 Token 用量扣费。
              </p>
            </Reveal>
          </div>
        </section>

        <section className="section" id="packs">
          <div className="container">
            <Reveal>
              <div className="section-head">
                <div>
                  <div className="kicker">Credits</div>
                  <h2>充值包</h2>
                </div>
                <p>人民币充值，1 元 = 1 额度。</p>
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
          </div>
        </section>
        </>
        ) : null}

        <section className="section faq-section" id="faq">
          <div className="container">
            <Reveal>
              <div className="section-head">
                <div>
                  <div className="kicker">FAQ</div>
                  <h2>常见问题</h2>
                </div>
                {PUBLIC_API_SALES_ENABLED ? (
                  <Link className="text-link" href="/docs">
                    查看接入教程 <ArrowRight size={14} />
                  </Link>
                ) : (
                  <Link className="text-link" href="/shop">
                    查看全部商品 <ArrowRight size={14} />
                  </Link>
                )}
              </div>
              <dl className="faq-grid">
                {FAQ.map((item) => (
                  <div className="faq-item" key={item.question}>
                    <dt>{item.question}</dt>
                    <dd>{item.answer}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </section>

        <section className="cta-section">
          <div className="container">
            <Reveal>
              <div className="cta-card">
                <div>
                  <h2>
                    {PUBLIC_API_SALES_ENABLED
                      ? "注册免费，充值后就能调用。"
                      : "挑一件今天要用的。"}
                  </h2>
                  <p>
                    {PUBLIC_API_SALES_ENABLED
                      ? "USDT 充值 · 用量可查"
                      : "人工审核后发货 · 订单进度可查 · 质保按商品标注"}
                  </p>
                </div>
                <div className="cta-actions">
                  <Link
                    className="btn btn-primary"
                    href={PUBLIC_API_SALES_ENABLED ? "/register" : "/shop"}
                  >
                    {PUBLIC_API_SALES_ENABLED ? "创建账号" : "逛逛小店"}{" "}
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }}
      />
      <SiteFooter />
    </>
  );
}
