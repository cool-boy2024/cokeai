"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";

/**
 * 评测对比图表。与 /admin/metrics 同一套 ECharts 按需注册，浅色纸面主题。
 * 视图类型在这里重新声明，避免 client bundle 拉进 server-only 的 db 模块。
 */
echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  LabelLayout,
  CanvasRenderer,
]);

const GREEN = "#1f6f5c";
const AMBER = "#b45309";
const SLATE = "#5b6ea8";
const RED = "#a83228";
const AXIS_TEXT = "#8a867c";
const GRID_LINE = "rgba(22, 22, 21, 0.08)";

const VARIANT_LABEL: Record<string, string> = {
  heuristic: "规则版",
  single_shot: "单轮模型",
  agent: "受控 Agent",
};

function label(variant: string): string {
  return VARIANT_LABEL[variant] || variant;
}

const TOOLTIP = {
  backgroundColor: "#fffdf8",
  borderColor: "rgba(22, 22, 21, 0.18)",
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "#161615", fontSize: 12, lineHeight: 20 },
};

function EChart({
  option,
  height,
  label: ariaLabel,
}: {
  option: EChartsCoreOption;
  height: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const instance = echarts.init(box.current, undefined, { renderer: "canvas" });
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
    <div ref={box} className="metrics-chart" style={{ height }} role="img" aria-label={ariaLabel} />
  );
}

export type QualityRow = {
  variant: string;
  schemaValidPct: number;
  leakFreePct: number;
  usablePct: number;
};

export function QualityChart({ rows }: { rows: QualityRow[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const names = rows.map((row) => label(row.variant));
    const series = [
      { name: "Zod 通过", data: rows.map((row) => row.schemaValidPct), color: SLATE },
      { name: "零泄露", data: rows.map((row) => row.leakFreePct), color: AMBER },
      { name: "可用", data: rows.map((row) => row.usablePct), color: GREEN },
    ];
    return {
      animationDuration: 500,
      grid: { top: 34, right: 16, bottom: 26, left: 42 },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: AXIS_TEXT, fontSize: 11 },
      },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        ...TOOLTIP,
        axisPointer: {
          type: "shadow",
          shadowStyle: { color: "rgba(22,22,21,0.04)" },
        },
        formatter: (raw: unknown) => {
          const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
            axisValueLabel?: string;
            seriesName?: string;
            value?: number;
            marker?: string;
          }>;
          const head = list[0]?.axisValueLabel || "";
          return [
            head,
            ...list.map(
              (item) =>
                `${item.marker || ""}${item.seriesName}：${Number(item.value ?? 0).toFixed(1)}%`,
            ),
          ].join("\n");
        },
      },
      xAxis: {
        type: "category",
        data: names,
        axisLine: { lineStyle: { color: GRID_LINE } },
        axisTick: { show: false },
        axisLabel: { color: AXIS_TEXT, fontSize: 11, margin: 10 },
      },
      yAxis: {
        type: "value",
        max: 100,
        min: 0,
        axisLabel: { color: AXIS_TEXT, fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { color: GRID_LINE, type: "dashed" } },
      },
      series: series.map((item) => ({
        name: item.name,
        type: "bar",
        barMaxWidth: 26,
        data: item.data,
        itemStyle: { color: item.color, borderRadius: [3, 3, 0, 0] },
      })),
    };
  }, [rows]);

  return <EChart option={option} height={230} label="三方案质量对比：Zod 通过率、零泄露率、可用率" />;
}

export type CostRow = {
  variant: string;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgLatencyMs: number;
};

export function CostChart({ rows }: { rows: CostRow[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const names = rows.map((row) => label(row.variant));
    return {
      animationDuration: 500,
      grid: { top: 34, right: 52, bottom: 26, left: 46 },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: AXIS_TEXT, fontSize: 11 },
      },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        ...TOOLTIP,
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(22,22,21,0.04)" } },
        formatter: (raw: unknown) => {
          const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
            axisValueLabel?: string;
            seriesName?: string;
            value?: number;
            marker?: string;
          }>;
          const head = list[0]?.axisValueLabel || "";
          return [
            head,
            ...list.map((item) => {
              const value = Number(item.value ?? 0);
              const text =
                item.seriesName === "平均耗时"
                  ? `${(value / 1000).toFixed(2)}s`
                  : `${value} tokens`;
              return `${item.marker || ""}${item.seriesName}：${text}`;
            }),
          ].join("\n");
        },
      },
      xAxis: {
        type: "category",
        data: names,
        axisLine: { lineStyle: { color: GRID_LINE } },
        axisTick: { show: false },
        axisLabel: { color: AXIS_TEXT, fontSize: 11, margin: 10 },
      },
      yAxis: [
        {
          type: "value",
          name: "tokens",
          nameTextStyle: { color: AXIS_TEXT, fontSize: 10, padding: [0, 0, 4, 0] },
          axisLabel: { color: AXIS_TEXT, fontSize: 10 },
          splitLine: { lineStyle: { color: GRID_LINE, type: "dashed" } },
        },
        {
          type: "value",
          name: "耗时",
          axisLabel: { color: AXIS_TEXT, fontSize: 10, formatter: (v: number) => `${v / 1000}s` },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "平均输入",
          type: "bar",
          stack: "tokens",
          barMaxWidth: 26,
          data: rows.map((row) => row.avgInputTokens),
          itemStyle: { color: SLATE, borderRadius: [0, 0, 0, 0] },
        },
        {
          name: "平均输出",
          type: "bar",
          stack: "tokens",
          barMaxWidth: 26,
          data: rows.map((row) => row.avgOutputTokens),
          itemStyle: { color: GREEN, borderRadius: [3, 3, 0, 0] },
        },
        {
          name: "平均耗时",
          type: "line",
          yAxisIndex: 1,
          symbol: "circle",
          symbolSize: 4,
          data: rows.map((row) => row.avgLatencyMs),
          lineStyle: { color: RED, width: 1.6 },
          itemStyle: { color: RED },
        },
      ],
    };
  }, [rows]);

  return <EChart option={option} height={230} label="三方案成本对比：平均输入/输出 token 与耗时" />;
}
