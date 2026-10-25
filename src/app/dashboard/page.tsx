import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CreditCard,
  Gift,
  KeyRound,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, toNumber } from "@/lib/db";
import {
  daysLeft,
  formatDateTime,
  formatNumber,
  usageStatusLabel,
} from "@/lib/format";
import { formatCny, formatCnyPrecise } from "@/lib/money";
import { CopyButton } from "@/components/CopyButton";

export const metadata: Metadata = { title: "概览" };
export const dynamic = "force-dynamic";

type UsageRow = {
  id: string;
  model_id: string;
  input_tokens: string;
  output_tokens: string;
  charged_micros: string;
  status: string;
  created_at: string;
};

export default async function DashboardPage() {
  const user = await requireUser();

  const [statsResult, recentResult, keysResult] = await Promise.all([
    query<{
      requests: string;
      tokens: string;
      charged: string;
      failures: string;
    }>(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(charged_micros), 0) AS charged,
              COUNT(*) FILTER (WHERE status = 'failed') AS failures
         FROM usage_events
        WHERE user_id = $1 AND created_at >= now() - interval '30 days'`,
      [user.id],
    ),
    query<UsageRow>(
      `SELECT id, model_id, input_tokens, output_tokens, charged_micros, status, created_at
         FROM usage_events
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 6`,
      [user.id],
    ),
    query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL",
      [user.id],
    ),
  ]);

  const stats = statsResult.rows[0];
  const requestCount = toNumber(stats?.requests);
  const tokens = toNumber(stats?.tokens);
  const charged = toNumber(stats?.charged);
  const failures = toNumber(stats?.failures);
  const keyCount = toNumber(keysResult.rows[0]?.count);
  const remainingDays = daysLeft(user.plan_expires_at);
  const referralUrl = `${config.appUrl}/register?ref=${user.referral_code}`;
  const snippet = `from openai import OpenAI

client = OpenAI(
  api_key="sk-coke-your-key",
  base_url="${config.appUrl}/v1"
)

res = client.chat.completions.create(
  model="deepseek-chat",
  messages=[{"role": "user", "content": "Hello"}]
)`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>你好，{user.name}。</h1>
          <p>这里是你所有 API 用量、额度和接入状态的单一事实来源。</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-ghost btn-sm" href="/docs">
            查看文档
          </Link>
          <Link className="btn btn-dark btn-sm" href="/dashboard/keys">
            <KeyRound size={14} /> 创建 API Key
          </Link>
        </div>
      </div>

      {!user.plan_active ? (
        <div className="notice notice-red">
          <Zap size={16} />
          <div>
            当前账户没有生效中的套餐。购买套餐后即可创建并调用 API。
            <Link className="text-link" href="/dashboard/billing" style={{ marginLeft: 8 }}>
              选择套餐 →
            </Link>
          </div>
        </div>
      ) : null}

      {user.plan_active && user.balance_micros < 2_000_000 ? (
        <div className="notice">
          <Wallet size={16} />
          <div>
            余额低于 ¥2.00，接近硬预算下限。建议及时续费，避免自动化任务被中断。
            <Link className="text-link" href="/dashboard/billing" style={{ marginLeft: 8 }}>
              立即续费 →
            </Link>
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            可用余额 <Wallet size={15} />
          </div>
          <div className="stat-value">{formatCny(user.balance_micros)}</div>
          <div className="stat-foot">人民币用量额度</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            近 30 天请求 <Activity size={15} />
          </div>
          <div className="stat-value">{formatNumber(requestCount)}</div>
          <div className="stat-foot">
            失败 {formatNumber(failures)} 次
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            近 30 天 Token <Sparkles size={15} />
          </div>
          <div className="stat-value">
            {tokens >= 1_000_000
              ? `${(tokens / 1_000_000).toFixed(1)}M`
              : tokens >= 1_000
                ? `${(tokens / 1_000).toFixed(1)}K`
                : formatNumber(tokens)}
          </div>
          <div className="stat-foot">输入 + 输出合计</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            近 30 天消费 <CreditCard size={15} />
          </div>
          <div className="stat-value">{formatCny(charged)}</div>
          <div className="stat-foot">{keyCount} 个有效 API Key</div>
        </div>
      </div>

      <div className="panel-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>最近请求</h2>
                <p>只记录计量与状态，不保存提示词和输出正文。</p>
              </div>
              <Link className="text-link small" href="/dashboard/usage">
                全部用量 →
              </Link>
            </div>
            {recentResult.rows.length === 0 ? (
              <div className="empty">
                <p style={{ marginTop: 0 }}>还没有调用记录。</p>
                <span className="small">
                  创建 API Key 后，使用文档中的示例发起第一个请求。
                </span>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>模型</th>
                      <th>Token</th>
                      <th>费用</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentResult.rows.map((event) => {
                      const status = usageStatusLabel(event.status);
                      return (
                        <tr key={event.id}>
                          <td className="mono small nowrap">
                            {formatDateTime(event.created_at)}
                          </td>
                          <td>
                            <span className="mono small">{event.model_id}</span>
                          </td>
                          <td className="mono small">
                            {formatNumber(
                              toNumber(event.input_tokens) + toNumber(event.output_tokens),
                            )}
                          </td>
                          <td className="mono small">
                            {formatCnyPrecise(event.charged_micros)}
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

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>快速接入</h2>
                <p>替换 Key 后即可运行；完整示例见 API 文档。</p>
              </div>
              <CopyButton value={snippet} />
            </div>
            <div className="quickstart" style={{ borderRadius: 0 }}>
              <div className="quickstart-head">
                <span>Python · OpenAI SDK</span>
                <span>{config.appUrl.replace(/^https?:\/\//, "")}/v1</span>
              </div>
              <pre>{snippet}</pre>
            </div>
          </section>
        </div>

        <div>
          <section className="panel">
            <div className="panel-head">
              <h2>当前套餐</h2>
              <Link className="text-link small" href="/dashboard/billing">
                管理
              </Link>
            </div>
            <div className="panel-body">
              <div className="balance-amount">{formatCny(user.balance_micros)}</div>
              <div className="small muted mt-8">剩余可用额度</div>
              <div className="divider" />
              <div className="flex-between">
                <span className="small muted">套餐</span>
                <strong className="small">
                  {user.plan_active ? user.plan_name : "未激活"}
                </strong>
              </div>
              <div className="flex-between mt-8">
                <span className="small muted">到期时间</span>
                <span className="small">
                  {user.plan_expires_at ? formatDateTime(user.plan_expires_at) : "—"}
                </span>
              </div>
              <div className="flex-between mt-8">
                <span className="small muted">剩余天数</span>
                <span className="small">
                  {remainingDays === null ? "—" : `${remainingDays} 天`}
                </span>
              </div>
              <div className="mt-16">
                <Link
                  className={`btn ${
                    user.plan_active ? "btn-ghost" : "btn-primary"
                  } btn-block btn-sm`}
                  href="/dashboard/billing"
                >
                  {user.plan_active ? "续费或升级" : "购买套餐"}
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>推荐奖励</h2>
                <p>每次有效订单可获得持续收益。</p>
              </div>
              <Gift size={17} />
            </div>
            <div className="panel-body">
              <div className="small muted">你的邀请链接</div>
              <div className="invite-box">
                <input className="input" readOnly value={referralUrl} />
                <CopyButton value={referralUrl} />
              </div>
              <Link
                className="btn btn-ghost btn-sm btn-block mt-12"
                href="/dashboard/referrals"
              >
                查看奖励明细 <ArrowRight size={13} />
              </Link>
            </div>
          </section>

          <div className="notice mt-16">
            <KeyRound size={15} />
            <div>
              Key 只在创建时展示一次。若怀疑泄露，请立即撤销旧 Key 并重新创建。
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
