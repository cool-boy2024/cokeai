import { query, toNumber } from "@/lib/db";
import { loadLatestCosts } from "@/lib/pricing/cost-book";
import { computeRetailPrice } from "@/lib/pricing/retail";

export type CatalogModel = {
  id: string;
  platform: string;
  displayName: string;
  description: string;
  contextWindow: number;
  inputCnyPerMtok: number;
  outputCnyPerMtok: number;
  cacheReadCnyPerMtok: number;
  cacheWriteCnyPerMtok: number;
  perRequestCny: number;
  marginBps: number;
  costSource: string;
  updatedAt: string;
};

type CatalogRow = {
  model_id: string;
  platform: string;
  input_cny_per_mtok: string;
  output_cny_per_mtok: string;
  cache_read_cny_per_mtok: string;
  cache_write_cny_per_mtok: string;
  per_request_cny: string;
  margin_bps: number;
  cost_source: string;
  updated_at: string;
  display_name: string | null;
  description: string | null;
  context_window: number | null;
};

type GatewayRow = {
  id: string;
  platform: string;
  display_name: string;
  description: string;
  context_window: number;
  input_price_usd_micros_per_mtok: string;
  output_price_usd_micros_per_mtok: string;
  markup_bps: string;
  updated_at: string;
  sort_order: number;
};

async function listGatewayModels(): Promise<CatalogModel[]> {
  // The live pricing engine can be empty while the Sub2API gateway has not
  // been wired yet. The models the app can actually serve already live in
  // models/upstreams, and this is the exact formula used for billing, so the
  // public page shows the same price the customer is charged.
  const result = await query<GatewayRow>(
    `SELECT m.id, u.id AS platform, m.display_name, m.description,
            m.context_window, m.input_price_usd_micros_per_mtok,
            m.output_price_usd_micros_per_mtok, m.markup_bps,
            m.updated_at, m.sort_order
       FROM models m
       JOIN upstreams u ON u.id = m.upstream_id
      WHERE m.enabled = TRUE
        AND u.enabled = TRUE
        AND u.api_key_encrypted IS NOT NULL
      ORDER BY m.sort_order, m.display_name`,
  );
  const costs = await loadLatestCosts(result.rows.map((row) => row.id));
  return result.rows.map((row) => {
    const cost = costs.get(row.id);
    const retail = computeRetailPrice({
      officialInputUsdMicros: Number(row.input_price_usd_micros_per_mtok),
      officialOutputUsdMicros: Number(row.output_price_usd_micros_per_mtok),
      costInputUsdMicros: cost?.inputUsdMicrosPerMtok,
      costOutputUsdMicros: cost?.outputUsdMicrosPerMtok,
    });
    return {
      id: row.id,
      platform: row.platform,
      displayName: row.display_name || row.id,
      description: row.description || "",
      contextWindow: row.context_window || 0,
      inputCnyPerMtok: retail.inputCnyPerMtok,
      outputCnyPerMtok: retail.outputCnyPerMtok,
      cacheReadCnyPerMtok: 0,
      cacheWriteCnyPerMtok: 0,
      perRequestCny: 0,
      marginBps: retail.marginBps,
      costSource: cost ? `gateway+${retail.source}` : "gateway",
      updatedAt: row.updated_at,
    };
  });
}

export async function listCatalogModels(): Promise<CatalogModel[]> {
  const result = await query<CatalogRow>(
    `SELECT p.model_id, p.platform, p.input_cny_per_mtok, p.output_cny_per_mtok,
            p.cache_read_cny_per_mtok, p.cache_write_cny_per_mtok, p.per_request_cny,
            p.margin_bps, p.cost_source, p.updated_at,
            m.display_name, m.description, m.context_window
       FROM model_prices_current p
       LEFT JOIN models m ON m.id = p.model_id
      WHERE p.status = 'active'
      ORDER BY p.platform, p.model_id`,
  );
  if (result.rows.length > 0) {
    return result.rows.map((row) => ({
      id: row.model_id,
      platform: row.platform,
      displayName: row.display_name || row.model_id,
      description: row.description || "",
      contextWindow: row.context_window || 0,
      inputCnyPerMtok: toNumber(row.input_cny_per_mtok),
      outputCnyPerMtok: toNumber(row.output_cny_per_mtok),
      cacheReadCnyPerMtok: toNumber(row.cache_read_cny_per_mtok),
      cacheWriteCnyPerMtok: toNumber(row.cache_write_cny_per_mtok),
      perRequestCny: toNumber(row.per_request_cny),
      marginBps: row.margin_bps,
      costSource: row.cost_source,
      updatedAt: row.updated_at,
    }));
  }
  return listGatewayModels();
}

export async function getCatalogModel(id: string): Promise<CatalogModel | null> {
  const models = await listCatalogModels();
  return models.find((model) => model.id === id) || null;
}
