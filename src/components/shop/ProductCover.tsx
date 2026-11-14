import { shopImageSrcSet, shopImageVariant } from "@/lib/shop/media-url";

const COVER_WIDTHS = [320, 640, 960] as const;

const COVER_LABELS: Record<string, string> = {
  chatgpt: "GPT",
  "chatgpt-pro": "GPT",
  claude: "C",
  "claude-max": "C",
  gemini: "G",
  grok: "X",
  muse: "M",
  "codex-sms": "SMS",
  neutral: "AI",
};

const COVER_CAPTIONS: Record<string, string> = {
  chatgpt: "OpenAI",
  "chatgpt-pro": "OpenAI",
  claude: "Anthropic",
  "claude-max": "Anthropic",
  gemini: "Google",
  grok: "xAI",
  muse: "Muse AI",
  "muse-supplier": "Muse AI",
  "codex-sms": "Codex 接码",
  neutral: "CokeAI",
};

/** Image covers. Supplier covers are used only where the image is the source. */
const COVER_IMAGES: Record<string, string> = {
  "muse-supplier": "/shop/muse-supplier.jpg",
  "codex-sms": "/shop/codex-sms-cover.png",
};

export function ProductCover({
  variant,
  brand,
  imageUrl,
  className = "",
  sizes = "(max-width: 680px) 46vw, 320px",
}: {
  variant?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  className?: string;
  sizes?: string;
}) {
  if (imageUrl) {
    const src = shopImageVariant(imageUrl, 640);
    const srcSet = shopImageSrcSet(imageUrl, COVER_WIDTHS);
    return (
      <div
        className={`shop-cover shop-cover-image ${className}`.trim()}
        aria-hidden="true"
      >
        <img
          src={src ?? imageUrl}
          srcSet={srcSet}
          sizes={sizes}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  }

  const key = variant || brand || "neutral";
  const image = COVER_IMAGES[key];
  if (image) {
    return (
      <div
        className={`shop-cover shop-cover-image ${className}`.trim()}
        aria-hidden="true"
      >
        <img src={image} alt="" loading="lazy" decoding="async" />
      </div>
    );
  }

  const label = COVER_LABELS[key] || COVER_LABELS[brand || ""] || "AI";
  const caption =
    COVER_CAPTIONS[key] || COVER_CAPTIONS[brand || ""] || "CokeAI";
  return (
    <div className={`shop-cover shop-cover-${key} ${className}`.trim()} aria-hidden="true">
      <span className="shop-cover-grid" />
      {key === "muse" ? (
        <img
          className="shop-cover-label shop-cover-muse-mark"
          src="/brand/muse-logo.svg"
          alt=""
          width={72}
          height={72}
        />
      ) : (
        <span className="shop-cover-label">{label}</span>
      )}
      <span className="shop-cover-caption">{caption}</span>
      <span className="shop-cover-orbit" />
    </div>
  );
}
