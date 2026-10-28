"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  Clock,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react";

type StatusPayload = {
  orderStatus: "pending" | "paid" | "cancelled" | "refunded";
  depositStatus: string | null;
  receivedUsdt: number;
  confirmations: number;
  expiresAt: string | null;
  txid: string | null;
};

function remaining(expiresAt: string | null, now: number): string {
  if (!expiresAt) return "—";
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return "已过期";
  const minutes = Math.floor(diff / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function UsdtPaymentStatus({
  orderId,
  expiresAt,
  initialStatus,
  initialConfirmations,
  initialReceived,
  initialTxid,
  requiredConfirmations = 19,
}: {
  orderId: string;
  expiresAt: string | null;
  initialStatus: string;
  initialConfirmations: number;
  initialReceived: number;
  initialTxid: string | null;
  requiredConfirmations?: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [confirmations, setConfirmations] = useState(initialConfirmations);
  const [received, setReceived] = useState(initialReceived);
  const [txid, setTxid] = useState(initialTxid);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const cancelRequested = useRef(false);

  const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false;
  const statusText = useMemo(() => {
    if (status === "confirmed") return "已到账";
    if (status === "overpaid") return "已到账（多付）";
    if (status === "partial") return "金额不足，等待补付";
    if (status === "confirming") return "区块确认中";
    if (status === "expired") return "订单已过期";
    if (status === "manual") return "等待人工处理";
    return "等待转账";
  }, [status]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!expired || cancelRequested.current) return;
    if (received > 0) return;
    if (!["waiting", "expired"].includes(status)) return;
    cancelRequested.current = true;
    void fetch("/api/dashboard/usdt-expire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    })
      .then(() => router.refresh())
      .catch(() => {
        // The five minute scanner will retry the fallback cleanup.
      });
  }, [expired, received, status, orderId, router]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(
          `/api/dashboard/usdt-status?orderId=${encodeURIComponent(orderId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as StatusPayload;
        if (cancelled) return;
        setStatus(data.depositStatus || "waiting");
        setConfirmations(data.confirmations);
        setReceived(data.receivedUsdt);
        setTxid(data.txid);
        setError(null);
        if (data.orderStatus !== "pending") {
          router.refresh();
        }
      } catch {
        if (!cancelled) setError("状态查询失败，稍后自动重试");
      }
    }
    void poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orderId, router]);

  return (
    <div style={{ marginTop: 20 }}>
      <div className="flex-between">
        <span className="small muted">
          <Clock size={14} /> 剩余支付时间
        </span>
        <strong className="small">{expired ? "已超时" : remaining(expiresAt, now)}</strong>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        {expired
          ? "支付时限已到，订单会自动取消。若已链上转账，请联系客服核对。"
          : "请在倒计时结束前完成转账，超时未到账会自动取消订单。"}
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        {status === "confirmed" || status === "overpaid" ? (
          <CheckCircle size={16} />
        ) : status === "partial" ? (
          <Warning size={16} />
        ) : (
          <CircleNotch size={16} className="spin" />
        )}
        <div>
          {statusText}
          {status === "confirming"
            ? ` · ${confirmations}/${requiredConfirmations}`
            : null}
          {received > 0 && status !== "confirmed" ? ` · 已收到 ${received} USDT` : null}
          {error ? <div className="small muted">{error}</div> : null}
        </div>
      </div>

      {txid ? (
        <div className="small muted mono" style={{ marginTop: 12, wordBreak: "break-all" }}>
          txid: {txid}
        </div>
      ) : null}
    </div>
  );
}
