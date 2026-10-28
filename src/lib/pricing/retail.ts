import { config } from "@/lib/config";

/**
 * Retail pricing uses two inputs:
 * - official price: the provider's public list price
 * - cost price: what we actually pay the upstream / reseller
 *
 * We start from a small discount against the official price, but never go
 * below cost + the configured minimum margin. If there is no official price,
 * fall back to the legacy cost × markup rule.
 *
 * All USD values are micros per 1M tokens, matching the `models` columns.
 */
export type RetailPriceInput = {
  officialInputUsdMicros: number;
  officialOutputUsdMicros: number;
  costInputUsdMicros?: number | null;
  costOutputUsdMicros?: number | null;
  fxRate?: number | null;
};

export type RetailPrice = {
  inputCnyPerMtok: number;
  outputCnyPerMtok: number;
  marginBps: number;
  officialInputUsdMicros: number;
  officialOutputUsdMicros: number;
  costInputUsdMicros: number;
  costOutputUsdMicros: number;
  source: "official+cost" | "official" | "cost";
};

function positive(value: number | null | undefined): number {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** USD micros per Mtok -> CNY per Mtok. */
function cnyPerMtok(usdMicros: number, fxRate: number): number {
  return (usdMicros * fxRate) / 1_000_000;
}

export function computeRetailPrice(input: RetailPriceInput): RetailPrice {
  const officialInput = positive(input.officialInputUsdMicros);
  const officialOutput = positive(input.officialOutputUsdMicros);
  const suppliedCostInput = positive(input.costInputUsdMicros);
  const suppliedCostOutput = positive(input.costOutputUsdMicros);

  // A missing procurement row means we buy at the official price.
  const costInput = suppliedCostInput || officialInput;
  const costOutput = suppliedCostOutput || officialOutput;

  const minMarginBps = Math.min(Math.max(config.pricingMinMarginBps, 0), 9_000);
  const minMargin = minMarginBps / 10_000;
  const officialDiscount = Math.min(
    Math.max(config.pricingOfficialDiscountBps, 0),
    9_000,
  ) / 10_000;
  const markup = Math.max(config.pricingMarkupBps, 10_000) / 10_000;
  const fxRate =
    input.fxRate && Number.isFinite(input.fxRate) && input.fxRate > 0
      ? input.fxRate
      : config.fxCnyMicros / 1_000_000;

  const officialInputCny = cnyPerMtok(officialInput, fxRate);
  const officialOutputCny = cnyPerMtok(officialOutput, fxRate);
  const costInputCny = cnyPerMtok(costInput, fxRate);
  const costOutputCny = cnyPerMtok(costOutput, fxRate);

  const targetInput =
    officialInputCny > 0 ? officialInputCny * (1 - officialDiscount) : costInputCny * markup;
  const targetOutput =
    officialOutputCny > 0 ? officialOutputCny * (1 - officialDiscount) : costOutputCny * markup;

  const floorInput = costInputCny > 0 ? costInputCny / (1 - minMargin) : 0;
  const floorOutput = costOutputCny > 0 ? costOutputCny / (1 - minMargin) : 0;

  const inputCnyPerMtok = Math.max(targetInput, floorInput);
  const outputCnyPerMtok = Math.max(targetOutput, floorOutput);

  const marginInput =
    inputCnyPerMtok > 0 ? ((inputCnyPerMtok - costInputCny) / inputCnyPerMtok) * 10_000 : 0;
  const marginOutput =
    outputCnyPerMtok > 0
      ? ((outputCnyPerMtok - costOutputCny) / outputCnyPerMtok) * 10_000
      : marginInput;

  const hasCost = suppliedCostInput > 0 || suppliedCostOutput > 0;
  const hasOfficial = officialInput > 0 || officialOutput > 0;

  return {
    inputCnyPerMtok,
    outputCnyPerMtok,
    marginBps: Math.round(hasCost ? marginInput : marginOutput),
    officialInputUsdMicros: officialInput,
    officialOutputUsdMicros: officialOutput,
    costInputUsdMicros: costInput,
    costOutputUsdMicros: costOutput,
    source: hasCost && hasOfficial ? "official+cost" : hasOfficial ? "official" : "cost",
  };
}
