import type {
  ChannelSlice,
  ProductPerformance,
  TrendPoint,
} from "@/lib/shop/analytics";
import { formatCny, formatCnyCompact } from "@/lib/money";

/**
 * Server-rendered charts. No chart library, no client JavaScript and no
 * third-party assets: the chart is plain inline SVG and the breakdowns are
 * plain HTML, so the admin page stays small and works with SSR only.
 */

const CHART_WIDTH = 760;
const CHART_HEIGHT = 250;
const PAD = { top: 16, right: 14, bottom: 34, left: 62 };

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const hasData = points.some(
    (point) => point.revenueMicros > 0 || point.costMicros > 0 || point.orders > 0,
  );
  if (!points.length || !hasData) {
    return <div className="empty">近 30 天还没有已支付订单。</div>;
  }

  const plotWidth = CHART_WIDTH - PAD.left - PAD.right;
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const step = plotWidth / points.length;
  const barWidth = Math.max(4, step * 0.58);
  const max = Math.max(
    1,
    ...points.map((point) => Math.max(point.revenueMicros, point.costMicros)),
  );
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const centerX = (index: number) => PAD.left + step * (index + 0.5);
  const costPath = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${centerX(index).toFixed(2)},${y(
          point.costMicros,
        ).toFixed(2)}`,
    )
    .join(" ");
  const gridValues = [0, 0.25, 0.5, 0.75, 1];
  const labelIndexes = [0, 7, 14, 21, points.length - 1].filter(
    (index, position, list) =>
      index >= 0 && index < points.length && list.indexOf(index) === position,
  );
  const totalRevenue = points.reduce((sum, point) => sum + point.revenueMicros, 0);
  const totalCost = points.reduce((sum, point) => sum + point.costMicros, 0);

  return (
    <div className="analytics-chart-wrap">
      <div className="analytics-legend">
        <span>
          <i className="analytics-legend-dot" aria-hidden /> 营业额
        </span>
        <span>
          <i className="analytics-legend-line" aria-hidden /> 已录入成本
        </span>
      </div>
      <svg
        className="analytics-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`近 30 天营业额趋势，合计 ${formatCny(totalRevenue)}，已录入成本 ${formatCny(totalCost)}`}
      >
        <title>近 30 天营业额与已录入成本</title>
        {gridValues.map((ratio) => {
          const lineY = y(max * ratio);
          return (
            <g key={ratio}>
              <line
                className="analytics-grid-line"
                x1={PAD.left}
                x2={CHART_WIDTH - PAD.right}
                y1={lineY}
                y2={lineY}
              />
              <text
                className="analytics-axis-text"
                x={PAD.left - 8}
                y={lineY}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatCnyCompact(max * ratio)}
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const x = centerX(index) - barWidth / 2;
          const barY = y(point.revenueMicros);
          const barHeight = Math.max(
            0,
            PAD.top + plotHeight - barY,
          );
          return (
            <rect
              key={point.day}
              className="analytics-bar"
              x={x}
              y={barY}
              width={barWidth}
              height={barHeight}
              rx={2}
            >
              <title>
                {point.day} · 营业额 {formatCny(point.revenueMicros)} · {point.orders} 单
              </title>
            </rect>
          );
        })}
        <path className="analytics-cost-line" d={costPath} />
        {labelIndexes.map((index) => (
          <text
            key={points[index].day}
            className="analytics-axis-text"
            x={centerX(index)}
            y={CHART_HEIGHT - 12}
            textAnchor="middle"
          >
            {points[index].day.slice(5)}
          </text>
        ))}
      </svg>
      <p className="analytics-chart-note">
        柱状为营业额，红线为已录入成本；成本未录入的订单只计入营业额。
      </p>
    </div>
  );
}

export function ChannelBreakdown({ channels }: { channels: ChannelSlice[] }) {
  if (!channels.length) {
    return <div className="empty">近 30 天还没有已支付订单。</div>;
  }

  return (
    <div className="analytics-channel-list">
      {channels.map((channel) => (
        <div className="analytics-channel-row" key={channel.label}>
          <div className="analytics-channel-head">
            <span className="analytics-channel-name">{channel.label}</span>
            <span className="analytics-channel-amount">
              {formatCny(channel.revenueMicros)}
            </span>
          </div>
          <div className="analytics-channel-track">
            <span
              className="analytics-channel-fill"
              style={{
                width: `${Math.max(
                  channel.revenueMicros > 0 ? 1 : 0,
                  channel.sharePct,
                )}%`,
              }}
            />
          </div>
          <div className="analytics-channel-meta">
            <span>{channel.orders} 单</span>
            <span>{channel.sharePct.toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductRanking({ rows }: { rows: ProductPerformance[] }) {
  if (!rows.length) {
    return <div className="empty">近 30 天还没有商品销售。</div>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>商品</th>
            <th>销量</th>
            <th>营业额</th>
            <th>成本</th>
            <th>毛利</th>
            <th>毛利率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((product) => (
            <tr key={`${product.slug}-${product.name}`}>
              <td>
                <div className="analytics-product-name" title={product.name}>
                  {product.name}
                </div>
                <span className="muted small">{product.brand}</span>
              </td>
              <td className="nowrap">{product.units}</td>
              <td className="nowrap">{formatCny(product.revenueMicros)}</td>
              <td className="nowrap">
                {product.costKnown ? (
                  formatCny(product.costMicros)
                ) : (
                  <span className="analytics-missing">成本未录入</span>
                )}
              </td>
              <td className="nowrap">
                {product.grossProfitMicros === null
                  ? "—"
                  : formatCny(product.grossProfitMicros)}
              </td>
              <td
                className={
                  product.marginPct !== null && product.marginPct < 0
                    ? "text-red nowrap"
                    : "nowrap"
                }
              >
                {product.marginPct === null
                  ? "—"
                  : `${product.marginPct.toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
