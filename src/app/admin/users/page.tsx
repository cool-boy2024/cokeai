import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Search, Users } from "lucide-react";
import { adjustBalanceAction, updateUserStatusAction } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "用户管理" };
export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  balance_micros: string;
  sub2api_user_id: string | null;
  created_at: string;
  key_count: string;
};

type AdjustmentRow = {
  id: string;
  amount_micros: string;
  note: string;
  created_at: string;
  user_email: string;
  admin_email: string;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = (params.q || "").trim().slice(0, 80);

  const [usersResult, adjustmentsResult] = await Promise.all([
    query<UserRow>(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.balance_micros,
              gi.sub2api_user_id, u.created_at,
              (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS key_count
         FROM users u
         LEFT JOIN gateway_identities gi ON gi.user_id = u.id
        WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%')
        ORDER BY u.created_at DESC
        LIMIT 200`,
      [q],
    ),
    query<AdjustmentRow>(
      `SELECT b.id, b.amount_micros, b.note, b.created_at,
              u.email AS user_email, a.email AS admin_email
         FROM balance_adjustments b
         JOIN users u ON u.id = b.user_id
         JOIN users a ON a.id = b.admin_id
        ORDER BY b.created_at DESC
        LIMIT 20`,
    ),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>用户管理</h1>
          <p>停用立即阻止调用；额度调整经网关队列同步。</p>
        </div>
        <span className="badge badge-dark">
          <Users size={12} /> {formatNumber(usersResult.rows.length)} 位用户
        </span>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>操作已完成。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}

      <form className="invite-box mb-16" action="/admin/users" method="get">
        <input
          className="input"
          name="q"
          defaultValue={q}
          placeholder="按邮箱或昵称搜索"
          maxLength={80}
        />
        <button className="btn btn-dark btn-sm" type="submit">
          <Search size={13} /> 搜索
        </button>
      </form>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>用户列表</h2>
          </div>
        </div>
        {usersResult.rows.length === 0 ? (
          <div className="empty">没有匹配的用户。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>人民币额度</th>
                  <th>网关 ID</th>
                  <th>Key</th>
                  <th>注册时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {usersResult.rows.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="small">
                        {user.email}{" "}
                        {user.role === "admin" ? (
                          <span className="badge badge-red">管理员</span>
                        ) : null}
                      </div>
                      <div className="small muted" style={{ fontSize: 9 }}>
                        {user.name}
                      </div>
                    </td>
                    <td className="mono small">{formatCny(user.balance_micros)}</td>
                    <td>
                      {user.sub2api_user_id ? (
                        <span className="mono small">{user.sub2api_user_id}</span>
                      ) : (
                        <span className="small muted">—</span>
                      )}
                    </td>
                    <td className="mono small">{formatNumber(user.key_count)}</td>
                    <td className="mono small nowrap">{formatDateTime(user.created_at)}</td>
                    <td>
                      <span
                        className={`badge ${
                          user.status === "active" ? "badge-green badge-dot" : "badge-red"
                        }`}
                      >
                        {user.status === "active" ? "正常" : "已停用"}
                      </span>
                    </td>
                    <td>
                      <details className="admin-details">
                        <summary>管理</summary>
                        <form action={adjustBalanceAction} className="form-stack">
                          <input type="hidden" name="userId" value={user.id} />
                          <div className="form-row">
                            <div className="field">
                              <label>调整金额（元，可为负）</label>
                              <input
                                className="input"
                                name="amountYuan"
                                type="number"
                                step="0.01"
                                required
                                placeholder="例如 10 或 -5"
                              />
                            </div>
                            <div className="field">
                              <label>原因</label>
                              <input
                                className="input"
                                name="note"
                                required
                                maxLength={200}
                                placeholder="工单 / 退款 / 补偿"
                              />
                            </div>
                          </div>
                          <button className="btn btn-dark btn-sm" type="submit">
                            提交调整
                          </button>
                        </form>
                        <form action={updateUserStatusAction} className="mt-12">
                          <input type="hidden" name="userId" value={user.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={user.status === "active" ? "disabled" : "active"}
                          />
                          <button
                            className={`btn btn-sm ${
                              user.status === "active" ? "btn-danger" : "btn-ghost"
                            }`}
                            type="submit"
                          >
                            {user.status === "active" ? "停用账户" : "恢复账户"}
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>最近调账</h2>
          </div>
          <span className="badge">{adjustmentsResult.rows.length} 条</span>
        </div>
        {adjustmentsResult.rows.length === 0 ? (
          <div className="empty">暂无调整记录。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>金额</th>
                  <th>原因</th>
                  <th>操作人</th>
                </tr>
              </thead>
              <tbody>
                {adjustmentsResult.rows.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td className="mono small nowrap">
                      {formatDateTime(adjustment.created_at)}
                    </td>
                    <td className="small">{adjustment.user_email}</td>
                    <td className="mono small">
                      {formatCny(adjustment.amount_micros)}
                    </td>
                    <td className="small">{adjustment.note}</td>
                    <td className="small muted">{adjustment.admin_email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
