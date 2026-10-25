import type { Metadata } from "next";
import { Gift, Info, Users } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, toNumber } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "推荐奖励" };
export const dynamic = "force-dynamic";

type CommissionRow = {
  id: string;
  amount_micros: string;
  status: string;
  available_at: string;
  created_at: string;
  buyer_email: string;
  order_amount_micros: string;
  order_status: string;
};

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

export default async function ReferralsPage() {
  const user = await requireUser();
  const referralUrl = `${config.appUrl}/register?ref=${user.referral_code}`;
  const supportEmail = process.env.SUPPORT_EMAIL || "support@cokeai.cc.cd";

  const [commissionsResult, referredResult] = await Promise.all([
    query<CommissionRow>(
      `SELECT c.id, c.amount_micros, c.status, c.available_at, c.created_at,
              u.email AS buyer_email, o.amount_micros AS order_amount_micros,
              o.status AS order_status
         FROM commissions c
         JOIN orders o ON o.id = c.order_id
         JOIN users u ON u.id = c.buyer_id
        WHERE c.referrer_id = $1
        ORDER BY c.created_at DESC
        LIMIT 100`,
      [user.id],
    ),
    query<{ total: string; activated: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE plan_id IS NOT NULL) AS activated
         FROM users
        WHERE referred_by = $1`,
      [user.id],
    ),
  ]);

  const totals = commissionsResult.rows.reduce(
    (acc, row) => {
      const amount = toNumber(row.amount_micros);
      if (row.status === "pending") acc.pending += amount;
      if (row.status === "available") acc.available += amount;
      if (row.status === "paid") acc.paid += amount;
      return acc;
    },
    { pending: 0, available: 0, paid: 0 },
  );

  const referred = referredResult.rows[0];

  const statusLabel = (status: string) => {
    switch (status) {
      case "available":
        return { label: "可结算", className: "badge-green" };
      case "paid":
        return { label: "已结算", className: "badge-dark" };
      case "reversed":
        return { label: "已冲回", className: "badge-red" };
      default:
        return { label: "观察期", className: "badge-yellow" };
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>推荐奖励</h1>
          <p>
            每次通过你的链接完成的有效付费订单，可获得 {config.commissionBps / 100}%{" "}
            奖励。单层推荐，不做多级分销。
          </p>
        </div>
        <span className="badge badge-dark">
          <Gift size={12} /> 邀请码 {user.referral_code}
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">累计已结算</div>
          <div className="stat-value">{formatCny(totals.paid)}</div>
          <div className="stat-foot">平台已完成线下结算</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">可结算</div>
          <div className="stat-value">{formatCny(totals.available)}</div>
          <div className="stat-foot">已过退款观察期</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">观察期</div>
          <div className="stat-value">{formatCny(totals.pending)}</div>
          <div className="stat-foot">{config.commissionHoldDays} 天后可结算</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">邀请用户</div>
          <div className="stat-value">{formatNumber(referred?.total || 0)}</div>
          <div className="stat-foot">
            其中 {formatNumber(referred?.activated || 0)} 人已购买套餐
          </div>
        </div>
      </div>

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>你的邀请链接</h2>
            <p>分享给真实有需求的开发者。禁止以发展下级为目的收取加盟费。</p>
          </div>
          <Users size={17} />
        </div>
        <div className="panel-body">
          <div className="invite-box" style={{ marginTop: 0 }}>
            <input className="input" readOnly value={referralUrl} />
            <CopyButton value={referralUrl} />
          </div>
          <div className="grid-3 mt-16">
            <div>
              <div className="small muted">奖励比例</div>
              <strong>{config.commissionBps / 100}%</strong>
            </div>
            <div>
              <div className="small muted">退款观察期</div>
              <strong>{config.commissionHoldDays} 天</strong>
            </div>
            <div>
              <div className="small muted">结算门槛</div>
              <strong>¥50.00</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>奖励明细</h2>
            <p>订单退款、拒付或风控命中时，对应奖励会被冲回。</p>
          </div>
          <span className="badge">{commissionsResult.rows.length} 条</span>
        </div>
        {commissionsResult.rows.length === 0 ? (
          <div className="empty">还没有推荐订单。分享链接后，有效购买会出现在这里。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>订单金额</th>
                  <th>奖励</th>
                  <th>可结算时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {commissionsResult.rows.map((row) => {
                  const status = statusLabel(row.status);
                  return (
                    <tr key={row.id}>
                      <td className="mono small nowrap">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td className="small">{maskEmail(row.buyer_email)}</td>
                      <td className="mono small">
                        {formatCny(row.order_amount_micros)}
                      </td>
                      <td className="mono small">{formatCny(row.amount_micros)}</td>
                      <td className="mono small nowrap">
                        {formatDateTime(row.available_at)}
                      </td>
                      <td>
                        <span className={`badge ${status.className}`}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="notice mt-16">
        <Info size={16} />
        <div>
          可结算金额达到 ¥50.00 后，请联系{" "}
          <a className="text-link" href={`mailto:${supportEmail}`}>{supportEmail}</a>{" "}
          提交结算信息。平台按实际到账订单发放奖励，不按充值或刷单金额计算。
          奖励与税务处理以最终结算规则为准。
        </div>
      </div>
    </>
  );
}
