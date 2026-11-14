import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeAlert,
  CircleDollarSign,
  Gauge,
  LayoutDashboard,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import {
  ChannelChart,
  ProductChart,
  ScreenToolbar,
  TrendChart,
} from "@/components/admin-shop/ShopScreenCharts";
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
  title: "经营指挥屏",
  robots: { index: false, follow: false },
};

// Operator data must never be cached by a shared proxy or the client router.
export const dynamic = "force-dynamic";

function DeltaPill({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const delta = deltaPct(current, previous);
  if (delta === null) {
    return <span className="as-delta is-flat">暂无环比</span>;
  }
  const tone = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  return (
    <span className={`as-delta is-${tone}`}>
      {delta > 0 ? "+" : ""}
      {delta.toFixed(1)}% 环比
    </span>
  );
}

function PanelHead({
  title,
  sub,
  badge,
}: {
  title: string;
  sub?: string;
  badge?: string;
}) {
  return (
    <div className="as-panel-head">
      <div>
        <h2 className="as-panel-title">{title}</h2>
        {sub ? <p className="as-panel-sub">{sub}</p> : null}
      </div>
      {badge ? <span className="as-badge">{badge}</span> : null}
    </div>
  );
}

export default async function AdminShopAnalyticsScreenPage() {
  await requireAdmin();
  const data = await loadShopAnalytics();

  const { windows, orders, operations, apiRecharge } = data;
  const hasCostedOrders = orders.costed30d > 0;
  const profit30 = hasCostedOrders
    ? windows.d30.costedRevenueMicros - windows.d30.costMicros
    : null;
  const margin30 = hasCostedOrders
    ? grossMarginPct(windows.d30.costedRevenueMicros, windows.d30.costMicros)
    : null;
  const costCoveragePct =
    windows.d30.orders > 0
      ? (orders.costed30d / windows.d30.orders) * 100
      : 0;
  const channelTotal = data.channels.reduce(
    (sum, channel) => sum + channel.revenueMicros,
    0,
  );

  const kpis = [
    {
      label: "今日营业额",
      value: formatCny(windows.today.revenueMicros),
      foot: `${windows.today.orders} 单 · 按付款时间`,
      delta: null,
      accent: false,
    },
    {
      label: "近 7 天营业额",
      value: formatCny(windows.d7.revenueMicros),
      foot: `${windows.d7.orders} 单`,
      delta: (
        <DeltaPill
          current={windows.d7.revenueMicros}
          previous={data.previousRevenue.d7Micros}
        />
      ),
      accent: false,
    },
    {
      label: "近 30 天营业额",
      value: formatCny(windows.d30.revenueMicros),
      foot: `${windows.d30.orders} 单`,
      delta: (
        <DeltaPill
          current={windows.d30.revenueMicros}
          previous={data.previousRevenue.d30Micros}
        />
      ),
      accent: true,
    },
    {
      label: "本月营业额",
      value: formatCny(windows.month.revenueMicros),
      foot: "本月 1 日至今",
      delta: null,
      accent: false,
    },
    {
      label: "累计营业额",
      value: formatCny(windows.all.revenueMicros),
      foot: `全部已支付 · ${windows.all.orders} 单`,
      delta: null,
      accent: false,
    },
    {
      label: "近 30 天毛利",
      value: profit30 === null ? "—" : formatCny(profit30),
      foot: hasCostedOrders
        ? `${orders.costed30d} 单完整成本`
        : "成本未录入",
      delta: null,
      accent: true,
    },
  ];

  const pipeline = [
    {
      label: "待付款",
      value: operations.pendingPayment,
      note: formatCny(operations.pendingPaymentAmountMicros),
      tone: "amber",
    },
    {
      label: "待采购",
      value: operations.toProcure,
      note: "已付款，待去供货商下单",
      tone: "mint",
    },
    {
      label: "待交付",
      value: operations.toDeliver,
      note: "采购中，待回填交付",
      tone: "sky",
    },
    {
      label: "退款中",
      value: operations.refundPending,
      note: "需要人工跟进",
      tone: operations.refundPending > 0 ? "red" : "muted",
    },
    {
      label: "已退款",
      value: operations.refunded,
      note: "不计入营业额",
      tone: "muted",
    },
  ];

  return (
    <div className="as-screen">
      <header className="as-head">
        <div className="as-head-main">
          <div className="as-kicker">
            <span className="as-live" aria-hidden="true" />
            COKEAI · SHOP COMMAND
          </div>
          <h1>小店经营指挥屏</h1>
          <p>
            已支付订单的营业额、成本、毛利与订单流水线。按{" "}
            {ANALYTICS_TIMEZONE} 自然日统计，仅管理员可见。
          </p>
        </div>
        <div className="as-head-side">
          <div className="as-stamp">
            <span>统计快照</span>
            <strong>{formatDateTime(data.generatedAt)}</strong>
          </div>
          <ScreenToolbar />
          <div className="as-links">
            <Link href="/admin/shop/analytics" className="as-link">
              <ArrowLeft size={13} /> 简洁视图
            </Link>
            <Link href="/admin/shop" className="as-link">
              <LayoutDashboard size={13} /> 小店概览
            </Link>
          </div>
        </div>
      </header>

      {windows.all.orders === 0 ? (
        <div className="as-alert">
          <ReceiptText size={16} />
          <span>
            还没有已支付的小店订单。首笔付款确认到账后，这里会显示经营数据。
          </span>
        </div>
      ) : null}

      <section className="as-kpis" aria-label="营业额概览">
        {kpis.map((kpi) => (
          <article
            key={kpi.label}
            className={`as-kpi${kpi.accent ? " is-accent" : ""}`}
          >
            <span className="as-kpi-label">{kpi.label}</span>
            <strong className="as-kpi-value">{kpi.value}</strong>
            <div className="as-kpi-foot">
              <span>{kpi.foot}</span>
              {kpi.delta}
            </div>
          </article>
        ))}
      </section>

      <div className="as-grid">
        <section className="as-panel as-span-8">
          <PanelHead
            title="近 30 天经营趋势"
            sub="按付款日汇总；成本线只含已录入成本的订单。"
            badge={formatCny(windows.d30.revenueMicros)}
          />
          <TrendChart points={data.trend} />
        </section>

        <section className="as-panel as-span-4">
          <PanelHead
            title="支付渠道"
            sub="近 30 天营业额占比，USDT 分网络统计。"
            badge={`${data.channels.length} 个渠道`}
          />
          <ChannelChart channels={data.channels} />
          <div className="as-channel-list">
            {data.channels.map((channel) => (
              <div className="as-channel-row" key={channel.label}>
                <span className="as-channel-name">
                  <span className="as-dot" aria-hidden="true" />
                  {channel.label}
                </span>
                <span className="as-channel-meta">
                  {channel.sharePct.toFixed(1)}% · {channel.orders} 单
                </span>
                <strong className="as-channel-amount">
                  {formatCny(channel.revenueMicros)}
                </strong>
              </div>
            ))}
            {data.channels.length === 0 ? (
              <div className="as-empty">近 30 天还没有已支付订单。</div>
            ) : (
              <div className="as-channel-row is-total">
                <span className="as-channel-name">合计</span>
                <span className="as-channel-meta">100%</span>
                <strong className="as-channel-amount">
                  {formatCny(channelTotal)}
                </strong>
              </div>
            )}
          </div>
        </section>

        <section className="as-panel as-span-6">
          <PanelHead
            title="商品排行 · 营业额"
            sub="近 30 天已支付订单，取前 8。"
            badge="TOP 8"
          />
          <ProductChart rows={data.productsByRevenue} metric="revenue" />
        </section>

        <section className="as-panel as-span-6">
          <PanelHead
            title="商品排行 · 销量"
            sub="近 30 天已支付订单，按件数取前 8。"
            badge="TOP 8"
          />
          <ProductChart rows={data.productsByUnits} metric="units" />
        </section>

        <section className="as-panel as-span-7">
          <PanelHead
            title="订单流水线"
            sub="当前状态计数；只有 paid / procuring / delivered 计入营业额。"
            badge="当前"
          />
          <div className="as-pipeline">
            {pipeline.map((item) => (
              <div
                key={item.label}
                className={`as-pipe is-${item.tone}`}
              >
                <span className="as-pipe-label">{item.label}</span>
                <strong className="as-pipe-value">{item.value}</strong>
                <span className="as-pipe-note">{item.note}</span>
              </div>
            ))}
          </div>
          <div className="as-pipe-foot">
            <BadgeAlert size={13} />
            退款中与已退款不计入营业额；待付款过期后自动关闭。
          </div>
        </section>

        <section className="as-panel as-span-5">
          <PanelHead
            title="经营质量"
            sub="成本完整性决定毛利是否可信。"
            badge={margin30 === null ? "毛利待录入" : `${margin30.toFixed(1)}% 毛利率`}
          />
          <div className="as-quality-grid">
            <div className="as-quality">
              <span>近 30 天客单价</span>
              <strong>
                {orders.aov30dMicros === null
                  ? "—"
                  : formatCny(orders.aov30dMicros)}
              </strong>
            </div>
            <div className="as-quality">
              <span>完整成本订单</span>
              <strong>
                {orders.costed30d}
                <small> / {windows.d30.orders}</small>
              </strong>
            </div>
            <div className="as-quality">
              <span>成本缺失</span>
              <strong className={orders.missingCost30d > 0 ? "is-warn" : ""}>
                {orders.missingCost30d}
                <small> 单</small>
              </strong>
            </div>
            <div className="as-quality">
              <span>预定单占比</span>
              <strong>{orders.preorderSharePct.toFixed(1)}%</strong>
            </div>
          </div>
          <div className="as-meter" aria-label="成本录入覆盖率">
            <div className="as-meter-head">
              <span>成本录入覆盖率</span>
              <strong>{costCoveragePct.toFixed(0)}%</strong>
            </div>
            <div className="as-meter-track">
              <span style={{ width: `${Math.min(100, costCoveragePct)}%` }} />
            </div>
          </div>
          <div className="as-quality-note">
            <ShieldCheck size={13} />
            累计成本缺失 {orders.missingCostAll} 单；缺失订单不会被算成 100% 毛利。
          </div>
        </section>

        <section className="as-panel as-span-12">
          <div className="as-recharge-head">
            <div>
              <h2 className="as-panel-title">账户充值</h2>
              <p className="as-panel-sub">
                充值订单独立核算，与小店营业额分开，不混算。
              </p>
            </div>
            <div className="as-recharge-mark">
              <WalletCards size={15} /> API 余额充值
            </div>
          </div>
          <div className="as-recharge">
            <div>
              <span>今日充值</span>
              <strong>{formatCny(apiRecharge.revenueTodayMicros)}</strong>
            </div>
            <div>
              <span>近 30 天充值</span>
              <strong>{formatCny(apiRecharge.revenue30dMicros)}</strong>
            </div>
            <div>
              <span>累计充值</span>
              <strong>{formatCny(apiRecharge.revenueAllMicros)}</strong>
            </div>
            <div>
              <span>待支付</span>
              <strong>{apiRecharge.pending} 单</strong>
            </div>
            <div>
              <span>近 30 天客单价</span>
              <strong>
                {apiRecharge.aov30dMicros === null
                  ? "—"
                  : formatCny(apiRecharge.aov30dMicros)}
              </strong>
            </div>
          </div>
        </section>
      </div>

      <footer className="as-foot">
        <div className="as-foot-item">
          <CircleDollarSign size={13} />
          营业额 = paid / procuring / delivered 且有付款时间的订单金额
        </div>
        <div className="as-foot-item">
          <Gauge size={13} />
          成本取自下单时的货源成本快照
        </div>
        <div className="as-foot-item">
          <PackageCheck size={13} />
          仅返回聚合值，不展示客户、Key 或供应商信息
        </div>
      </footer>
    </div>
  );
}
