import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, KeyRound, LockKeyhole } from "lucide-react";
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
  created_at: string;
};

export default async function KeysPage() {
  const user = await requireUser();
  const result = await query<KeyRow>(
    `SELECT id, name, key_prefix, last_used_at, revoked_at, created_at
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
          <p>为每个项目创建独立凭证，按需撤销，避免共用一把万能钥匙。</p>
        </div>
        <div className="page-head-actions">
          <span className="badge badge-dark">
            {activeCount} / {config.maxActiveApiKeys} 可用
          </span>
        </div>
      </div>

      {!user.plan_active ? (
        <div className="notice">
          <AlertTriangle size={16} />
          <div>
            你还没有生效中的套餐。Key 可以创建，但调用 API 前需要先
            <Link className="text-link" href="/dashboard/billing"> 购买套餐</Link>。
          </div>
        </div>
      ) : null}

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>创建一个新 Key</h2>
            <p>明文只显示一次，请立即保存。</p>
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
            <p>平台仅保存哈希，无法找回或显示完整 Key。</p>
          </div>
          <span className="badge">{result.rows.length} 条记录</span>
        </div>
        {result.rows.length === 0 ? (
          <div className="empty">还没有 API Key，请在上方创建。</div>
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
                {result.rows.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td>
                      <span className="mono small">{key.key_prefix}</span>
                    </td>
                    <td className="mono small nowrap">{formatDateTime(key.created_at)}</td>
                    <td className="mono small nowrap">
                      {key.last_used_at ? formatDateTime(key.last_used_at) : "尚未使用"}
                    </td>
                    <td>
                      <span
                        className={`badge ${key.revoked_at ? "badge-red" : "badge-green"}`}
                      >
                        {key.revoked_at ? "已撤销" : "可用"}
                      </span>
                    </td>
                    <td className="text-right">
                      {key.revoked_at ? (
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2 mt-16">
        <div className="admin-form-card">
          <div className="flex-between mb-12">
            <h3 style={{ margin: 0 }}>
              <LockKeyhole size={14} /> 安全建议
            </h3>
          </div>
          <ul className="check-list" style={{ margin: 0 }}>
            <li>Key 放入服务器环境变量，不提交到 Git 仓库。</li>
            <li>不同项目使用不同 Key，便于撤销和归因。</li>
            <li>怀疑泄露时立即撤销，不要尝试“先观察一下”。</li>
          </ul>
        </div>
        <div className="admin-form-card">
          <h3>
            <KeyRound size={14} /> 接入地址
          </h3>
          <div className="invite-box" style={{ marginTop: 0 }}>
            <input className="input" readOnly value={baseUrl} />
            <CopyButton value={baseUrl} />
          </div>
          <p className="small muted mt-12 mb-0">
            所有 API 请求使用 <span className="mono">Authorization: Bearer &lt;key&gt;</span>。
          </p>
        </div>
      </div>
    </>
  );
}
