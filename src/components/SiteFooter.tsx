import Link from "next/link";
import { Logo } from "./Logo";

const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo />
            <p>
              为开发者和团队提供可预算、可追踪的 AI API 接入服务。
              只接入具备商业授权与合规区域许可的上游模型。
            </p>
          </div>
          <div className="footer-col">
            <h4>产品</h4>
            <Link href="/pricing">价格</Link>
            <Link href="/docs">API 文档</Link>
            <Link href="/dashboard">控制台</Link>
          </div>
          <div className="footer-col">
            <h4>支持</h4>
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            <Link href="/docs#errors">错误码</Link>
            <Link href="/docs#limits">用量限制</Link>
          </div>
          <div className="footer-col">
            <h4>条款</h4>
            <Link href="/terms">服务条款</Link>
            <Link href="/privacy">隐私政策</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} CokeAI. All rights reserved.</span>
          <span>不提供个人订阅账号共享或地区限制规避服务。</span>
        </div>
      </div>
    </footer>
  );
}
