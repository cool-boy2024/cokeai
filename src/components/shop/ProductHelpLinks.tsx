import Link from "next/link";

/**
 * Prominent pointer from a product to the mirrored help center. Mirrors the
 * supplier's "售后须知" block: a red reading warning, the video tutorial
 * heading, then one link per article. With no linked article it still renders
 * the banner and falls back to the help center index.
 */
export function ProductHelpLinks({
  articles,
}: {
  articles: { id: string; title: string }[];
}) {
  return (
    <section className="shop-section shop-help-entry" aria-labelledby="shop-help-title">
      <p className="shop-help-banner">售后须知 · 购买前请仔细阅读</p>
      <h2 id="shop-help-title" className="shop-help-heading">
        📺 视频登录教程在本站帮助中心
      </h2>
      <div className="shop-help-links">
        {articles.length > 0 ? (
          articles.map((article) => (
            <Link key={article.id} className="shop-help-link" href={`/help/${article.id}`}>
              {article.title}：点我查看 👉
            </Link>
          ))
        ) : (
          <Link className="shop-help-link" href="/help">
            前往帮助中心 👉
          </Link>
        )}
      </div>
    </section>
  );
}
