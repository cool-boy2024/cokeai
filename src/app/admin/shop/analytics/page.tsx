import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, MonitorPlay, ReceiptText } from "lucide-react";
import { ChannelBreakdown, ProductRanking, TrendChart } from "@/components/admin-shop/AnalyticsPanels";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import {
  ANALYTICS_TIMEZONE,
  deltaPct,
  grossMarginPct,
  loadShopAnalytics,
} from "@/lib/shop/analytics";

export const metadata: Metadata = {
  title: "经营看板",
  robots: { index: false, follow: false },
};

// Operator data must never be cached by a shared proxy or the client router.
export const dynamic = "force-dynamic";

function Delta({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const delta = deltaPct(current, previous);
  if (delta === null) {
    return <span className="analytics-delta analytics-delta-muted">暂无环比</span>;
  }
  const tone = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  return (
    <span className={`analytics-delta analytics-delta-${tone}`}>
      较上一周期 {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}%
    </span>
  );
}

export default async function AdminShopAnalyticsPage() {
  await requireAdmin();
  const data = await loadShopAnalytics();

  const { windows, orders, operations, apiRecharge } = data;
  const costedRevenue30 = windows.d30.costedRevenueMicros;
  const cost30 = windows.d30.costMicros;
  const hasCostedOrders = orders.costed30d > 0;
  const profit30 = hasCostedOrders ? costedRevenue30 - cost30 : null;
  const margin30 = hasCostedOrders
    ? grossMarginPct(costedRevenue30, cost30)
    : null;
  const hasAnyPaid = windows.all.orders > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>经营看板</h1>
          <p>
            小店已支付订单的营业额、成本、毛利与渠道表现。按{" "}
            {ANALYTICS_TIMEZONE} 自然日统计，仅管理员可见。
          </p>
        </div>
        <div className="page-head-actions">
          <span className="badge">
            统计于 {formatDateTime(data.generatedAt)}
          </span>
          <Link className="btn btn-light btn-sm" href="/admin/shop">
            小店概览
          </Link>
          <Link
            className="btn btn-light btn-sm"
            href="/admin/shop/analytics/screen"
          >
            <MonitorPlay size={14} /> 大屏模式
          </Link>
          <Link className="btn btn-dark btn-sm" href="/admin/shop/orders">
            订单明细 <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>

      {!hasAnyPaid ? (
        <div className="notice">
          <ReceiptText size={16} />
          <div>还没有已支付的小店订单。首笔付款确认到账后，这里会显示经营数据。</div>
        </div>
      ) : null}

      <section className="analytics-metrics" aria-label="营业额">
        <div className="analytics-metric">
          <span className="analytics-metric-label">今日营业额</span>
          <strong className="analytics-metric-value">
            {formatCny(windows.today.revenueMicros)}
          </strong>
          <span className="analytics-metric-foot">
            {windows.today.orders} 单 · 按付款时间
          </span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">近 7 天营业额</span>
          <strong className="analytics-metric-value">
            {formatCny(windows.d7.revenueMicros)}
          </strong>
          <span className="analytics-metric-foot">
            {windows.d7.orders} 单 ·{" "}
            <Delta
              current={windows.d7.revenueMicros}
              previous={data.previousRevenue.d7Micros}
            />
          </span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">近 30 天营业额</span>
          <strong className="analytics-metric-value">
            {formatCny(windows.d30.revenueMicros)}
          </strong>
          <span className="analytics-metric-foot">
            {windows.d30.orders} 单 ·{" "}
            <Delta
              current={windows.d30.revenueMicros}
              previous={data.previousRevenue.d30Micros}
            />
          </span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">本月营业额</span>
          <strong className="analytics-metric-value">
            {formatCny(windows.month.revenueMicros)}
          </strong>
          <span className="analytics-metric-foot">本月 1 日至今</span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">累计营业额</span>
          <strong className="analytics-metric-value">
            {formatCny(windows.all.revenueMicros)}
          </strong>
          <span className="analytics-metric-foot">
            全部已支付订单 · {windows.all.orders} 单
          </span>
        </div>
      </section>

      <section className="stat-grid" aria-label="近 30 天经营指标">
        <div className="stat-card">
          <div className="stat-label">
            <span>已支付订单</span>
            <span>近 30 天</span>
          </div>
          <div className="stat-value">{windows.d30.orders}</div>
          <div className="stat-foot">
            客单价{" "}
            {orders.aov30dMicros === null
              ? "—"
              : formatCny(orders.aov30dMicros)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span>成本</span>
            <span>近 30 天</span>
          </div>
          <div className="stat-value">
            {hasCostedOrders ? formatCny(cost30) : "成本未录入"}
          </div>
          <div className="stat-foot">
            基于 {orders.costed30d} 单完整成本
            {orders.missingCost30d > 0
              ? ` · ${orders.missingCost30d} 单未计入`
              : ""}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span>毛利</span>
            <span>近 30 天</span>
          </div>
          <div className="stat-value">
            {profit30 === null ? "—" : formatCny(profit30)}
          </div>
          <div className="stat-foot">营业额 − 成本，仅统计完整成本订单</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span>毛利率</span>
            <span>近 30 天</span>
          </div>
          <div
            className={`stat-value${
              margin30 !== null && margin30 < 0 ? " text-red" : ""
            }`}
          >
            {margin30 === null ? "—" : `${margin30.toFixed(1)}%`}
          </div>
          <div className="stat-foot">
            {orders.missingCost30d > 0
              ? `${orders.missingCost30d} 单成本缺失，未按 100% 毛利计算`
              : "全部已支付订单成本完整"}
          </div>
        </div>
      </section>

      {orders.missingCost30d > 0 ? (
        <div className="notice notice-yellow">
          <div>
            近 30 天有 {orders.missingCost30d} 单没有货源成本快照，成本、毛利和毛利率
            只统计其余 {orders.costed30d} 单。成本缺失的订单不会被算成 100% 毛利。
          </div>
        </div>
      ) : null}

      <section className="analytics-ops" aria-label="订单状态">
        <div className="analytics-op">
          <span>待付款</span>
          <strong>{operations.pendingPayment}</strong>
          <small>合计 {formatCny(operations.pendingPaymentAmountMicros)}</small>
        </div>
        <div className="analytics-op">
          <span>待采购</span>
          <strong>{operations.toProcure}</strong>
          <small>已付款，等待去供货商下单</small>
        </div>
        <div className="analytics-op">
          <span>待交付</span>
          <strong>{operations.toDeliver}</strong>
          <small>采购中，等待回填交付</small>
        </div>
        <div className="analytics-op">
          <span>退款中</span>
          <strong className={operations.refundPending > 0 ? "is-warn" : ""}>
            {operations.refundPending}
          </strong>
          <small>当前状态计数</small>
        </div>
        <div className="analytics-op">
          <span>已退款</span>
          <strong>{operations.refunded}</strong>
          <small>当前状态计数，不计入营业额</small>
        </div>
        <div className="analytics-op">
          <span>预定单占比</span>
          <strong>{orders.preorderSharePct.toFixed(1)}%</strong>
          <small>近 30 天 {orders.preorder30d} 单</small>
        </div>
      </section>

      <div className="analytics-split">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>近 30 天趋势</h2>
              <p>按付款日汇总；成本线只含已录入成本的订单。</p>
            </div>
            <span className="badge">{formatCny(windows.d30.revenueMicros)}</span>
          </div>
          <TrendChart points={data.trend} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>支付渠道</h2>
              <p>近 30 天营业额占比，USDT 分网络统计。</p>
            </div>
          </div>
          <ChannelBreakdown channels={data.channels} />
        </section>
      </div>

      <div className="analytics-rank-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>商品排行 · 营业额</h2>
              <p>近 30 天已支付订单，按营业额取前 10。</p>
            </div>
          </div>
          <ProductRanking rows={data.productsByRevenue} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>商品排行 · 销量</h2>
              <p>近 30 天已支付订单，按件数取前 10。</p>
            </div>
          </div>
          <ProductRanking rows={data.productsByUnits} />
        </section>
      </div>

      <div className="analytics-split analytics-bottom">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>API 充值</h2>
              <p>充值订单独立核算，与小店营业额分开，不混算。</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="analytics-mini-grid">
              <div className="analytics-mini">
                <span>今日充值</span>
                <strong>{formatCny(apiRecharge.revenueTodayMicros)}</strong>
              </div>
              <div className="analytics-mini">
                <span>近 30 天充值</span>
                <strong>{formatCny(apiRecharge.revenue30dMicros)}</strong>
              </div>
              <div className="analytics-mini">
                <span>累计充值</span>
                <strong>{formatCny(apiRecharge.revenueAllMicros)}</strong>
              </div>
            </div>
            <p className="analytics-chart-note">
              近 30 天 {apiRecharge.orders30d} 单 · 累计 {apiRecharge.ordersAll} 单
              {apiRecharge.aov30dMicros !== null
                ? ` · 客单价 ${formatCny(apiRecharge.aov30dMicros)}`
                : ""}
              · 待支付 {apiRecharge.pending} 单
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>口径与数据保护</h2>
              <p>指标定义固定在此页，不接受任意筛选或导出。</p>
            </div>
          </div>
          <div className="panel-body">
            <ul className="analytics-defs">
              <li>
                <strong>营业额</strong>：状态为 paid / procuring / delivered
                且已记录付款时间的订单金额；不含待付款、已取消、已过期、退款中和已退款。
              </li>
              <li>
                <strong>成本</strong>：下单时写入的货源成本快照
                （shop_order_items.supplier_cost_micros）。小于等于 0 视为未录入。
              </li>
              <li>
                <strong>毛利 / 毛利率</strong>：只用成本完整的订单计算，成本缺失订单
                不计入，避免虚高。
              </li>
              <li>
                <strong>客单价</strong>：近 30 天营业额 ÷ 近 30 天已支付单数。
              </li>
              <li>
                <strong>渠道</strong>：按 shop_orders.payment_provider
                统计，USDT 分 TRC20 / BEP20 / Polygon。
              </li>
              <li>
                <strong>数据保护</strong>：页面在 /admin 权限体系内，仅返回聚合值；
                不展示客户邮箱、联系方式、Key、加密字段或供应商信息。
              </li>
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
