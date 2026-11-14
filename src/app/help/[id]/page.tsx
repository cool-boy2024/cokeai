import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { formatFullDate } from "@/lib/format";
import { getHelpArticle } from "@/lib/help/store";
import "../help.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

function normalizeId(value: string): string | null {
  const decoded = decodeURIComponent(value).trim();
  // Only mirrored supplier articles (article.N) are public help pages.
  return /^article\.\d+$/.test(decoded) ? decoded : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const articleId = normalizeId(id);
  const article = articleId ? await getHelpArticle(articleId).catch(() => null) : null;
  if (!article) return { title: "帮助中心" };
  return {
    title: article.title,
    description: article.summary || undefined,
  };
}

export default async function HelpArticlePage({ params }: PageProps) {
  const { id } = await params;
  const articleId = normalizeId(id);
  const article = articleId ? await getHelpArticle(articleId).catch(() => null) : null;
  if (!article) notFound();

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main help-page">
        <article className="container help-article">
          <Link className="help-back" href="/help">
            <ArrowLeft size={14} />
            返回帮助中心
          </Link>

          <header className="help-article-head">
            <div className="hero-eyebrow">
              <i />
              Help center
            </div>
            <h1>{article.title}</h1>
            <div className="help-article-meta">
              <time dateTime={article.publishedAt?.toISOString()}>
                更新于 {formatFullDate(article.publishedAt)}
              </time>
            </div>
          </header>

          <div
            className="help-article-body"
            // Sanitised in src/lib/help/sync.ts before it reaches the database.
            dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
          />

          <div className="help-article-foot">
            <Link className="btn btn-light" href="/help">
              查看全部教程
            </Link>
            <Link className="text-link" href="/shop">
              去小店看看
            </Link>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
