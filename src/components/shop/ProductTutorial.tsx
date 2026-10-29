import type { ShopTutorial } from "@/lib/shop/tutorials";

/**
 * Plays the walkthrough from our own origin, so buyers do not have to visit the
 * supplier's site to understand the product.
 */
export function ProductTutorial({ tutorial }: { tutorial: ShopTutorial }) {
  return (
    <section className="shop-section shop-tutorial" aria-labelledby="shop-tutorial-title">
      <h2 id="shop-tutorial-title">视频教程 · {tutorial.title}</h2>

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
      <p className="shop-tutorial-caption">{tutorial.caption}</p>

      <ol className="shop-tutorial-steps">
        {tutorial.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
