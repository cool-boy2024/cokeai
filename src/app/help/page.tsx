import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenText } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { formatFullDate } from "@/lib/format";
import { listHelpArticles } from "@/lib/help/store";
import "./help.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "帮助中心",
  description: "CokeAI 使用帮助：下单、交付、账号与常见问题的操作说明。",
};

export default async function HelpPage() {
  const articles = await listHelpArticles().catch(() => []);

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main help-page">
        <section className="help-hero">
          <div className="container">
            <div className="hero-eyebrow">
              <i />
              Help center
            </div>
            <h1>帮助中心</h1>
            <p>
              从下单到收货的完整操作说明。教程会跟着业务更新，遇到问题先在这里找答案。
            </p>
          </div>
        </section>

        <section className="help-list-section">
          <div className="container">
            {articles.length === 0 ? (
              <div className="help-empty">
                <BookOpenText size={24} />
                <strong>教程正在同步</strong>
                <p>内容整理完成后会出现在这里。如果需要人工协助，可以联系客服。</p>
              </div>
            ) : (
              <div className="help-grid">
                {articles.map((article, index) => (
                  <Link className="help-card" href={`/help/${article.id}`} key={article.id}>
                    <div className="help-card-top">
                      <span className="help-card-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <time className="help-card-time" dateTime={article.publishedAt?.toISOString()}>
                        {formatFullDate(article.publishedAt)}
                      </time>
                    </div>
                    <h2>{article.title}</h2>
                    {article.summary ? <p>{article.summary}</p> : null}
                    <span className="help-card-more">
                      查看教程 <ArrowRight size={14} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
