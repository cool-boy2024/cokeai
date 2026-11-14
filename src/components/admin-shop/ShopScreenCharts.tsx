"use client";

import { useEffect, useMemo, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, RefreshCw } from "lucide-react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";

/**
 * ECharts wrapper used by the shop command screen.
 *
 * The visual language (dark glass panels, corner brackets, amber/mint accents)
 * is adapted from knight-L/sc-datav (Apache-2.0). Only the ECharts approach and
 * palette are reused; no 3D map, fonts, HDRs or image assets are copied.
 * Tooltips use richText so supplier product names are never rendered as HTML.
 */
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  LabelLayout,
  CanvasRenderer,
]);

const AMBER = "#f6b35a";
const MINT = "#6ee7b7";
const SKY = "#7dd3fc";
const VIOLET = "#c4b5fd";
const GRID_LINE = "rgba(148, 163, 184, 0.14)";
const AXIS_TEXT = "#94a3b8";
const TOOLTIP_BG = "rgba(7, 12, 18, 0.96)";
const TOOLTIP_BORDER = "rgba(246, 179, 90, 0.45)";

type ChartParam = {
  axisValueLabel?: string;
  name?: string;
  seriesName?: string;
  value?: number;
  marker?: string;
  data?: { orders?: number; sharePct?: number };
};

function yuan(value: number | null | undefined): string {
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function compactYuan(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `¥${(value / 100_000_000).toFixed(2)}亿`;
  if (abs >= 10_000) {
    return `¥${(value / 10_000).toFixed(abs >= 100_000 ? 0 : 1)}万`;
  }
  if (abs >= 1_000) return `¥${(value / 1_000).toFixed(1)}k`;
  if (abs >= 10) return `¥${value.toFixed(0)}`;
  return `¥${value.toFixed(2)}`;
}

function shortName(value: string, max = 15): string {
  const name = value.replace(/\s+/g, " ").trim();
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function tooltipBase(): Record<string, unknown> {
  return {
    trigger: "axis",
    renderMode: "richText",
    backgroundColor: TOOLTIP_BG,
    borderColor: TOOLTIP_BORDER,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: "#e5e7eb", fontSize: 12, lineHeight: 20 },
    axisPointer: {
      type: "line",
      lineStyle: { color: "rgba(246, 179, 90, 0.45)", type: "dashed" },
    },
  };
}

function EChart({
  option,
  height,
  label,
}: {
  option: EChartsCoreOption;
  height: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const instance = echarts.init(box.current, undefined, {
      renderer: "canvas",
    });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(box.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  return (
    <div
      ref={box}
      className="as-chart"
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}

export type TrendPointView = {
  day: string;
  revenueMicros: number;
  costMicros: number;
  orders: number;
};

export function TrendChart({ points }: { points: TrendPointView[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const days = points.map((point) => point.day.slice(5));
    return {
      animationDuration: 700,
      animationDurationUpdate: 500,
      grid: { top: 36, right: 42, bottom: 26, left: 54 },
      legend: {
        top: 0,
        right: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: AXIS_TEXT, fontSize: 11 },
        data: ["营业额", "已录入成本", "订单数"],
      },
      tooltip: {
        ...tooltipBase(),
        formatter: (raw: unknown) => {
          const list = (Array.isArray(raw) ? raw : [raw]) as ChartParam[];
          const day = list[0]?.axisValueLabel || "";
          const lines = list.map((item) => {
            const value = Number(item.value || 0);
            const formatted =
              item.seriesName === "订单数"
                ? `${value} 单`
                : yuan(value * 1_000_000);
            return `${item.marker || ""}${item.seriesName}：${formatted}`;
          });
          return [day, ...lines].join("\n");
        },
      },
      xAxis: {
        type: "category",
        data: days,
        boundaryGap: true,
        axisLine: { lineStyle: { color: GRID_LINE } },
        axisTick: { show: false },
        axisLabel: {
          color: AXIS_TEXT,
          fontSize: 10,
          interval: 4,
          margin: 12,
        },
      },
      yAxis: [
        {
          type: "value",
          name: "营业额",
          nameTextStyle: { color: AXIS_TEXT, fontSize: 10, padding: [0, 0, 4, 0] },
          axisLabel: {
            color: AXIS_TEXT,
            fontSize: 10,
            formatter: (value: number) => compactYuan(value),
          },
          splitLine: { lineStyle: { color: GRID_LINE, type: "dashed" } },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        {
          type: "value",
          name: "订单",
          nameTextStyle: { color: AXIS_TEXT, fontSize: 10 },
          axisLabel: { color: AXIS_TEXT, fontSize: 10 },
          splitLine: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
        },
      ],
      series: [
        {
          name: "营业额",
          type: "bar",
          barMaxWidth: 18,
          data: points.map((point) => point.revenueMicros / 1_000_000),
          itemStyle: {
            color: AMBER,
            borderRadius: [3, 3, 0, 0],
            shadowColor: "rgba(246, 179, 90, 0.18)",
            shadowBlur: 8,
          },
        },
        {
          name: "已录入成本",
          type: "line",
          smooth: true,
          symbol: "none",
          yAxisIndex: 0,
          data: points.map((point) => point.costMicros / 1_000_000),
          lineStyle: { color: MINT, width: 1.6 },
        },
        {
          name: "订单数",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 3,
          yAxisIndex: 1,
          data: points.map((point) => point.orders),
          lineStyle: { color: SKY, width: 1, type: "dashed" },
          itemStyle: { color: SKY },
        },
      ],
    };
  }, [points]);

  return (
    <EChart
      option={option}
      height={286}
      label="近 30 天小店营业额、已录入成本与订单数趋势"
    />
  );
}

export type ChannelView = {
  label: string;
  revenueMicros: number;
  orders: number;
  sharePct: number;
};

export function ChannelChart({ channels }: { channels: ChannelView[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const colors = [AMBER, MINT, SKY, VIOLET, "#fda4af", "#a3a3a3"];
    return {
      animationDuration: 700,
      color: colors,
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        backgroundColor: TOOLTIP_BG,
        borderColor: TOOLTIP_BORDER,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: "#e5e7eb", fontSize: 12, lineHeight: 20 },
        formatter: (raw: unknown) => {
          const item = raw as ChartParam;
          const data = item.data || {};
          return [
            item.name || "",
            `${yuan(Number(item.value || 0) * 1_000_000)}`,
            `${Number(data.orders || 0)} 单 · ${Number(data.sharePct || 0).toFixed(1)}%`,
          ].join("\n");
        },
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "82%"],
          center: ["50%", "52%"],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderColor: "#0a1016",
            borderWidth: 3,
          },
          emphasis: {
            scaleSize: 4,
            label: {
              show: true,
              color: "#f8fafc",
              fontSize: 12,
              formatter: "{b}",
            },
          },
          data: channels.map((channel) => ({
            name: channel.label,
            value: channel.revenueMicros / 1_000_000,
            orders: channel.orders,
            sharePct: channel.sharePct,
          })),
        },
      ],
    };
  }, [channels]);

  if (!channels.length) {
    return <div className="as-empty">近 30 天还没有已支付订单。</div>;
  }

  return <EChart option={option} height={190} label="近 30 天支付渠道营业额占比" />;
}

