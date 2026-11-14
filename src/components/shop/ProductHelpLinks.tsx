import Link from "next/link";

/**
 * Prominent pointer from a product to the mirrored help center. Mirrors the
 * supplier's "售后须知" block: a red reading warning, the tutorial heading,
 * then one link per article. Products without a linked supplier article hide
 * the whole block instead of showing a generic or dead link.
 */
export function ProductHelpLinks({
  articles,
}: {
  articles: { id: string; title: string }[];
}) {
  if (articles.length === 0) return null;

  return (
    <section className="shop-section shop-help-entry" aria-labelledby="shop-help-title">
      <p className="shop-help-banner">售后须知 · 购买前请仔细阅读</p>
      <h2 id="shop-help-title" className="shop-help-heading">
        使用教程在本站帮助中心
      </h2>
      <div className="shop-help-links">
        {articles.map((article) => (
          <Link key={article.id} className="shop-help-link" href={`/help/${article.id}`}>
            {article.title}：点我查看 👉
          </Link>
        ))}
      </div>
    </section>
  );
}
