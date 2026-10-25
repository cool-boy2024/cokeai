import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";

export default function NotFound() {
  return (
    <>
      <header className="site-header">
        <div className="container site-header-inner">
          <Logo />
          <Link className="btn btn-ghost btn-sm" href="/">
            <ArrowLeft size={13} /> 返回首页
          </Link>
        </div>
      </header>
      <main
        style={{
          display: "grid",
          minHeight: "62vh",
          placeItems: "center",
          textAlign: "center",
          padding: "60px 20px",
        }}
      >
        <div>
          <div className="mono small muted">ERROR / 404</div>
          <h1
            style={{
              margin: "10px 0 14px",
              fontSize: "clamp(48px,8vw,90px)",
              letterSpacing: "-0.07em",
            }}
          >
            页面不存在。
          </h1>
          <p className="muted" style={{ margin: "0 auto 26px", maxWidth: 420 }}>
            链接可能已失效，或你访问了尚未开放的页面。
          </p>
          <Link className="btn btn-primary" href="/">
            回到首页
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
