import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/Reveal";
import { CostMeter, type MeterModel } from "@/components/home/CostMeter";
import { EndpointDemo } from "@/components/home/EndpointDemo";
import { PlanPicker, type PickerPlan } from "@/components/home/PlanPicker";
import { StageSteps } from "@/components/home/StageSteps";
import { query } from "@/lib/db";
import { listCatalogModels } from "@/lib/model-catalog";
import { formatCny } from "@/lib/money";
import { listPublicProducts } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";

type LandingPlan = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  highlight: boolean;
};

const FAQ = [
  {
    question: "CokeAI 的接口和 OpenAI 有什么不同？",
    answer:
      "接口兼容 OpenAI Chat Completions。替换 Base URL 和 API Key 就能用，按人民币余额计费。",
  },
  {
    question: "怎么计费？",
    answer:
      "按每次请求的实际 Token 用量结算，输入和输出分别计价。价格与每笔用量在控制台可查。",
  },
  {
    question: "怎么充值？",
    answer:
      "在控制台选择 USDT TRC20 转账，链上确认后额度自动到账。当前只开这一种充值方式。",
  },
  {
    question: "支持哪些模型？",
    answer:
      "控制台模型列表和价格页会列出当前可用的模型与价格。没有上架的模型不会出现在列表里。",
  },
  {
    question: "小店商品多久发货？",
    answer:
      "人工处理，商品页会标注预计发货时间。付款后可以在订单页查看进度。",
  },
  {
    question: "小店支持退款吗？",
    answer:
      "未开始处理的订单可以申请退款；已交付、已兑换或已到账的订单不支持。USDT 退款需要人工核对地址。",
  },
  {
    question: "API Key 安全吗？",
    answer:
      "Key 只在创建时完整显示一次，可以随时在控制台撤销。不要写进前端代码或公开仓库。",
  },
  {
    question: "余额会过期吗？",
    answer: "不会。充值额度按实际用量扣费，剩余余额一直有效。",
  },
];

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
  const [models, planResult, shopProducts] = await Promise.all([
    listCatalogModels(),
    query<LandingPlan>(
      `SELECT id, name, tagline, price_micros, credits_micros, highlight
         FROM plans WHERE active = TRUE ORDER BY sort_order`,
    ),
    listPublicProducts().catch(() => []),
  ]);

  const meterModels: MeterModel[] = models.slice(0, 3).map((model) => ({
    id: model.id,
    name: model.displayName,
    inputCnyPerMtok: model.inputCnyPerMtok,
    outputCnyPerMtok: model.outputCnyPerMtok,
  }));

  const plans: PickerPlan[] = planResult.rows.map((plan) => ({
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    priceCny: Number(plan.price_micros) / 1_000_000,
    creditsCny: Number(plan.credits_micros) / 1_000_000,
    highlight: plan.highlight,
  }));

  const defaultModelId = models[0]?.id ?? "deepseek-flash";
  const newProducts = shopProducts.slice(0, 6);

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main home-page">
        <section className="home-hero">
          <div className="home-hero-grid">
            <div className="home-hero-copy">
              <h1 className="home-title">
                <span className="home-title-line">
                  <span>按 Token 计费的</span>
                </span>
                <span className="home-title-line">
                  <span>AI 接口。</span>
                </span>
              </h1>
              <p className="home-lead">
                兼容 OpenAI SDK 的 API 中转，人民币按量计费。小店另售
                ChatGPT、Claude、Gemini 的订阅和代充。
              </p>
              <div className="home-actions">
                <Link className="action-primary" href="/register">
                  创建账号
                </Link>
                <Link className="action-link" href="/pricing">
                  看价格
                </Link>
              </div>
              <dl className="home-facts">
                <div>
                  <dt>充值</dt>
                  <dd>USDT · TRC20</dd>
                </div>
                <div>
                  <dt>余额</dt>
                  <dd>不过期</dd>
                </div>
                <div>
                  <dt>发货</dt>
                  <dd>人工处理</dd>
                </div>
              </dl>
            </div>

            <Reveal className="home-hero-frag" delay={140}>
              <CostMeter models={meterModels} />
            </Reveal>
          </div>
        </section>

        <section className="home-endpoint">
          <Reveal>
            <EndpointDemo modelId={defaultModelId} />
          </Reveal>
        </section>

        <section className="home-media" aria-label="光纤">
          <Reveal>
            <figure>
              <img
                src="/media/fiber-light.jpg"
                width={1920}
                height={1275}
                alt="绿色激光穿过一段光纤，端面发亮"
              />
              <figcaption>
                光在光纤里走。你的请求走的是同一条路。
              </figcaption>
            </figure>
          </Reveal>
        </section>

        <section className="home-stages">
          <Reveal>
            <StageSteps modelId={defaultModelId} />
          </Reveal>
        </section>

        <section className="home-plans" aria-labelledby="plans-title">
          <Reveal>
            <div className="home-plans-head">
              <h2 id="plans-title">充值包</h2>
              <p>人民币充值，1 元 = 1 额度。余额不过期，按实际用量扣费。</p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <PlanPicker plans={plans} />
          </Reveal>
        </section>

        <section className="home-list" aria-labelledby="list-title">
          <div className="home-list-grid">
            <Reveal className="home-list-copy">
              <h2 id="list-title">价目表</h2>
              <p>
                模型按 Token 结算，小店商品按件计价。发货时间以商品页标注为准，
                未上架的模型不会出现在列表里。
              </p>
              <Link className="action-link" href="/shop">
                全部商品
              </Link>
              <img
                className="home-list-photo"
                src="/media/patch-panel.jpg"
                width={960}
                height={720}
                alt="机房里一排光纤配线架，黄色尾纤从右侧接入"
                loading="lazy"
              />
              <p className="home-list-photo-note">机房里的光纤配线架。</p>
            </Reveal>

            <Reveal className="home-list-rows" delay={100}>
              <p className="list-group">模型 · 每百万 Token（输入 / 输出）</p>
              {models.length === 0 ? (
                <p className="list-empty">模型价格正在同步，稍后在这里列出。</p>
              ) : (
                models.map((model) => (
                  <Link
                    key={model.id}
                    className="list-row"
                    href="/pricing"
                  >
                    <span className="list-name">{model.displayName}</span>
                    <span className="list-value">
                      {formatCny(model.inputCnyPerMtok * 1_000_000)} /{" "}
                      {formatCny(model.outputCnyPerMtok * 1_000_000)}
                    </span>
                  </Link>
                ))
              )}

              <p className="list-group">小店 · 每件</p>
              {newProducts.length === 0 ? (
                <p className="list-empty">小店正在上新，稍后在这里列出。</p>
              ) : (
                newProducts.map((product) => (
                  <Link
                    key={product.id}
                    className="list-row"
                    href={`/shop/${product.slug}`}
                  >
                    <span className="list-name">{product.name}</span>
                    <span className="list-value">
                      {formatCny(product.price_micros)}
                    </span>
                  </Link>
                ))
              )}
            </Reveal>
          </div>
        </section>

        <section className="home-faq" aria-labelledby="faq-title">
          <div className="home-faq-grid">
            <Reveal className="home-faq-head">
              <h2 id="faq-title">常见问题</h2>
              <p>
                计费、充值、发货和退款都在这里。没有写到的，发邮件到
                support@cokeai.cc.cd。
              </p>
            </Reveal>

            <Reveal className="home-faq-list" delay={80}>
              {FAQ.map((item) => (
                <details className="faq-tile" name="home-faq" key={item.question}>
                  <summary>
                    <span>{item.question}</span>
                    <i aria-hidden="true" />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="home-cta" aria-labelledby="cta-title">
          <div className="home-cta-inner">
            <Reveal className="home-cta-copy">
              <h2 id="cta-title">第一单，从注册开始。</h2>
              <p>
                注册免费。充值后创建 Key 就能调用，USDT 到账即用，余额不过期。
              </p>
            </Reveal>
            <Reveal className="home-cta-tag" delay={100}>
              <p className="home-cta-tag-line">
                <span>注册</span>
                <strong>¥0</strong>
              </p>
              <ul>
                <li>不需要信用卡</li>
                <li>余额不过期</li>
                <li>进度可查</li>
              </ul>
              <Link className="action-primary" href="/register">
                创建账号
              </Link>
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
