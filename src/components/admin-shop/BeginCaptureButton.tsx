"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";

type Gate = { enabled: boolean; depth: number; min: number };

/**
 * One-click "去采购" for the procurement queue. Only visible while the
 * capture helper is gated on (pending orders >= SHOP_CAPTURE_MIN_QUEUE).
 * Marks the order as waiting for the helper, then opens the supplier page in
 * a new tab — the operator's only manual step is paying at the supplier.
 */
export function BeginCaptureButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [gate, setGate] = useState<Gate | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/shop/capture/enabled", {
      method: "POST",
      headers: { "x-cokeai-capture": "1" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Gate | null) => {
        if (alive && data) setGate(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const begin = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/shop/capture/begin", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cokeai-capture": "1" },
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { supplierUrl?: string | null; orderNo?: string; error?: string }
        | null;
      if (!res.ok || !data) {
        setMessage(data?.error || "开始采购失败");
        return;
      }
      if (data.supplierUrl) {
        window.open(data.supplierUrl, "_blank", "noopener");
      }
      setMessage(
        data.supplierUrl
          ? "已等待扩展回填（30 分钟）。在供货商付款后，助手会自动取回卡密。"
          : "已标记等待回填，但这一单没有绑定货源链接，请从订单详情打开。",
      );
      router.refresh();
    } catch {
      setMessage("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }, [orderId, router]);

  if (gate && !gate.enabled) {
    return (
      <span className="badge badge-dark" title={`待采购 ${gate.depth} 单，门槛 ${gate.min} 单`}>
        自动回填未启用 {gate.depth}/{gate.min}
      </span>
    );
  }

  return (
    <div className="capture-begin">
      <button
        type="button"
        className="btn btn-dark btn-sm"
        disabled={busy}
        onClick={begin}
        title="标记等待回填并打开供货商页面"
      >
        <Zap size={13} /> {busy ? "处理中…" : "开始采购（自动回填）"}
      </button>
      {message ? <span className="capture-begin-note">{message}</span> : null}
    </div>
  );
}
