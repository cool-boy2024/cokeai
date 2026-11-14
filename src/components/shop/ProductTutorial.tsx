import type { ShopTutorial } from "@/lib/shop/tutorials";

/**
 * Shows the walkthrough on our own product page. A tutorial may have a video,
 * written steps, or both; Muse is text-only so the section stays honest about
 * what the buyer is looking at.
 */
export function ProductTutorial({ tutorial }: { tutorial: ShopTutorial }) {
  return (
    <section className="shop-section shop-tutorial" aria-labelledby="shop-tutorial-title">
      <h2 id="shop-tutorial-title">
        {tutorial.video ? "视频教程" : "操作步骤"} · {tutorial.title}
      </h2>

      {tutorial.video ? (
        <div className="shop-tutorial-media">
          <video
            controls
            playsInline
            preload="metadata"
            poster={tutorial.poster}
            aria-label={`${tutorial.title}操作演示`}
          >
            <source src={tutorial.video} type="video/mp4" />
            您的浏览器不支持视频播放，请按下方文字步骤操作。
          </video>
        </div>
      ) : null}
      <p className="shop-tutorial-caption">{tutorial.caption}</p>

      <ol className="shop-tutorial-steps">
        {tutorial.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
