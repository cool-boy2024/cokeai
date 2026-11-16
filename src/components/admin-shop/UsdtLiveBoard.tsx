"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 加密货币到账实时看板。
 *
 * 每 3 秒拉一次 /api/admin/shop/usdt/live，新到的转账会闪一下。「立即扫描」
 * 直接触发一次链上查询，不用等 n8n 的下一轮。
 *
 * 速度的物理上限在链上：BSC/Polygon 出块 2–3 秒，但订单要等够确认数才自动
 * 入账，所以「看到钱」是秒级，「可发货」仍要等确认数——这里把两者分开显示，
 * 避免运营误以为收了钱就能立刻发。
 */

export type LiveDeposit = {
  id: string;
  network: string;
  network_label: string;
  order_no: string;
  product_name: string | null;
  email: string;
  expected_usdt: number;
  received_usdt: number;
  confirmations: number;
  required_confirmations: number;
  status: string;
  txid: string | null;
  address: string;
  updated_at: string;
};

export type LivePayload = {
  deposits: LiveDeposit[];
  summary: { today_usdt: number; pending: number; confirming: number; manual: number };
};

const STATUS_LABEL: Record<string, string> = {
  waiting: "等待到账",
  partial: "部分到账",
  confirming: "确认中",
  confirmed: "已确认",
  overpaid: "超额到账",
  expired: "已过期",
  manual: "需人工",
};

const POLL_MS = 3000;
const FLASH_MS = 8000;

function usdt(value: number): string {
  return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

export function UsdtLiveBoard({ initial }: { initial: LivePayload }) {
  const [data, setData] = useState<LivePayload>(initial);
  const [pending, setPending] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState<number>(() => Date.now());
  const known = useRef<Set<string>>(new Set(initial.deposits.map((row) => row.id)));
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const apply = useCallback((payload: LivePayload) => {
    const arrived: string[] = [];
    for (const row of payload.deposits) {
      if (!known.current.has(row.id)) {
        known.current.add(row.id);
        arrived.push(row.id);
      }
    }
    setData(payload);
    setLastUpdated(Date.now());
    if (arrived.length > 0) {
      setFresh((prev) => new Set([...prev, ...arrived]));
      for (const id of arrived) {
        const timer = setTimeout(() => {
          setFresh((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          flashTimers.current.delete(id);
        }, FLASH_MS);
        flashTimers.current.set(id, timer);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/shop/usdt/live", { cache: "no-store" });
      if (!response.ok) return;
      apply((await response.json()) as LivePayload);
    } catch {
      // 网络抖动就跳过这一轮，下一轮继续。
    }
  }, [apply]);

  const scanNow = useCallback(async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/shop/usdt/live", {
        method: "POST",
        cache: "no-store",
      });
      if (response.ok) apply((await response.json()) as LivePayload);
    } catch {
      // 同上
    } finally {
      setPending(false);
    }
  }, [apply]);

  useEffect(() => {
    const poll = setInterval(() => void refresh(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const timers = flashTimers.current;
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [refresh]);

  const secondsAgo = Math.max(0, Math.round((now - lastUpdated) / 1000));

  const stats = [
    { label: "今日到账", value: `${usdt(data.summary.today_usdt)} USDT`, tone: "green" },
    { label: "等待到账", value: data.summary.pending, tone: "muted" },
    { label: "确认中", value: data.summary.confirming, tone: "amber" },
    { label: "需人工", value: data.summary.manual, tone: "red" },
  ];

  return (
    <section className="panel mb-16">
      <div className="panel-head">
        <div>
          <h2>实时到账</h2>
          <p>
            每 3 秒自动刷新 · {secondsAgo} 秒前更新。
            「立即扫描」会直接查一次链，不用等定时任务。
          </p>
        </div>
        <button className="btn btn-sm btn-dark" type="button" onClick={scanNow} disabled={pending}>
          {pending ? "扫描中…" : "立即扫描"}
        </button>
      </div>

      <div className="panel-body">
        <div className="flex flex-wrap gap-8 mb-16">
          {stats.map((item) => (
            <div
              key={item.label}
              style={{
                flex: "1 1 140px",
                border: "1px solid var(--border, #e5e5e5)",
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              <div className="muted small">{item.label}</div>
              <strong
                style={{
                  fontSize: 20,
                  color:
                    item.tone === "green"
                      ? "#137a3f"
                      : item.tone === "red"
                        ? "#b42318"
                        : item.tone === "amber"
                          ? "#a15c00"
                          : undefined,
                }}
              >
                {item.value}
              </strong>
            </div>
          ))}
        </div>

        {data.deposits.length === 0 ? (
          <div className="empty">还没有 USDT 充值记录。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>网络</th>
                  <th>订单</th>
                  <th>到账 / 应付</th>
                  <th>确认数</th>
                  <th>状态</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {data.deposits.map((row) => {
                  const isFresh = fresh.has(row.id);
                  const progress =
                    row.required_confirmations > 0
                      ? Math.min(100, (row.confirmations / row.required_confirmations) * 100)
                      : 0;
                  return (
                    <tr
                      key={row.id}
                      style={{
                        background: isFresh ? "rgba(19,122,63,0.08)" : undefined,
                        transition: "background 0.6s ease",
                      }}
                    >
                      <td className="nowrap small">{row.network_label}</td>
                      <td className="small">
                        <a className="mono" href={`/admin/shop/orders/${row.order_no}`}>
                          {row.order_no}
                        </a>
                        <div className="muted">
                          {row.product_name || "—"} · {row.email}
                        </div>
                      </td>
                      <td className="nowrap">
                        <strong style={{ color: row.received_usdt > 0 ? "#137a3f" : undefined }}>
                          {usdt(row.received_usdt)}
                        </strong>
                        <span className="muted"> / {usdt(row.expected_usdt)}</span>
                      </td>
                      <td className="nowrap small">
                        <div>{row.confirmations} / {row.required_confirmations}</div>
                        <div
                          style={{
                            height: 4,
                            borderRadius: 2,
                            background: "rgba(0,0,0,0.08)",
                            marginTop: 4,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${progress}%`,
                              height: "100%",
                              background: "#137a3f",
                            }}
                          />
                        </div>
                      </td>
                      <td className="nowrap small">{STATUS_LABEL[row.status] || row.status}</td>
                      <td className="nowrap muted small">
                        {isFresh ? <span className="badge badge-green">新到账</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
