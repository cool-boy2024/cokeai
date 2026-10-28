"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "@phosphor-icons/react";

function remainingLabel(diff: number): string {
  if (diff <= 0) return "已超时";
  const minutes = Math.floor(diff / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ShopUsdtCountdown({
  orderId,
  expiresAt,
}: {
  orderId: string;
  expiresAt: string;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const expireRequested = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const diff = now === null ? null : new Date(expiresAt).getTime() - now;
  const expired = diff !== null && diff <= 0;

  useEffect(() => {
    if (!expired || expireRequested.current) return;
    expireRequested.current = true;
    void fetch("/api/shop/usdt-expire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    })
      .then(() => router.refresh())
      .catch(() => {
        // The server-side cleanup retries every five minutes.
      });
  }, [expired, orderId, router]);

  return (
    <div className={`shop-usdt-timer${expired ? " is-expired" : ""}`}>
      <span>
        <Clock size={14} /> {expired ? "支付已超时，订单正在关闭" : "支付剩余时间"}
      </span>
      <strong>{diff === null ? "--:--" : remainingLabel(diff)}</strong>
    </div>
  );
}
