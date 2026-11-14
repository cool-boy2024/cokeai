import { config } from "./config";

export type ModelPrice = {
  input_price_usd_micros_per_mtok: string | number;
  output_price_usd_micros_per_mtok: string | number;
  markup_bps: string | number;
  // Effective retail price computed from official price + procurement cost.
  // When present, this is what the customer is charged.
  retail_input_cny_per_mtok?: string | number | null;
  retail_output_cny_per_mtok?: string | number | null;
};

function number(value: string | number | bigint | null | undefined): number {
  return Number(value || 0);
}

export function formatCny(micros: string | number | bigint, decimals = 2): string {
  const amount = number(micros) / 1_000_000;
  return `¥${amount.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Short ¥ label for chart axes and dense cards. Exact amounts stay available
 * via formatCny; this is only a display shortcut.
 */
export function formatCnyCompact(micros: string | number | bigint): string {
  const yuan = number(micros) / 1_000_000;
  const abs = Math.abs(yuan);
  if (abs >= 100_000_000) return `¥${(yuan / 100_000_000).toFixed(2)}亿`;
  if (abs >= 10_000) {
    const digits = abs >= 100_000 ? 0 : 1;
    return `¥${(yuan / 10_000).toFixed(digits)}万`;
  }
  if (abs >= 1_000) return `¥${(yuan / 1_000).toFixed(1)}k`;
  if (abs >= 10) return `¥${yuan.toFixed(0)}`;
  return `¥${yuan.toFixed(2)}`;
}

export function formatCnyPrecise(micros: string | number | bigint): string {
  const value = number(micros);
  if (value === 0) return "¥0.00";
  if (value < 1_000_000) return "¥<0.01";
  return formatCny(value, 2);
}

export function formatUsdPerMillion(usdMicros: string | number | bigint): string {
  return `$${(number(usdMicros) / 1_000_000).toFixed(2)}`;
}

export function retailCnyPerMillion(
  usdMicros: string | number | bigint,
  markupBps: string | number | bigint,
): number {
  const upstreamCnyMicros = number(usdMicros) * config.fxCnyMicros / 1_000_000;
  return (upstreamCnyMicros * number(markupBps)) / 10_000 / 1_000_000;
}

export function calculateUsageCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelPrice,
): { upstreamCostMicros: number; chargedMicros: number } {
  const upstreamUsdMicros =
    (inputTokens * number(model.input_price_usd_micros_per_mtok)) / 1_000_000 +
    (outputTokens * number(model.output_price_usd_micros_per_mtok)) / 1_000_000;
  const upstreamCostMicros = Math.ceil(
    (upstreamUsdMicros * config.fxCnyMicros) / 1_000_000,
  );
  const retailInput = number(model.retail_input_cny_per_mtok);
  const retailOutput = number(model.retail_output_cny_per_mtok);
  // Retail values are CNY per 1M tokens; one token is one micro-CNY at that
  // rate, so tokens × CNY-per-Mtok already lands in micros.
  const chargedMicros =
    retailInput > 0 || retailOutput > 0
      ? Math.ceil(inputTokens * retailInput + outputTokens * retailOutput)
      : Math.ceil((upstreamCostMicros * number(model.markup_bps)) / 10_000);
  return { upstreamCostMicros, chargedMicros };
}

export function estimatePromptTokens(messages: unknown): number {
  const text = JSON.stringify(messages || []);
  // Conservative estimate that treats CJK and JSON punctuation as denser than English.
  return Math.max(1, Math.ceil(text.length / 2.5));
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}
