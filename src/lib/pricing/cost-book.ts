import { query } from "@/lib/db";

export type CostSnapshot = {
  modelId: string;
  inputUsdMicrosPerMtok: number;
  outputUsdMicrosPerMtok: number;
  sourceName: string;
};

type CostRow = {
  model_id: string;
  source_name: string;
  input_usd_per_mtok: string;
  output_usd_per_mtok: string;
};

/**
 * Newest row per (model, platform, account, source), then keep the most
 * expensive source for each model. This mirrors the pricing engine's
 * conservative rule: never quote against a cost we might not actually pay.
 */
export async function loadLatestCosts(
  modelIds: string[],
): Promise<Map<string, CostSnapshot>> {
  if (modelIds.length === 0) return new Map();

  const result = await query<CostRow>(
    `SELECT model_id, source_name, input_usd_per_mtok, output_usd_per_mtok
       FROM (
         SELECT c.model_id, c.source_name,
                c.input_usd_per_mtok, c.output_usd_per_mtok,
                ROW_NUMBER() OVER (
                  PARTITION BY c.model_id,
                               coalesce(NULLIF(c.platform, ''), ''),
                               coalesce(c.account_id, 0),
                               coalesce(NULLIF(c.source_name, ''), '')
                  ORDER BY c.effective_from DESC, c.created_at DESC
                ) AS rn
           FROM pricing_costs c
          WHERE c.effective_from <= now()
            AND c.model_id = ANY($1::text[])
       ) latest
      WHERE rn = 1`,
    [modelIds],
  );

  const output = new Map<string, CostSnapshot>();
  for (const row of result.rows) {
    const next: CostSnapshot = {
      modelId: row.model_id,
      inputUsdMicrosPerMtok: Number(row.input_usd_per_mtok) * 1_000_000,
      outputUsdMicrosPerMtok: Number(row.output_usd_per_mtok) * 1_000_000,
      sourceName: row.source_name,
    };
    const current = output.get(row.model_id);
    const score = (item: CostSnapshot) =>
      item.inputUsdMicrosPerMtok + item.outputUsdMicrosPerMtok;
    if (!current || score(next) > score(current)) output.set(row.model_id, next);
  }
  return output;
}
