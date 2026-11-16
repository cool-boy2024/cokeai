import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  countNewSignups24h,
  getVisitorOverview,
  listAnonymousVisitors,
  listRecentSignups,
  listTopReferrers,
  purgeSiteVisits,
  type VisitRange,
} from "@/lib/visits";
import { describeUserAgent, formatLocation, maskIp } from "@/lib/visits-format";

export const metadata: Metadata = {
  title: "访客",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const RANGES: Array<{ value: VisitRange; label: string }> = [
  { value: 1, label: "今天" },
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
];

function parseRange(raw: string | undefined): VisitRange {
  return raw === "1" ? 1 : raw === "30" ? 30 : 7;
}

function source(referrer: string): string {
  return referrer || "直接访问";
}

export default async function AdminVisitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const range = parseRange(params.range);

  // The tracking route purges on traffic; the admin page also sweeps so old
  // rows disappear even when nobody visits the shop.
  await purgeSiteVisits().catch(() => {});

  const [overview, referrers, signups, visitors, newToday] = await Promise.all([
    getVisitorOverview(range),
    listTopReferrers(range),
    listRecentSignups(range),
    listAnonymousVisitors(range),
    countNewSignups24h(),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>访客</h1>
          <p>
            匿名访客的首次到访与新注册账号，按 Asia/Shanghai 自然日统计。
            IP 完整入库，这里只显示脱敏值；所在地读取 Cloudflare 请求头（省份/城市需要在
            Cloudflare 后台开启「添加访客位置标头」），记录保留 30 天后自动清理。
          </p>
        </div>
        <span className="badge">24 小时新注册 {newToday}</span>
      </div>

      <div className="flex flex-wrap gap-8 mb-16">
        {RANGES.map((item) => (
          <Link
            key={item.value}
            href={`/admin/visitors?range=${item.value}`}
            className={`btn btn-sm ${range === item.value ? "btn-dark" : "btn-ghost"}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <section className="analytics-metrics" aria-label="访客概览">
        <div className="analytics-metric">
          <span className="analytics-metric-label">新增访客</span>
          <strong className="analytics-metric-value">{overview.visitors}</strong>
          <span className="analytics-metric-foot">首次到访的匿名浏览器</span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">新注册</span>
          <strong className="analytics-metric-value">{overview.signups}</strong>
          <span className="analytics-metric-foot">不含管理员账号</span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">已关联账号</span>
          <strong className="analytics-metric-value">{overview.linked}</strong>
          <span className="analytics-metric-foot">访客注册或登录后自动关联</span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">访客转化率</span>
          <strong className="analytics-metric-value">{overview.conversionPct}%</strong>
          <span className="analytics-metric-foot">已关联 ÷ 新增访客</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>来源 Top</h2>
          </div>
          <span className="badge">{referrers.length} 个来源</span>
        </div>
        {referrers.length === 0 ? (
          <div className="empty">这个时间范围内还没有访客来源。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>来源</th>
                  <th className="text-right">访客数</th>
                </tr>
              </thead>
              <tbody>
                {referrers.map((row) => (
                  <tr key={row.referrer}>
                    <td className="mono">{row.referrer}</td>
                    <td className="text-right">{row.count}</td>
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
            <h2>新注册用户</h2>
          </div>
          <span className="badge">{signups.length} 条</span>
        </div>
        {signups.length === 0 ? (
          <div className="empty">这个时间范围内还没有新注册用户。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>注册时间</th>
                  <th>来源</th>
                  <th>所在地</th>
                  <th>落地页</th>
                  <th>IP</th>
                  <th>设备</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className="text-link" href={`/admin/users?q=${encodeURIComponent(row.email)}`}>
                        {row.email}
                      </Link>
                      <div className="muted">{row.name}</div>
                    </td>
                    <td className="nowrap">{formatDateTime(row.created_at)}</td>
                    <td className="mono">{source(row.referrer)}</td>
                    <td className="nowrap">{formatLocation(row.country, row.region, row.city)}</td>
                    <td className="mono">{row.landing_path || "—"}</td>
                    <td className="mono nowrap">{maskIp(row.ip)}</td>
                    <td className="nowrap">{describeUserAgent(row.user_agent)}</td>
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
            <h2>未注册访客</h2>
          </div>
          <span className="badge">{visitors.length} 条</span>
        </div>
        {visitors.length === 0 ? (
          <div className="empty">这个时间范围内还没有未注册访客。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>访客</th>
                  <th>首次到访</th>
                  <th>来源</th>
                  <th>所在地</th>
                  <th>落地页</th>
                  <th>IP</th>
                  <th>设备</th>
                </tr>
              </thead>
              <tbody>
                {visitors.map((row) => (
                  <tr key={row.visitor_id}>
                    <td className="mono nowrap">{row.visitor_id.slice(0, 8)}</td>
                    <td className="nowrap">{formatDateTime(row.created_at)}</td>
                    <td className="mono">{source(row.referrer)}</td>
                    <td className="nowrap">{formatLocation(row.country, row.region, row.city)}</td>
                    <td className="mono">{row.landing_path || "—"}</td>
                    <td className="mono nowrap">{maskIp(row.ip)}</td>
                    <td className="nowrap">{describeUserAgent(row.user_agent)}</td>
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
