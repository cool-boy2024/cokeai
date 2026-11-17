import { randomUUID } from "node:crypto";
import { query } from "./db";
import { tokensFromUsage } from "./gateway";

/**
 * 内部 LLM 任务的计量记账。与网关的 reserveUsage/settleUsage 不同：
 * 内部任务不动任何用户余额，只把 token 与上游成本写进 usage_events
 * （internal = true），让 /admin/metrics 和日报能单独看到这块开销。
 *
 * 记账失败绝不影响业务：调用方拿到 null 继续走，成本最多少记一条。
 */

/** seed.mjs 幂等创建的系统账号，专门给内部任务挂 FK。 */
const INTERNAL_AGENT_EMAIL = "internal-agent@cokeai.local";

let cachedInternalUserId: string | null = null;

export async function getInternalAgentUserId(): Promise<string | null> {
  if (cachedInternalUserId) return cachedInternalUserId;
  const result = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1 LIMIT 1",
    [INTERNAL_AGENT_EMAIL],
  );
  cachedInternalUserId = result.rows[0]?.id ?? null;
  return cachedInternalUserId;
}

export type InternalUsageInput = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "succeeded" | "failed";
  errorCode?: string;
  /** 上游返回的 usage 原文，有缓存字段时一并解析入库。 */
  usagePayload?: unknown;
};

export async function recordInternalUsage(
  input: InternalUsageInput,
): Promise<string | null> {
  try {
    const userId = await getInternalAgentUserId();
    if (!userId) {
      // 系统账号没 seed（例如本地空库）就跳过记账，不让小店任务失败。
      return null;
    }
    const parsed = input.usagePayload ? tokensFromUsage(input.usagePayload) : null;
    const cacheRead = parsed?.cacheReadTokens ?? 0;
    const cacheWrite = parsed?.cacheWriteTokens ?? 0;
    const inserted = await query<{ id: string }>(
      `INSERT INTO usage_events
        (user_id, api_key_id, model_id, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reserved_micros,
         charged_micros, upstream_cost_micros, status, latency_ms,
         error_code, request_id, internal, finished_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, 0, 0, 0, $7, $8, $9, $10, TRUE, now())
       RETURNING id`,
      [
        userId,
        input.modelId,
        Math.max(0, Math.floor(input.inputTokens || 0)),
        Math.max(0, Math.floor(input.outputTokens || 0)),
        cacheRead,
        cacheWrite,
        input.status,
        Math.max(0, Math.floor(input.latencyMs || 0)),
        input.errorCode ? input.errorCode.slice(0, 64) : null,
        randomUUID(),
      ],
    );
    return inserted.rows[0]?.id ?? null;
  } catch (error) {
    console.error("[internal-usage] record failed", error);
    return null;
  }
}
