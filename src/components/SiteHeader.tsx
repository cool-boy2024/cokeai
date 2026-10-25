import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "./Logo";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Logo />
        <nav className="site-nav" aria-label="主导航">
          <Link href="/#capabilities">能力</Link>
          <Link href="/#models">模型</Link>
          <Link href="/pricing">定价</Link>
          <Link href="/docs">文档</Link>
        </nav>
        <div className="site-actions">
          {user ? (
            <>
              <span className="badge badge-green badge-dot">已登录</span>
              <Link className="btn btn-dark btn-sm" href="/dashboard">
                进入控制台
              </Link>
            </>
          ) : (
            <>
              <Link className="btn btn-ghost btn-sm" href="/login">
                登录
              </Link>
              <Link className="btn btn-primary btn-sm" href="/register">
                开始使用
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
