import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { PUBLIC_API_SALES_ENABLED } from "@/lib/public-features";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main not-found-page">
        <div className="not-found-inner">
          <p className="not-found-code">404</p>
          <h1>这页没有找到。</h1>
          <p>
            链接可能已经失效，或者你访问了尚未开放的页面。
            先回到一个确定能用的地方。
          </p>
          <div className="not-found-actions">
            <Link className="btn btn-primary" href="/">
              <ArrowLeft size={15} /> 回到首页
            </Link>
            <Link className="btn btn-light" href="/shop">
              逛逛小店
            </Link>
            <Link
              className="text-link"
              href={PUBLIC_API_SALES_ENABLED ? "/docs" : "/#faq"}
            >
              {PUBLIC_API_SALES_ENABLED ? "查看文档" : "查看常见问题"}{" "}
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
