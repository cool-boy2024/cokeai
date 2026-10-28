const COVER_LABELS: Record<string, string> = {
  chatgpt: "GPT",
  "chatgpt-pro": "GPT",
  claude: "C",
  "claude-max": "C",
  gemini: "G",
  grok: "X",
  neutral: "AI",
};

const COVER_CAPTIONS: Record<string, string> = {
  chatgpt: "OpenAI",
  "chatgpt-pro": "OpenAI",
  claude: "Anthropic",
  "claude-max": "Anthropic",
  gemini: "Google",
  grok: "xAI",
  neutral: "CokeAI",
};

export function ProductCover({
  variant,
  brand,
  className = "",
}: {
  variant?: string | null;
  brand?: string | null;
  className?: string;
}) {
  const key = variant || brand || "neutral";
  const label = COVER_LABELS[key] || COVER_LABELS[brand || ""] || "AI";
  const caption =
    COVER_CAPTIONS[key] || COVER_CAPTIONS[brand || ""] || "CokeAI";
  return (
    <div className={`shop-cover shop-cover-${key} ${className}`.trim()} aria-hidden="true">
      <span className="shop-cover-grid" />
      <span className="shop-cover-label">{label}</span>
      <span className="shop-cover-caption">{caption}</span>
      <span className="shop-cover-orbit" />
    </div>
  );
}
