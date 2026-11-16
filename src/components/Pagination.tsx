import Link from "next/link";

/** Page numbers with a window that keeps the first and last page reachable. */
function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) result.push("gap");
    result.push(value);
    previous = value;
  }
  return result;
}

/**
 * Server-rendered pager. Page controls are plain links, so the list works
 * without JavaScript, the URL is shareable, and the back button behaves. The
 * jump box is a GET form carrying the current filters as hidden fields.
 */
export function Pagination({
  page,
  totalPages,
  total,
  hrefFor,
  action,
  hidden = {},
  className = "",
  nouns = "条",
}: {
  page: number;
  totalPages: number;
  total: number;
  hrefFor: (page: number) => string;
  /** GET target for the jump form; the current filters ride along as hidden fields. */
  action: string;
  hidden?: Record<string, string | undefined>;
  className?: string;
  nouns?: string;
}) {
  if (totalPages <= 1) return null;
  const current = Math.min(Math.max(page, 1), totalPages);
  const steps = pageWindow(current, totalPages);

  return (
    <nav className={`pager ${className}`.trim()} aria-label={`分页，共 ${totalPages} 页`}>
      <span className="pager-total">
        共 {total} {nouns} · 第 {current} / {totalPages} 页
      </span>
      <div className="pager-controls">
        {current > 1 ? (
          <Link className="pager-btn" href={hrefFor(current - 1)} rel="prev">
            上一页
          </Link>
        ) : (
          <span className="pager-btn is-disabled" aria-disabled="true">
            上一页
          </span>
        )}
        {steps.map((step, index) =>
          step === "gap" ? (
            <span key={`gap-${index}`} className="pager-gap" aria-hidden="true">
              …
            </span>
          ) : step === current ? (
            <span key={step} className="pager-btn is-current" aria-current="page">
              {step}
            </span>
          ) : (
            <Link key={step} className="pager-btn" href={hrefFor(step)}>
              {step}
            </Link>
          ),
        )}
        {current < totalPages ? (
          <Link className="pager-btn" href={hrefFor(current + 1)} rel="next">
            下一页
          </Link>
        ) : (
          <span className="pager-btn is-disabled" aria-disabled="true">
            下一页
          </span>
        )}
      </div>
      <form className="pager-jump" action={action} method="get" role="search">
        {Object.entries(hidden).map(([key, value]) =>
          value ? <input key={key} type="hidden" name={key} value={value} /> : null,
        )}
        <label>
          跳至
          <input
            type="number"
            name="page"
            min={1}
            max={totalPages}
            defaultValue={current}
            aria-label={`跳至页码，共 ${totalPages} 页`}
          />
          页
        </label>
        <button className="pager-btn" type="submit">
          前往
        </button>
      </form>
    </nav>
  );
}
