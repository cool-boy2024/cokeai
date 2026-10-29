import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { BuyForm } from "@/components/shop/BuyForm";
import { ProductCover } from "@/components/shop/ProductCover";
import { ProductIntro } from "@/components/shop/ProductIntro";
import { ProductNotices } from "@/components/shop/ProductNotices";
import {
  AvailabilityBadge,
  DeliveryBadge,
  EtaBadge,
  WarrantyBadge,
} from "@/components/shop/ShopBadges";
import { getCurrentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { isEasyPayConfigured } from "@/lib/payments/easypay";
import { getPublicProduct } from "@/lib/shop/catalog";
import { SHOP_COPY } from "@/lib/shop/copy";
import { isShopUsdtAvailable } from "@/lib/shop/usdt";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicProduct(slug);
  if (!product) return { title: "商品不存在" };
  return {
    title: product.name,
    description: product.subtitle,
  };
}

export default async function ShopProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!config.shopEnabled) notFound();
  const { slug } = await params;
  const [product, user, usdtAvailable] = await Promise.all([
    getPublicProduct(slug),
    getCurrentUser(),
    isShopUsdtAvailable(),
  ]);
  if (!product) notFound();

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main shop-page">
        <div className="container">
          <nav className="shop-crumbs" aria-label="面包屑">
            <Link href="/shop">小店</Link>
            <CaretRight size={13} />
            <span>{product.name}</span>
          </nav>

          <div className="shop-detail">
            <div className="shop-detail-main">
              <ProductCover
                variant={product.cover_variant}
                brand={product.brand}
                className="shop-detail-cover"
              />

              <div className="shop-detail-meta">
                <div>
                  <span className="shop-product-brand">{product.brand.toUpperCase()}</span>
                  <h1>{product.name}</h1>
                  <p>{product.subtitle}</p>
                </div>
                <div className="shop-detail-badges">
                  <AvailabilityBadge availability={product.availability} />
                  <DeliveryBadge method={product.delivery_method} />
                  <EtaBadge min={product.eta_min_minutes} max={product.eta_max_minutes} />
                  <WarrantyBadge type={product.warranty_type} days={product.warranty_days} />
                </div>
              </div>

              <ProductIntro product={product} />

              <ProductNotices product={product} />

              <section className="shop-section">
                <h2>交付流程</h2>
                <div className="shop-steps">
                  <div className="shop-step">
                    <span>01</span>
                    <strong>下单付款</strong>
                    <p>确认商品信息，完成 USDT 支付。</p>
                  </div>
                  <div className="shop-step">
                    <span>02</span>
                    <strong>人工处理</strong>
                    <p>按商品说明处理，进度可在订单页查看。</p>
                  </div>
                  <div className="shop-step">
                    <span>03</span>
                    <strong>领取交付</strong>
                    <p>在订单页查看并复制卡密或账号信息。</p>
                  </div>
                </div>
              </section>

              <section className="shop-section">
                <h2>{SHOP_COPY.sections.includes}</h2>
                <ul className="shop-list">
                  {product.includes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="shop-section">
                <h2>{SHOP_COPY.sections.usage}</h2>
                <ol className="shop-list shop-list-numbered">
                  {product.usage_notes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>
            </div>

            <aside className="shop-detail-aside">
              <BuyForm
                product={product}
                loggedIn={Boolean(user)}
                paymentOptions={{
                  // Personal Alipay QR and manual transfers stay off. The
                  // merchant EasyPay option appears only when configured.
                  alipayManual: false,
                  alipay: config.shopEasypayEnabled && isEasyPayConfigured(),
                  usdt: usdtAvailable,
                  manual: false,
                }}
              />
              <div className="shop-aside-note">
                <span>
                  {SHOP_COPY.sections.support}
                  <a href={`mailto:${config.shopSupportEmail}`}>{config.shopSupportEmail}</a>
                </span>
              </div>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
