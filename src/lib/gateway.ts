import { calculateUsageCost, type ModelPrice } from "./money";
import { withTransaction } from "./db";

export type Reservation = {
  usageId: string;
  reservedMicros: number;
  balanceAfter: number;
};

export async function reserveUsage(input: {
  userId: string;
  apiKeyId: string;
  modelId: string;
  estimatedPromptTokens: number;
  maxOutputTokens: number;
  model: ModelPrice;
  reserveMicros: number;
  requestId?: string;
}): Promise<Reservation | null> {
  return withTransaction(async (client) => {
    const updated = await client.query<{ balance_micros: string }>(
      `UPDATE users
          SET balance_micros = balance_micros - $1,
              updated_at = now()
        WHERE id = $2
          AND status = 'active'
          AND plan_expires_at > now()
          AND balance_micros >= $1
        RETURNING balance_micros`,
      [input.reserveMicros, input.userId],
    );

    if (updated.rowCount === 0) return null;

    const usage = await client.query<{ id: string }>(
      `INSERT INTO usage_events
        (user_id, api_key_id, model_id, reserved_micros, status, request_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING id`,
      [
        input.userId,
        input.apiKeyId,
        input.modelId,
        input.reserveMicros,
        input.requestId ?? null,
      ],
    );

    return {
      usageId: usage.rows[0].id,
      reservedMicros: input.reserveMicros,
      balanceAfter: Number(updated.rows[0].balance_micros),
    };
  });
}

export type SettleInput = {
  usageId: string;
  model: ModelPrice;
  reservedMicros: number;
  inputTokens: number;
  outputTokens: number;
  status: "succeeded" | "failed";
  latencyMs?: number;
  errorCode?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export async function settleUsage(input: SettleInput): Promise<{
  chargedMicros: number;
  upstreamCostMicros: number;
}> {
  const inputTokens = Math.max(0, Math.floor(input.inputTokens || 0));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens || 0));
  const cacheReadTokens = Math.max(0, Math.floor(input.cacheReadTokens || 0));
  const cacheWriteTokens = Math.max(0, Math.floor(input.cacheWriteTokens || 0));
  const costs =
    input.status === "succeeded"
      ? calculateUsageCost(inputTokens, outputTokens, input.model)
      : { upstreamCostMicros: 0, chargedMicros: 0 };
  const adjustment = input.reservedMicros - costs.chargedMicros;

  await withTransaction(async (client) => {
    const updated = await client.query<{ user_id: string }>(
      `UPDATE usage_events
          SET input_tokens = $2,
              output_tokens = $3,
              upstream_cost_micros = $4,
              charged_micros = $5,
              status = $6,
              latency_ms = $7,
              error_code = $8,
              cache_read_tokens = $9,
              cache_write_tokens = $10,
              finished_at = now()
        WHERE id = $1
          AND status = 'pending'
        RETURNING user_id`,
      [
        input.usageId,
        inputTokens,
        outputTokens,
        costs.upstreamCostMicros,
        costs.chargedMicros,
        input.status,
        input.latencyMs ?? null,
        input.errorCode ? input.errorCode.slice(0, 64) : null,
        cacheReadTokens,
        cacheWriteTokens,
      ],
    );

    if (updated.rowCount === 0) return;

    await client.query(
      `UPDATE users
          SET balance_micros = GREATEST(0, balance_micros + $1),
              updated_at = now()
        WHERE id = $2`,
      [adjustment, updated.rows[0].user_id],
    );
  });

  return costs;
}

export function tokensFromUsage(payload: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: Record<string, unknown> }).usage;
  if (!usage) return null;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens);
  const output = Number(usage.completion_tokens ?? usage.output_tokens);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  // 缓存命中 token：OpenAI 兼容上游放在 prompt_tokens_details.cached_tokens，
  // Anthropic 风格则是 cache_read_input_tokens / cache_creation_input_tokens。
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const cacheRead = Math.max(
    Number(details?.cached_tokens ?? 0),
    Number(usage.cache_read_input_tokens ?? 0),
  );
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
    cacheReadTokens: Number.isFinite(cacheRead) ? Math.max(0, cacheRead) : 0,
    cacheWriteTokens: Number.isFinite(cacheWrite) ? Math.max(0, cacheWrite) : 0,
  };
}

export function estimateOutputTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 3));
}
