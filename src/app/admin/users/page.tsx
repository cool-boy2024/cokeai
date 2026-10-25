import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Search, Users } from "lucide-react";
import { adjustBalanceAction, updateUserStatusAction } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatFullDate, formatNumber } from "@/lib/format";
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
  plan_name: string | null;
  plan_expires_at: string | null;
  referral_code: string;
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
  const admin = await requireAdmin();
  const params = await searchParams;
  const q = (params.q || "").trim().slice(0, 80);

  const [usersResult, adjustmentsResult] = await Promise.all([
    query<UserRow>(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.balance_micros,
              p.name AS plan_name, u.plan_expires_at, u.referral_code, u.created_at,
              (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS key_count
         FROM users u
         LEFT JOIN plans p ON p.id = u.plan_id
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
          <p>停用账户会立即阻止新的 API 调用；调整余额会写入独立审计账本。</p>
        </div>
        <span className="badge badge-dark">
          <Users size={12} /> {formatNumber(usersResult.rows.length)} 位用户
        </span>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>用户资料已更新。</div>
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
            <p>当前管理员：{admin.email}。最多显示 200 条。</p>
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
                  <th>角色</th>
                  <th>余额</th>
                  <th>套餐</th>
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
                      <div className="small">{user.email}</div>
                      <div className="small muted" style={{ fontSize: 9 }}>
                        {user.name} · 邀请码 {user.referral_code}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${user.role === "admin" ? "badge-red" : ""}`}>
                        {user.role === "admin" ? "管理员" : "用户"}
                      </span>
                    </td>
                    <td className="mono small">{formatCny(user.balance_micros)}</td>
                    <td>
                      <div className="small">{user.plan_name || "未激活"}</div>
                      <div className="small muted" style={{ fontSize: 9 }}>
                        {user.plan_expires_at
                          ? `${formatFullDate(user.plan_expires_at)} 到期`
                          : "—"}
                      </div>
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
                        <summary>管理账户</summary>
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
                              <label>调整原因</label>
                              <input
                                className="input"
                                name="note"
                                required
                                maxLength={200}
                                placeholder="工单号 / 退款 / 补偿"
                              />
                            </div>
                          </div>
                          <button className="btn btn-dark btn-sm" type="submit">
                            写入余额调整
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
            <h2>余额调整审计</h2>
            <p>最近 20 条管理员手工调账记录，不可在后台删除。</p>
          </div>
        </div>
        {adjustmentsResult.rows.length === 0 ? (
          <div className="empty">暂无手工调整记录。</div>
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
