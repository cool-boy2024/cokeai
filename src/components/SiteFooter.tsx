import Link from "next/link";
import { connection } from "next/server";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";
import { getPublicSecurityStatus } from "@/lib/security";
import { Logo } from "./Logo";

const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";

export async function SiteFooter() {
  // The footer shows live protection data; keep it out of the static cache.
  await connection();
  const security = await getPublicSecurityStatus();
  const securityText = !security.guardEnabled
    ? "应用层防护已关闭"
    : security.available && security.todayTotal !== null
      ? `应用层防护已开启 · 今日拦截 ${security.todayTotal.toLocaleString("zh-CN")} 次`
      : "应用层防护已开启";

  return (
    <footer className="site-footer public-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo />
            <p>
              {PUBLIC_API_SALES_ENABLED
                ? "兼容 OpenAI SDK 的 AI API 接入服务。按量计费，余额不过期。"
                : "CokeAI 数字商品小店。人工审核后发货，订单进度可查。"}
            </p>
          </div>
          <div className="footer-col">
            <h4>产品</h4>
            <Link href="/shop">CokeAI 小店</Link>
            {PUBLIC_API_SALES_ENABLED ? (
              <>
                <Link href="/pricing">API 价格</Link>
                <Link href="/docs">接入教程</Link>
              </>
            ) : null}
            <Link href="/dashboard">控制台</Link>
          </div>
          <div className="footer-col">
            <h4>支持</h4>
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            <Link href="/#faq">常见问题</Link>
            <Link href="/help">帮助中心</Link>
            {PUBLIC_API_SALES_ENABLED ? (
              <Link href="/docs#errors">错误码</Link>
            ) : null}
          </div>
          <div className="footer-col">
            <h4>条款</h4>
            <Link href="/terms">服务条款</Link>
            <Link href="/shop/terms">数字商品须知</Link>
            <Link href="/privacy">隐私政策</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} CokeAI</span>
          <span>
            {PUBLIC_API_SALES_ENABLED
              ? "数字商品为人工发货 · API 按实际用量计费"
              : "数字商品为人工发货 · 质保按商品标注"}
          </span>
          <span className={`footer-security${security.guardEnabled ? "" : " is-off"}`}>
            <span className="footer-security-dot" aria-hidden="true" />
            {securityText}
          </span>
        </div>
      </div>
    </footer>
  );
}
