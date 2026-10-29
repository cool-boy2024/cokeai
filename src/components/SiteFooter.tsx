import Link from "next/link";
import { Logo } from "./Logo";

const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";

export function SiteFooter() {
  return (
    <footer className="site-footer public-footer">
      <div className="footer-board">
        <div className="footer-tile footer-statement">
          <Logo />
          <p>
            兼容 OpenAI SDK 的 AI API 中转，人民币按量计费。小店另售订阅、卡密和代充。
          </p>
          <span className="footer-legal">
            图片：AZToshkov（CC BY-SA 3.0）· Syced（CC0），来自 Wikimedia Commons。
            <br />© {new Date().getFullYear()} CokeAI · 数字商品人工发货 · API
            按实际用量计费
          </span>
        </div>

        <div className="footer-tile footer-col">
          <p className="footer-label">产品</p>
          <Link href="/shop">小店</Link>
          <Link href="/pricing">模型价格</Link>
          <Link href="/docs">接入教程</Link>
          <Link href="/dashboard">控制台</Link>
        </div>

        <div className="footer-tile footer-col">
          <p className="footer-label">支持</p>
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          <Link href="/#faq">常见问题</Link>
          <Link href="/announcements">公告</Link>
        </div>

        <div className="footer-tile footer-col">
          <p className="footer-label">条款</p>
          <Link href="/terms">服务条款</Link>
          <Link href="/shop/terms">数字商品须知</Link>
          <Link href="/privacy">隐私政策</Link>
        </div>

        <Link className="footer-tile footer-mark" href="/">
          CokeAI.
        </Link>

        <Link className="footer-tile footer-invite" href="/register">
          <span>创建账号</span>
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 36 36 12M18 12h18v18"
              stroke="currentColor"
              strokeWidth="4"
            />
          </svg>
        </Link>
      </div>
    </footer>
  );
}
