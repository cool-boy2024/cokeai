import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { revokeKeyAction } from "@/app/actions/keys";
import { CopyButton } from "@/components/CopyButton";
import { KeyManager } from "@/components/KeyManager";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "API Key" };
export const dynamic = "force-dynamic";

type KeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  sync_state: string;
  created_at: string;
};

function statusOf(key: KeyRow): { label: string; className: string } {
  if (key.revoked_at) return { label: "已撤销", className: "badge-red" };
  if (key.sync_state === "revoke_pending") return { label: "撤销中", className: "badge-yellow" };
  if (key.sync_state === "active") return { label: "可用", className: "badge-green" };
  if (key.sync_state === "pending") return { label: "同步中", className: "badge-yellow" };
  return { label: "待迁移", className: "badge-yellow" };
}

export default async function KeysPage() {
  const user = await requireUser();
  const result = await query<KeyRow>(
    `SELECT id, name, key_prefix, last_used_at, revoked_at, sync_state, created_at
       FROM api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [user.id],
  );

  const activeCount = result.rows.filter((key) => !key.revoked_at).length;
  const baseUrl = `${config.appUrl}/v1`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>API Key</h1>
          <p>创建、复制和撤销你的访问凭证。</p>
        </div>
        <div className="page-head-actions">
          <span className="badge badge-dark">
            {activeCount} / {config.maxActiveApiKeys} 可用
          </span>
        </div>
      </div>

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>创建 Key</h2>
            <p>Key 仅显示一次。</p>
          </div>
          <KeyRound size={17} />
        </div>
        <div className="panel-body">
          <KeyManager />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>全部 Key</h2>
          </div>
          <span className="badge">{result.rows.length} 条</span>
        </div>
        {result.rows.length === 0 ? (
          <div className="empty">还没有 API Key。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>Key</th>
                  <th>创建时间</th>
                  <th>最近使用</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((key) => {
                  const status = statusOf(key);
                  return (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td>
                        <span className="mono small">{key.key_prefix}</span>
                      </td>
                      <td className="mono small nowrap">
                        {formatDateTime(key.created_at)}
                      </td>
                      <td className="mono small nowrap">
                        {key.last_used_at ? formatDateTime(key.last_used_at) : "尚未使用"}
                      </td>
                      <td>
                        <span className={`badge ${status.className}`}>{status.label}</span>
                      </td>
                      <td className="text-right">
                        {key.revoked_at || key.sync_state === "revoke_pending" ? (
                          <span className="small muted">—</span>
                        ) : (
                          <form action={revokeKeyAction}>
                            <input type="hidden" name="id" value={key.id} />
                            <button className="btn btn-danger btn-sm" type="submit">
                              撤销
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel mt-16">
        <div className="panel-head">
          <h2>接入地址</h2>
        </div>
        <div className="panel-body">
          <div className="invite-box">
            <input className="input mono" readOnly value={baseUrl} />
            <CopyButton value={baseUrl} />
          </div>
          <p className="small muted mt-12 mb-0">
            请求头：<span className="mono">Authorization: Bearer &lt;key&gt;</span>
          </p>
        </div>
      </section>
    </>
  );
}
