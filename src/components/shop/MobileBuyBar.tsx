"use client";

import { useEffect, useState } from "react";

/**
 * 移动端吸底购买栏。
 *
 * 390px 宽的商品页里，购买面板排在封面、标题、商品介绍、帮助链接、重点注意
 * 事项之后——实测顶部在 1537px，买家要滚将近两屏才看到价格和「购买」。这条
 * 底栏沿用同一套价格文案，滚动到购买面板后自动隐藏，避免遮住真正的按钮。
 *
 * 只在 680px 以下显示（CSS 控制），桌面端不渲染任何可见内容。
 */
export function MobileBuyBar({
  priceLabel,
  soldOutLabel,
  available,
  variantNote,
}: {
  priceLabel: string;
  /** 售罄或补货中时的替代文案；null 表示可以买。 */
  soldOutLabel: string | null;
  available: boolean;
  /** 规格提示，例如「多样规格可选」。 */
  variantNote?: string;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const panel = document.querySelector(".shop-buy-panel");
    if (!panel) return;
    // 购买面板进入视口就收起底栏，让买家操作真正的购买按钮。
    const observer = new IntersectionObserver(
      ([entry]) => setHidden(entry?.isIntersecting ?? false),
      { rootMargin: "0px 0px -20% 0px", threshold: 0.05 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const onBuy = () => {
    document
      .querySelector(".shop-buy-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div
      className={`shop-mobile-buy${hidden ? " is-hidden" : ""}`}
      aria-hidden={hidden}
    >
      <div className="shop-mobile-buy-price">
        <strong>{priceLabel}</strong>
        <span>{available ? variantNote || "现货" : soldOutLabel || "补货中"}</span>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        tabIndex={hidden ? -1 : 0}
        onClick={onBuy}
      >
        {available ? "购买" : "查看详情"}
      </button>
    </div>
  );
}
