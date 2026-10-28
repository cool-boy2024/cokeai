import type { Metadata } from "next";
import { Activity, AlertTriangle, CheckCircle2, Gauge, Server } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { adminRequest, getAdminToken } from "@/lib/sub2api/auth";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";

export const metadata: Metadata = { title: "网关" };
export const dynamic = "force-dynamic";

type Group = {
  id: number;
  name: string;
  platform: string;
  status: string;
  rate_multiplier: number;
  model_allowlist?: { enabled: boolean; models?: string[] };
};

export default async function AdminGatewayPage() {
  await requireAdmin();

  let health = "unreachable";
  try {
    const response = await fetch(`${config.sub2apiUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    health = response.ok ? "ok" : `http_${response.status}`;
  } catch {
    health = "unreachable";
  }

  let group: Group | null = null;
  let adminLogin = "not_configured";
  if (isSub2ApiConfigured()) {
    try {
      await getAdminToken();
      adminLogin = "ok";
      group = await adminRequest<Group>(`/api/v1/admin/groups/${config.sub2apiGroupId}`);
    } catch (error) {
      adminLogin = error instanceof Error ? error.message : "failed";
    }
  }

  const [ops, sync] = await Promise.all([
    query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count
         FROM gateway_balance_ops
        WHERE status IN ('pending', 'failed', 'applying')
        GROUP BY status`,
    ),
    query<{
      started_at: string;
      status: string;
      models_updated: number;
      models_paused: number;
    }>(
      `SELECT started_at, status, models_updated, models_paused
         FROM pricing_sync_runs ORDER BY started_at DESC LIMIT 1`,
    ),
  ]);

  const healthy = health === "ok" && adminLogin === "ok";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>网关</h1>
          <p>Sub2API 连接状态与运营读数。</p>
        </div>
        <span className={`badge ${healthy ? "badge-green" : "badge-red"}`}>
          {healthy ? "连接正常" : "需要检查"}
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">网关健康</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {health}
          </div>
          <div className="stat-foot">{config.sub2apiUrl}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">管理员登录</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {adminLogin}
          </div>
          <div className="stat-foot">CokeAI 服务账号</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">分组</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {group?.name || "—"}
          </div>
          <div className="stat-foot">
            {group ? `${group.platform} · ${group.status}` : "未配置"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">分组倍率</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {group?.rate_multiplier ?? "—"}
          </div>
          <div className="stat-foot">应为 1.0（价格已含加价）</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>模型白名单</h2>
              <p>由定价同步自动维护。</p>
            </div>
            <Server size={17} />
          </div>
          <div className="panel-body">
            {group?.model_allowlist?.enabled ? (
              <div className="flex flex-wrap gap-8">
                {(group.model_allowlist.models || []).map((model) => (
                  <span key={model} className="badge mono">
                    {model}
                  </span>
                ))}
              </div>
            ) : (
              <div className="small muted">白名单未启用。</div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>加额度队列</h2>
              <p>支付成功但未到账的补偿队列。</p>
            </div>
            <Activity size={17} />
          </div>
          <div className="panel-body">
            {ops.rows.length === 0 ? (
              <div className="small muted">
                <CheckCircle2 size={14} /> 没有待处理记录。
              </div>
            ) : (
              ops.rows.map((row) => (
                <div key={row.status} className="flex-between mb-8">
                  <span className="small">
                    {row.status === "failed" ? (
                      <AlertTriangle size={13} />
                    ) : (
                      <Gauge size={13} />
                    )}{" "}
                    {row.status}
                  </span>
                  <strong className="small">{row.count}</strong>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="panel mt-16">
        <div className="panel-head">
          <div>
            <h2>最近定价同步</h2>
          </div>
        </div>
        <div className="panel-body">
          {sync.rows[0] ? (
            <div className="flex-between">
              <span className="small muted">{formatDateTime(sync.rows[0].started_at)}</span>
              <span className="small">
                {sync.rows[0].status} · 在售 {sync.rows[0].models_updated} · 暂停{" "}
                {sync.rows[0].models_paused}
              </span>
            </div>
          ) : (
            <div className="small muted">还没有同步记录。</div>
          )}
        </div>
      </section>

      <div className="notice mt-16">
        <Server size={16} />
        <div>
          Sub2API 后台不暴露公网。需要管理上游账号时，请通过 SSH 隧道访问：
          <span className="mono"> ssh -L 18080:127.0.0.1:18080 user@vps</span>，然后打开
          <span className="mono"> http://127.0.0.1:18080</span>。
        </div>
      </div>
    </>
  );
}
