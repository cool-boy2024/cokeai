"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelShopOrderAction } from "@/app/actions/shop";

/**
 * 客户取消待支付订单。
 *
 * 之前客户下错单、改主意时没有任何出口——订单页只有「去支付」，后台也没有
 * 取消按钮，只能干等 30 分钟过期。这里补上。
 *
 * 取消是不可逆的（订单变「已取消」，不能再付款），所以先要一次确认。
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-light btn-block"
        onClick={() => setConfirming(true)}
      >
        取消这个订单
      </button>
    );
  }

  return (
    <div className="shop-cancel-order">
      <p>取消后订单会关闭，不能再付款。确定要取消吗？</p>
      {error ? <div className="shop-form-error">{error}</div> : null}
      <div className="shop-cancel-order-actions">
        <button
          type="button"
          className="btn btn-danger"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const result = await cancelShopOrderAction(orderId);
              if (result.ok) {
                router.refresh();
                return;
              }
              setError(result.error || "取消失败，请稍后重试");
            });
          }}
        >
          {pending ? "取消中…" : "确认取消"}
        </button>
        <button
          type="button"
          className="btn btn-light"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setError("");
          }}
        >
          再想想
        </button>
      </div>
    </div>
  );
}