export type ProductView = {
  name: string;
  brand: string;
  units: number;
  revenueMicros: number;
};

export function ProductChart({
  rows,
  metric,
}: {
  rows: ProductView[];
  metric: "revenue" | "units";
}) {
  const option = useMemo<EChartsCoreOption>(() => {
    const visible = rows.slice(0, 8);
    const isRevenue = metric === "revenue";
    return {
      animationDuration: 650,
      grid: { top: 6, right: 54, bottom: 4, left: 118 },
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        backgroundColor: TOOLTIP_BG,
        borderColor: TOOLTIP_BORDER,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: "#e5e7eb", fontSize: 12, lineHeight: 20 },
        formatter: (raw: unknown) => {
          const item = raw as ChartParam;
          return [
            String(item.name || ""),
            isRevenue
              ? `营业额 ${yuan(Number(item.value || 0) * 1_000_000)}`
              : `销量 ${Number(item.value || 0)} 件`,
          ].join("\n");
        },
      },
      xAxis: {
        type: "value",
        show: false,
        max: (value: { max: number }) => value.max * 1.08,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: visible.map((row) => shortName(row.name)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "#cbd5e1", fontSize: 11, margin: 12 },
      },
      series: [
        {
          type: "bar",
          barWidth: 9,
          data: visible.map((row) =>
            isRevenue ? row.revenueMicros / 1_000_000 : row.units,
          ),
          itemStyle: {
            color: isRevenue ? AMBER : MINT,
            borderRadius: [0, 3, 3, 0],
          },
          label: {
            show: true,
            position: "right",
            color: AXIS_TEXT,
            fontSize: 10,
            formatter: (raw: unknown) => {
              const item = raw as ChartParam;
              const value = Number(item.value || 0);
              return isRevenue ? compactYuan(value) : `${value}`;
            },
          },
        },
      ],
    };
  }, [rows, metric]);

  if (!rows.length) {
    return <div className="as-empty">近 30 天还没有商品销售。</div>;
  }

  return (
    <EChart
      option={option}
      height={244}
      label={metric === "revenue" ? "近 30 天商品营业额排行" : "近 30 天商品销量排行"}
    />
  );
}

export function ScreenToolbar() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  function fullscreen() {
    const target = document.querySelector<HTMLElement>(".as-screen");
    if (!target) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void target.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <div className="as-toolbar">
      <button
        type="button"
        className="as-tool-btn"
        onClick={refresh}
        disabled={pending}
        aria-label="刷新看板数据"
      >
        <RefreshCw size={13} className={pending ? "as-spin" : undefined} />
        <span>{pending ? "刷新中" : "刷新"}</span>
      </button>
      <button
        type="button"
        className="as-tool-btn"
        onClick={fullscreen}
        aria-label="全屏查看看板"
      >
        <Maximize2 size={13} />
        <span>全屏</span>
      </button>
    </div>
  );
}
