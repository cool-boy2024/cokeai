"use client";

import { useState } from "react";

/**
 * Keeps the supplier copy in the DOM exactly as written, but on phones clamps
 * long descriptions to a fixed number of lines until the buyer expands them.
 * The desktop layout is untouched: CSS only applies the clamp under 720px.
 */
export function ExpandableText({
  text,
  className = "",
  threshold = 220,
}: {
  text: string;
  className?: string;
  threshold?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (text.length <= threshold) {
    return <p className={className}>{text}</p>;
  }

  return (
    <div className={`shop-expandable${expanded ? " is-expanded" : ""}`}>
      <p className={`${className} shop-expandable-text`.trim()}>{text}</p>
      <button
        type="button"
        className="shop-expand-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "收起" : "展开全部"}
      </button>
    </div>
  );
}
