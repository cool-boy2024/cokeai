"use client";

import { useEffect, useMemo, useRef } from "react";
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
 * View types mirror src/lib/metrics.ts shapes. They are re-declared here on
 * purpose: the chart component is a client component and must not import the
 * metrics lib (which pulls the pg pool into the browser bundle). Same pattern
 * as ShopScreenCharts vs. lib/shop/analytics.
 */
export type TrendPoint = {
  label: string;
  total: number;
  succeeded: number;
  failed: number;
  p95Ms: number | null;
};

export type MinutePoint = {
  label: string;
  requests: number;
  tokens: number;
};

export type ModelSlice = {
  modelId: string;
  requests: number;
  succeeded: number;
  p95Ms: number | null;
};

export type ErrorSlice = {
  code: string;
  count: number;
};

/** 延迟直方图分桶标签，与 src/lib/metrics.ts 的边界一一对应。 */
function latencyBucketLabels(): string[] {
  return ["0–1s", "1–3s", "3–10s", "10–30s", "≥30s"];
}

/**
 * API 指标页的交互图表。ECharts 按需注册（与大屏 ShopScreenCharts 同一套
 * 模块），但这里是纸面浅色主题，配色跟随后台的 ink/green/red-deep。
 * tooltip 一律 richText 渲染，模型名等动态文本不会作为 HTML 注入。
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

const GREEN = "#1f6f5c";
const RED = "#a83228";
const AMBER = "#b45309";
const SLATE = "#5b6ea8";
const AXIS_TEXT = "#8a867c";
const GRID_LINE = "rgba(22, 22, 21, 0.08)";
const DONUT_COLORS = [GREEN, SLATE, AMBER, RED, "#7a8b6f", "#9a6b8f", "#5f7d9a", "#a08a5f"];

const TOOLTIP_STYLE = {
  backgroundColor: "#fffdf8",
  borderColor: "rgba(22, 22, 21, 0.18)",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "#161615", fontSize: 12, lineHeight: 20 },
};

function axisTooltip(): Record<string, unknown> {
  return {
    trigger: "axis",
    renderMode: "richText",
    ...TOOLTIP_STYLE,
    axisPointer: {
      type: "line",
      lineStyle: { color: "rgba(22, 22, 21, 0.3)", type: "dashed" },
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
      className="metrics-chart"
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

type TooltipParam = {
  axisValueLabel?: string;
  seriesName?: string;
  value?: number;
  marker?: string;
};

export function UsageTrendChart({ points }: { points: TrendPoint[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const hasData = points.some((point) => point.total > 0);
    return {
      animationDuration: 500,
      grid: { top: 36, right: 52, bottom: 26, left: 44 },
      legend: {
        top: 0,
        right: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: AXIS_TEXT, fontSize: 11 },
        data: ["成功", "失败", "P95 延迟"],
      },
      tooltip: {
        ...axisTooltip(),
        formatter: (raw: unknown) => {
          const list = (Array.isArray(raw) ? raw : [raw]) as TooltipParam[];
          const head = list[0]?.axisValueLabel || "";
          const lines = list.map((item) => {
            const name = item.seriesName || "";
            const value = Number(item.value ?? 0);
            const text = name === "P95 延迟" ? `${(value / 1000).toFixed(2)}s` : `${value} 次`;
            return `${item.marker || ""}${name}：${text}`;
          });
          return [head, ...lines].join("\n");
        },
      },
      xAxis: {
        type: "category",
        data: points.map((point) => point.label),
        axisLine: { lineStyle: { color: GRID_LINE } },
        axisTick: { show: false },
        axisLabel: {
          color: AXIS_TEXT,
          fontSize: 10,
          interval: points.length > 12 ? Math.floor(points.length / 6) : 0,
          margin: 10,
        },
      },
      yAxis: [
        {
          type: "value",
          name: "请求",
          minInterval: 1,
          nameTextStyle: { color: AXIS_TEXT, fontSize: 10, padding: [0, 0, 4, 0] },
          axisLabel: {
            color: AXIS_TEXT,
            fontSize: 10,
            formatter: (value: number) => compactNumber(value),
          },
          splitLine: { lineStyle: { color: GRID_LINE, type: "dashed" } },
        },
        {
          type: "value",
          name: "P95 (s)",
          axisLabel: {
            color: AXIS_TEXT,
            fontSize: 10,
            formatter: (value: number) => `${(value / 1000).toFixed(0)}s`,
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "成功",
          type: "bar",
          stack: "requests",
          barMaxWidth: 22,
          data: hasData ? points.map((point) => point.succeeded) : [],
          itemStyle: { color: GREEN, borderRadius: [0, 0, 0, 0] },
        },
        {
          name: "失败",
          type: "bar",
          stack: "requests",
          barMaxWidth: 22,
          data: hasData ? points.map((point) => point.failed) : [],
          itemStyle: { color: RED, borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "P95 延迟",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 3,
          yAxisIndex: 1,
          connectNulls: true,
          data: points.map((point) => point.p95Ms ?? null),
          lineStyle: { color: AMBER, width: 1.6 },
          itemStyle: { color: AMBER },
        },
      ],
    };
  }, [points]);

  return (
    <EChart
      option={option}
      height={280}
      label="请求量堆叠柱状图与 P95 延迟折线"
    />
  );
}

export function MinuteChart({ points }: { points: MinutePoint[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const hasData = points.some((point) => point.requests > 0);
    return {
      animationDuration: 400,
      grid: { top: 36, right: 52, bottom: 26, left: 44 },
      legend: {
        top: 0,
        right: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: AXIS_TEXT, fontSize: 11 },
        data: ["RPM", "TPM"],
      },
      tooltip: {
        ...axisTooltip(),
        formatter: (raw: unknown) => {
          const list = (Array.isArray(raw) ? raw : [raw]) as TooltipParam[];
          const head = list[0]?.axisValueLabel || "";
          const lines = list.map((item) => {
            const name = item.seriesName || "";
            const value = Number(item.value ?? 0);
            const text = name === "TPM" ? `${compactNumber(value)} tokens` : `${value} 次/分`;
            return `${item.marker || ""}${name}：${text}`;
          });
          return [head, ...lines].join("\n");
        },
      },
      xAxis: {
        type: "category",
        data: points.map((point) => point.label),
        axisLine: { lineStyle: { color: GRID_LINE } },
        axisTick: { show: false },
        axisLabel: { color: AXIS_TEXT, fontSize: 10, interval: 9, margin: 10 },
      },
      yAxis: [
        {
          type: "value",
          name: "RPM",
          minInterval: 1,
          nameTextStyle: { color: AXIS_TEXT, fontSize: 10, padding: [0, 0, 4, 0] },
          axisLabel: { color: AXIS_TEXT, fontSize: 10 },
          splitLine: { lineStyle: { color: GRID_LINE, type: "dashed" } },
        },
        {
          type: "value",
          name: "TPM",
          axisLabel: {
            color: AXIS_TEXT,
            fontSize: 10,
            formatter: (value: number) => compactNumber(value),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "RPM",
          type: "bar",
          barMaxWidth: 10,
          data: hasData ? points.map((point) => point.requests) : [],
          itemStyle: { color: GREEN, borderRadius: [2, 2, 0, 0] },
        },
        {
          name: "TPM",
          type: "line",
          smooth: true,
          symbol: "none",
          yAxisIndex: 1,
          data: points.map((point) => point.tokens),
          lineStyle: { color: SLATE, width: 1.6 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(91, 110, 168, 0.22)" },
                { offset: 1, color: "rgba(91, 110, 168, 0)" },
              ],
            },
          },
        },
      ],
    };
  }, [points]);

  return (
    <EChart option={option} height={230} label="近 60 分钟每分钟请求量与 token 量" />
  );
}

export function ModelDonut({ models }: { models: ModelSlice[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const visible = models.slice(0, 7);
    return {
      animationDuration: 500,
      color: DONUT_COLORS,
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        ...TOOLTIP_STYLE,
        formatter: (raw: unknown) => {
          const item = raw as { name?: string; value?: number; percent?: number };
          const total = models.reduce((sum, row) => sum + row.requests, 0);
          const model = models.find((row) => row.modelId === item.name);
          const share = total > 0 ? ((Number(item.value || 0) / total) * 100).toFixed(1) : "0";
          return [
            String(item.name || ""),
            `${Number(item.value || 0)} 次 · ${share}%`,
            model ? `成功 ${model.succeeded} · P95 ${model.p95Ms === null ? "—" : `${(model.p95Ms / 1000).toFixed(2)}s`}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        },
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "78%"],
          center: ["50%", "52%"],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: "#fffdf8", borderWidth: 2 },
          emphasis: {
            scaleSize: 4,
            label: { show: true, color: "#161615", fontSize: 12, formatter: "{b}" },
          },
          data: visible.map((model) => ({
            name: model.modelId,
            value: model.requests,
          })),
        },
      ],
    };
  }, [models]);

  if (!models.length) {
    return <div className="empty">所选时间范围内没有模型调用。</div>;
  }

  return <EChart option={option} height={220} label="模型请求量占比环形图" />;
}

export function ErrorBars({ errors }: { errors: ErrorSlice[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    return {
      animationDuration: 400,
      grid: { top: 6, right: 50, bottom: 4, left: 128 },
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        ...TOOLTIP_STYLE,
        formatter: (raw: unknown) => {
          const item = raw as { name?: string; value?: number };
          return [String(item.name || ""), `${Number(item.value || 0)} 次`].join("\n");
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
        data: errors.map((item) => item.code),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#3e3d39",
          fontSize: 11,
          margin: 10,
          fontFamily: "var(--font-mono, monospace)",
        },
      },
      series: [
        {
          type: "bar",
          barWidth: 12,
          data: errors.map((item) => item.count),
          itemStyle: { color: RED, borderRadius: [0, 3, 3, 0] },
          label: {
            show: true,
            position: "right",
            color: AXIS_TEXT,
            fontSize: 10,
            formatter: (raw: unknown) => {
              const item = raw as { value?: number };
              return `${Number(item.value || 0)}`;
            },
          },
        },
      ],
    };
  }, [errors]);

  if (!errors.length) {
    return <div className="empty">所选时间范围内没有失败请求。</div>;
  }

  return <EChart option={option} height={Math.max(120, errors.length * 34 + 20)} label="错误码分布排行" />;
}

export function LatencyHistogramChart({ counts }: { counts: number[] }) {
  const labels = latencyBucketLabels();
  const option = useMemo<EChartsCoreOption>(() => {
    const total = counts.reduce((sum, value) => sum + value, 0);
    return {
      animationDuration: 400,
      grid: { top: 30, right: 16, bottom: 26, left: 44 },
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        ...TOOLTIP_STYLE,
        formatter: (raw: unknown) => {
          const item = raw as { name?: string; value?: number };
          const pct = total > 0 ? ((Number(item.value || 0) / total) * 100).toFixed(1) : "0";
          return [String(item.name || ""), `${Number(item.value || 0)} 次 · ${pct}%`].join("\n");
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: GRID_LINE } },
        axisTick: { show: false },
        axisLabel: { color: AXIS_TEXT, fontSize: 10, margin: 10 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: AXIS_TEXT, fontSize: 10 },
        splitLine: { lineStyle: { color: GRID_LINE, type: "dashed" } },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 34,
          data: counts,
          itemStyle: { color: AMBER, borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [counts, labels]);

  if (!counts.some((value) => value > 0)) {
    return <div className="empty">所选时间范围内没有已完成的延迟样本。</div>;
  }

  return <EChart option={option} height={200} label="响应延迟分布直方图" />;
}
