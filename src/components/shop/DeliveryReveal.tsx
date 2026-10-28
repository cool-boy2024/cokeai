"use client";

import { useState, useTransition } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { revealShopDeliveryAction } from "@/app/actions/shop";

export function DeliveryReveal({
  orderId,
  delivered,
}: {
  orderId: string;
  delivered: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [payload, setPayload] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");

  if (!delivered) {
    return (
      <div className="shop-delivery-pending">
        <span>交付内容将在完成后显示</span>
        <small>发货后页面会自动更新</small>
      </div>
    );
  }

  function reveal() {
    if (payload) {
      setPayload(null);
      return;
    }
    startTransition(async () => {
      const result = await revealShopDeliveryAction(orderId);
      if (!result.ok) {
        setError(result.error || "查看失败");
        return;
      }
      setError("");
      setPayload(result.payload || {});
    });
  }

  return (
    <div className="shop-delivery">
      <button className="btn btn-dark btn-sm" type="button" onClick={reveal} disabled={pending}>
        {payload ? <EyeSlash size={14} /> : <Eye size={14} />}
        {pending ? "正在解密…" : payload ? "隐藏内容" : "查看交付内容"}
      </button>
      {error ? <div className="shop-form-error">{error}</div> : null}
      {payload ? (
        <div className="shop-delivery-box">
          {Object.entries(payload).map(([key, value]) => (
            <div className="shop-delivery-row" key={key}>
              <span>{key}</span>
              <code>{value || "—"}</code>
            </div>
          ))}
          <small>查看记录已保存。请尽快保存到安全位置。</small>
        </div>
      ) : null}
    </div>
  );
}
