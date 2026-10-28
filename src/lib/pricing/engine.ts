import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { computeRetailPrice } from "@/lib/pricing/retail";
import { adminRequest } from "@/lib/sub2api/auth";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";

type PlazaPricing = {
  input_price?: number | null;
  output_price?: number | null;
  cache_write_price?: number | null;
  cache_write_1h_price?: number | null;
  cache_read_price?: number | null;
  per_request_price?: number | null;
};

type PlazaModel = {
  name: string;
  platform: string;
  pricing?: PlazaPricing | null;
  official_pricing?: PlazaPricing | null;
};

type PlazaGroup = {
  id: number;
  name: string;
  platform: string;
  rate_multiplier: number;
  models: PlazaModel[];
};

type PlazaResponse = {
  groups?: PlazaGroup[];
};

type GroupResponse = {
  id: number;
  name: string;
  platform: string;
  status?: string;
  rate_multiplier?: number;
  model_allowlist?: { enabled: boolean; models?: string[] };
};

type CostRow = {
  model_id: string;
  platform: string;
  account_id: number | null;
  source_name: string;
  input_usd_per_mtok: string;
  output_usd_per_mtok: string;
  cache_read_usd_per_mtok: string;
  cache_write_usd_per_mtok: string;
  per_request_usd: string;
};

type PublicPrice = {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  per_request_cost?: number;
};

type ModelPriceRow = {
  model_id: string;
  platform: string;
  input_cny_per_mtok: number;
  output_cny_per_mtok: number;
  cache_read_cny_per_mtok: number;
  cache_write_cny_per_mtok: number;
  per_request_cny: number;
  cost_usd_per_mtok: number;
  margin_bps: number;
  status: "active" | "paused";
  pause_reason: string | null;
  fx_rate: number;
  cost_source: string;
  previous_input_cny_per_mtok: number;
};

export type PricingSyncResult = {
  ok: boolean;
  runId: string;
  fxRate: number;
  modelsTotal: number;
  modelsActive: number;
  modelsPaused: number;
  pushed: boolean;
  details: Array<{
    model: string;
    status: "active" | "paused";
    reason?: string;
    inputCnyPerMtok?: number;
    outputCnyPerMtok?: number;
    marginBps?: number;
    costSource?: string;
  }>;
};

