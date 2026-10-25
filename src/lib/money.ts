import { config } from "./config";

export type ModelPrice = {
  input_price_usd_micros_per_mtok: string | number;
  output_price_usd_micros_per_mtok: string | number;
  markup_bps: string | number;
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
  const chargedMicros = Math.ceil(
    (upstreamCostMicros * number(model.markup_bps)) / 10_000,
  );
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