async function fetchFxRate(): Promise<number> {
  try {
    const response = await fetch(config.fxApiUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.ok) {
      const payload = (await response.json()) as { rates?: { CNY?: number } };
      const rate = Number(payload.rates?.CNY);
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
  } catch {
    // Fall back to the configured accounting rate.
  }
  return config.fxCnyMicros / 1_000_000;
}

async function fetchPublicPrices(): Promise<Map<string, PublicPrice>> {
  const map = new Map<string, PublicPrice>();
  try {
    const response = await fetch(config.publicPriceUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return map;
    const payload = (await response.json()) as Record<string, PublicPrice>;
    for (const [model, price] of Object.entries(payload)) {
      if (price && typeof price === "object") map.set(model.toLowerCase(), price);
    }
  } catch {
    // Public prices are a fallback only.
  }
  return map;
}

function publicPriceFor(
  map: Map<string, PublicPrice>,
  model: string,
): PublicPrice | null {
  const key = model.toLowerCase();
  if (map.has(key)) return map.get(key) || null;
  const slash = key.indexOf("/");
  if (slash >= 0 && map.has(key.slice(slash + 1))) return map.get(key.slice(slash + 1)) || null;
  // Some feeds append date suffixes, e.g. gpt-4.1-2025-04-14.
  for (const [candidate, price] of map) {
    if (candidate.startsWith(`${key}-20`) || candidate.startsWith(`${key}@`)) return price;
  }
  return null;
}

function perMtok(value: number | null | undefined): number {
  if (!Number.isFinite(value) || !value || value < 0) return 0;
  return value * 1_000_000;
}

function money(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

async function loadCostRows(): Promise<CostRow[]> {
  // Costs are append-only snapshots. Only the newest row per
  // (model, platform, account, source) is a live cost; older rows are history.
  // Without this, an old expensive snapshot would keep setting the price
  // forever even after the operator recorded a cheaper source.
  const result = await query<CostRow>(
    `SELECT model_id, platform, account_id, source_name,
            input_usd_per_mtok, output_usd_per_mtok,
            cache_read_usd_per_mtok, cache_write_usd_per_mtok,
            per_request_usd
       FROM (
         SELECT c.*,
                ROW_NUMBER() OVER (
                  PARTITION BY model_id,
                               coalesce(NULLIF(platform, ''), ''),
                               coalesce(account_id, 0),
                               coalesce(NULLIF(source_name, ''), '')
                  ORDER BY effective_from DESC, created_at DESC
                ) AS rn
           FROM pricing_costs c
          WHERE effective_from <= now()
       ) latest
      WHERE rn = 1
      ORDER BY effective_from DESC`,
  );
  return result.rows;
}

function manualCostFor(rows: CostRow[], model: string, platform: string): CostRow | null {
  const candidates = rows.filter(
    (row) =>
      row.model_id === model &&
      (!row.platform || row.platform === platform),
  );
  if (candidates.length === 0) return null;
  // Conservative: price against the most expensive source across all accounts
  // (including account-level rows). Include every billable dimension so a
  // per-request or cache-heavy source cannot be overlooked.
  const score = (row: CostRow): number =>
    Number(row.input_usd_per_mtok) +
    Number(row.output_usd_per_mtok) +
    Number(row.cache_read_usd_per_mtok) +
    Number(row.cache_write_usd_per_mtok) +
    Number(row.per_request_usd);
  return candidates.reduce((best, row) => (score(row) > score(best) ? row : best));
}

async function loadCurrentPrices(): Promise<Map<string, ModelPriceRow>> {
  const result = await query<ModelPriceRow>(
    `SELECT model_id, platform, input_cny_per_mtok, output_cny_per_mtok,
            cache_read_cny_per_mtok, cache_write_cny_per_mtok,
            per_request_cny, cost_usd_per_mtok, margin_bps, status,
            pause_reason, fx_rate, cost_source,
            input_cny_per_mtok AS previous_input_cny_per_mtok
       FROM model_prices_current`,
  );
  return new Map(result.rows.map((row) => [row.model_id, row]));
}

function buildPrice(input: {
  plaza: PlazaModel;
  manual: CostRow | null;
  publicPrice: PublicPrice | null;
  fxRate: number;
  current: ModelPriceRow | undefined;
  force?: boolean;
}): {
  status: "active" | "paused";
  reason?: string;
  row?: Omit<ModelPriceRow, "previous_input_cny_per_mtok">;
} {
  const { plaza, manual, publicPrice, fxRate, current, force } = input;

  // Official list price and procurement cost are tracked separately. The
  // public price starts 10% below list, but never drops under cost + minimum
  // margin. Without an official price, cost × markup is the fallback.
  let officialInput = 0;
  let officialOutput = 0;
  let officialCacheRead = 0;
  let officialCacheWrite = 0;
  let officialPerRequest = 0;

  if (plaza.official_pricing) {
    officialInput = perMtok(plaza.official_pricing.input_price);
    officialOutput = perMtok(plaza.official_pricing.output_price);
    officialCacheRead = perMtok(plaza.official_pricing.cache_read_price);
    officialCacheWrite = perMtok(plaza.official_pricing.cache_write_price);
    officialPerRequest = Number(plaza.official_pricing.per_request_price || 0);
  } else if (publicPrice) {
    officialInput = perMtok(publicPrice.input_cost_per_token);
    officialOutput = perMtok(publicPrice.output_cost_per_token);
    officialCacheRead = perMtok(publicPrice.cache_read_input_token_cost);
    officialCacheWrite = perMtok(publicPrice.cache_creation_input_token_cost);
    officialPerRequest = Number(publicPrice.per_request_cost || 0);
  }

  let costInput = 0;
  let costOutput = 0;
  let costCacheRead = 0;
  let costCacheWrite = 0;
  let costPerRequest = 0;
  let source = "";

  if (manual) {
    costInput = Number(manual.input_usd_per_mtok);
    costOutput = Number(manual.output_usd_per_mtok);
    costCacheRead = Number(manual.cache_read_usd_per_mtok);
    costCacheWrite = Number(manual.cache_write_usd_per_mtok);
    costPerRequest = Number(manual.per_request_usd);
    source =
      officialInput > 0 || officialOutput > 0
        ? `official+cost:${manual.source_name || "cost"}`
        : `cost:${manual.source_name || "cost"}`;
  } else {
    costInput = officialInput;
    costOutput = officialOutput;
    costCacheRead = officialCacheRead;
    costCacheWrite = officialCacheWrite;
    costPerRequest = officialPerRequest;
    source = plaza.official_pricing ? "official" : publicPrice ? "public" : "";
  }

  if (costInput <= 0 && costOutput <= 0 && costPerRequest <= 0) {
    return { status: "paused", reason: "没有可用成本价" };
  }

  const minMargin = config.pricingMinMarginBps / 10_000;
  const effectiveMarkup = Math.max(
    config.pricingMarkupBps / 10_000,
    1 / (1 - minMargin),
  );

  const retail = computeRetailPrice({
    officialInputUsdMicros: officialInput * 1_000_000,
    officialOutputUsdMicros: officialOutput * 1_000_000,
    costInputUsdMicros: manual ? costInput * 1_000_000 : undefined,
    costOutputUsdMicros: manual ? costOutput * 1_000_000 : undefined,
    fxRate,
  });
  const retailInput = money(retail.inputCnyPerMtok);
  const retailOutput = money(retail.outputCnyPerMtok);
  const inputCostCny = costInput * fxRate;
  const multiplier = inputCostCny > 0 ? retailInput / inputCostCny : effectiveMarkup;
  // Unknown cache cost must never become free.
  const retailCacheRead = money(
    (costCacheRead > 0 ? costCacheRead : costInput) * fxRate * multiplier,
  );
  const retailCacheWrite = money(
    (costCacheWrite > 0 ? costCacheWrite : costInput) * fxRate * multiplier,
  );
  const retailPerRequest = money(costPerRequest * fxRate * effectiveMarkup);

  const costCny =
    costInput > 0 || costOutput > 0
      ? (costInput > 0 ? costInput : costOutput) * fxRate
      : costPerRequest * fxRate;
  const retailCny = (retailInput > 0 ? retailInput : retailOutput) || retailPerRequest;
  const marginBps = retailCny > 0 ? Math.round(((retailCny - costCny) / retailCny) * 10_000) : 0;

  if (marginBps < config.pricingMinMarginBps) {
    return { status: "paused", reason: `毛利过低 (${(marginBps / 100).toFixed(1)}%)` };
  }

  // Circuit breaker: compare every billable dimension, not only input. A
  // supplier can keep input unchanged while tripling output or cache prices.
  const spikeLimit = 1 + config.pricingMaxIncreaseBps / 10_000;
  const previous = current
    ? {
        input: current.input_cny_per_mtok || 0,
        output: current.output_cny_per_mtok || 0,
        cacheRead: current.cache_read_cny_per_mtok || 0,
        cacheWrite: current.cache_write_cny_per_mtok || 0,
      }
    : null;
  const spiked =
    previous &&
    ((previous.input > 0 && retailInput > previous.input * spikeLimit) ||
      (previous.output > 0 && retailOutput > previous.output * spikeLimit) ||
      (previous.cacheRead > 0 && retailCacheRead > previous.cacheRead * spikeLimit) ||
      (previous.cacheWrite > 0 && retailCacheWrite > previous.cacheWrite * spikeLimit));
  if (!force && current?.status === "active" && spiked) {
    return {
      status: "paused",
      reason: `单次涨幅超过 ${(config.pricingMaxIncreaseBps / 100).toFixed(0)}%，需人工确认`,
    };
  }

  if (
    !force &&
    current?.status === "paused" &&
    current.pause_reason?.includes("需人工确认")
  ) {
    return { status: "paused", reason: current.pause_reason };
  }

  return {
    status: "active",
    row: {
      model_id: plaza.name,
      platform: plaza.platform,
      input_cny_per_mtok: retailInput,
      output_cny_per_mtok: retailOutput,
      cache_read_cny_per_mtok: retailCacheRead,
      cache_write_cny_per_mtok: retailCacheWrite,
      per_request_cny: retailPerRequest,
      cost_usd_per_mtok: costInput || costOutput,
      margin_bps: marginBps,
      status: "active",
      pause_reason: null,
      fx_rate: fxRate,
      cost_source: source,
    },
  };
}

export async function syncPricing(options: { force?: boolean } = {}): Promise<PricingSyncResult> {
  if (!isSub2ApiConfigured()) throw new Error("网关尚未配置");

  const run = await query<{ id: string }>(
    "INSERT INTO pricing_sync_runs (status) VALUES ('running') RETURNING id",
  );
  const runId = run.rows[0].id;

  try {
    const [fxRate, publicPrices, costRows, currentPrices] = await Promise.all([
      fetchFxRate(),
      fetchPublicPrices(),
      loadCostRows(),
      loadCurrentPrices(),
    ]);

    let plaza: PlazaResponse = { groups: [] };
    try {
      plaza = await adminRequest<PlazaResponse>("/api/v1/model-plaza");
    } catch (error) {
      // Model plaza is an optional public surface; the pricing engine still
      // works from manual cost rows when it is disabled.
      if ((error as { status?: number }).status !== 404) throw error;
    }
    const group = (plaza.groups || []).find((item) => item.id === config.sub2apiGroupId) || {
      id: config.sub2apiGroupId,
      name: "cokeai",
      platform: "composite",
      rate_multiplier: 1,
      models: [],
    };

    // Bootstrap: models can come from manual cost rows even before the group
    // has any pricing configured. This lets an empty deployment start selling
    // a model without editing Sub2API first.
    const modelMap = new Map<string, PlazaModel>();
    for (const model of group.models || []) modelMap.set(model.name, model);
    for (const row of costRows) {
      if (!modelMap.has(row.model_id)) {
        modelMap.set(row.model_id, {
          name: row.model_id,
          platform: row.platform || group.platform || "openai",
          pricing: null,
          official_pricing: null,
        });
      }
    }
    const modelsToPrice = Array.from(modelMap.values());

    const details: PricingSyncResult["details"] = [];
    const groupPricing: Array<{
      platform: string;
      models: string[];
      billing_mode: "token" | "per_request";
      input_price: number;
      output_price: number;
      cache_read_price: number;
      cache_write_price: number;
      per_request_price: number;
    }> = [];
    const activeModels: string[] = [];
    let paused = 0;

    for (const plazaModel of modelsToPrice) {
      const manual = manualCostFor(costRows, plazaModel.name, plazaModel.platform);
      const publicPrice = manual ? null : publicPriceFor(publicPrices, plazaModel.name);
      const built = buildPrice({
        plaza: plazaModel,
        manual,
        publicPrice,
        fxRate,
        current: currentPrices.get(plazaModel.name),
        force: options.force,
      });

      if (built.status === "paused" || !built.row) {
        paused += 1;
        const previous = currentPrices.get(plazaModel.name);
        await query(
          `INSERT INTO model_prices_current
            (model_id, platform, input_cny_per_mtok, output_cny_per_mtok,
             cache_read_cny_per_mtok, cache_write_cny_per_mtok, per_request_cny,
             cost_usd_per_mtok, margin_bps, status, pause_reason, fx_rate, cost_source, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'paused',$10,$11,$12,now())
           ON CONFLICT (model_id) DO UPDATE SET
             platform = EXCLUDED.platform,
             cost_usd_per_mtok = EXCLUDED.cost_usd_per_mtok,
             status = 'paused',
             pause_reason = EXCLUDED.pause_reason,
             fx_rate = EXCLUDED.fx_rate,
             cost_source = EXCLUDED.cost_source,
             updated_at = now()`,
          [
            plazaModel.name,
            plazaModel.platform,
            previous?.input_cny_per_mtok ?? 0,
            previous?.output_cny_per_mtok ?? 0,
            previous?.cache_read_cny_per_mtok ?? 0,
            previous?.cache_write_cny_per_mtok ?? 0,
            previous?.per_request_cny ?? 0,
            previous?.cost_usd_per_mtok ?? 0,
            previous?.margin_bps ?? 0,
            built.reason || "已暂停",
            fxRate,
            "paused",
          ],
        );
        details.push({ model: plazaModel.name, status: "paused", reason: built.reason });
        continue;
      }

      const row = built.row;
      await query(
        `INSERT INTO model_prices_current
          (model_id, platform, input_cny_per_mtok, output_cny_per_mtok,
           cache_read_cny_per_mtok, cache_write_cny_per_mtok, per_request_cny,
           cost_usd_per_mtok, margin_bps, status, pause_reason, fx_rate, cost_source, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',NULL,$10,$11,now())
         ON CONFLICT (model_id) DO UPDATE SET
           platform = EXCLUDED.platform,
           input_cny_per_mtok = EXCLUDED.input_cny_per_mtok,
           output_cny_per_mtok = EXCLUDED.output_cny_per_mtok,
           cache_read_cny_per_mtok = EXCLUDED.cache_read_cny_per_mtok,
           cache_write_cny_per_mtok = EXCLUDED.cache_write_cny_per_mtok,
           per_request_cny = EXCLUDED.per_request_cny,
           cost_usd_per_mtok = EXCLUDED.cost_usd_per_mtok,
           margin_bps = EXCLUDED.margin_bps,
           status = 'active',
           pause_reason = NULL,
           fx_rate = EXCLUDED.fx_rate,
           cost_source = EXCLUDED.cost_source,
           updated_at = now()`,
        [
          row.model_id,
          row.platform,
          row.input_cny_per_mtok,
          row.output_cny_per_mtok,
          row.cache_read_cny_per_mtok,
          row.cache_write_cny_per_mtok,
          row.per_request_cny,
          row.cost_usd_per_mtok,
          row.margin_bps,
          fxRate,
          row.cost_source,
        ],
      );

      activeModels.push(row.model_id);
      if (row.input_cny_per_mtok > 0 || row.output_cny_per_mtok > 0) {
        groupPricing.push({
          platform: row.platform,
          models: [row.model_id],
          billing_mode: "token",
          input_price: row.input_cny_per_mtok / 1_000_000,
          output_price: row.output_cny_per_mtok / 1_000_000,
          cache_read_price: row.cache_read_cny_per_mtok / 1_000_000,
          cache_write_price: row.cache_write_cny_per_mtok / 1_000_000,
          per_request_price: 0,
        });
      } else {
        groupPricing.push({
          platform: row.platform,
          models: [row.model_id],
          billing_mode: "per_request",
          input_price: 0,
          output_price: 0,
          cache_read_price: 0,
          cache_write_price: 0,
          per_request_price: row.per_request_cny,
        });
      }
      details.push({
        model: row.model_id,
        status: "active",
        inputCnyPerMtok: row.input_cny_per_mtok,
        outputCnyPerMtok: row.output_cny_per_mtok,
        marginBps: row.margin_bps,
        costSource: row.cost_source,
      });
    }

    // Models that disappeared from both the gateway plaza and the manual cost
    // book must stop being sold. Keep the row for audit, but mark it paused.
    const liveModelIds = modelsToPrice.map((model) => model.name);
    await query(
      `UPDATE model_prices_current
          SET status = 'paused',
              pause_reason = '模型已下架或不在成本表中',
              updated_at = now()
        WHERE status = 'active'
          AND NOT (model_id = ANY($1::text[]))`,
      [liveModelIds],
    );

    // Group pricing overrides channel pricing in Sub2API. Prices are stored as
    // CNY credit units; the Sub2API admin UI will label them as USD.
    const desiredStatus = activeModels.length > 0 ? "active" : "inactive";
    const desiredAllowlist = { enabled: true, models: activeModels };
    await adminRequest<GroupResponse>(`/api/v1/admin/groups/${config.sub2apiGroupId}`, {
      method: "PUT",
      body: {
        rate_multiplier: 1,
        status: desiredStatus,
        model_pricing: groupPricing,
        // Fail closed: enable the allowlist even when it is empty. Keeping it
        // disabled would leave the group open to every model if it is later
        // activated manually.
        model_allowlist: desiredAllowlist,
      },
    });

    const verified = await adminRequest<GroupResponse>(
      `/api/v1/admin/groups/${config.sub2apiGroupId}`,
    );

    // Verify the write took effect. Only enforce fields the API actually
    // returns, so older/newer response shapes do not cause false failures.
    if (
      verified.rate_multiplier !== undefined &&
      Number(verified.rate_multiplier) !== 1
    ) {
      throw new Error(
        `网关分组倍率校验失败：期望 1，实际 ${verified.rate_multiplier}`,
      );
    }
    if (verified.status !== undefined && verified.status !== desiredStatus) {
      throw new Error(
        `网关分团状态校验失败：期望 ${desiredStatus}，实际 ${verified.status}`,
      );
    }
    if (verified.model_allowlist) {
      if (!verified.model_allowlist.enabled) {
        throw new Error("网关模型白名单未启用，已阻止本次同步");
      }
      const got = new Set(verified.model_allowlist.models || []);
      const missing = activeModels.filter((model) => !got.has(model));
      if (missing.length > 0 || got.size !== activeModels.length) {
        throw new Error(
          `网关模型白名单校验失败：缺少 ${missing.slice(0, 5).join(", ") || "未知模型"}`,
        );
      }
    }

    await query(
      `UPDATE pricing_sync_runs
          SET finished_at = now(), status = $2, fx_rate = $3,
              models_total = $4, models_updated = $5, models_paused = $6,
              details = $7::jsonb
        WHERE id = $1`,
      [
        runId,
        paused === 0 ? "success" : "partial",
        fxRate,
        details.length,
        activeModels.length,
        paused,
        JSON.stringify({
          groupRateMultiplier: verified.rate_multiplier,
          allowlist: verified.model_allowlist,
          models: details,
        }),
      ],
    );

    return {
      ok: true,
      runId,
      fxRate,
      modelsTotal: details.length,
      modelsActive: activeModels.length,
      modelsPaused: paused,
      pushed: true,
      details,
    };
  } catch (error) {
    await query(
      `UPDATE pricing_sync_runs
          SET finished_at = now(), status = 'failed', error = $2
        WHERE id = $1`,
      [runId, error instanceof Error ? error.message.slice(0, 1000) : "unknown"],
    );
    throw error;
  }
}

export async function listCurrentPrices(): Promise<
  Array<ModelPriceRow & { pause_reason: string | null }>
> {
  const result = await query<ModelPriceRow>(
    `SELECT model_id, platform, input_cny_per_mtok, output_cny_per_mtok,
            cache_read_cny_per_mtok, cache_write_cny_per_mtok,
            per_request_cny, cost_usd_per_mtok, margin_bps, status,
            pause_reason, fx_rate, cost_source,
            input_cny_per_mtok AS previous_input_cny_per_mtok
       FROM model_prices_current
      ORDER BY status DESC, model_id`,
  );
  return result.rows;
}
