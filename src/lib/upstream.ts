import { config } from "./config";
import { decryptSecret } from "./crypto";
import { query } from "./db";
import { loadLatestCosts } from "./pricing/cost-book";
import { computeRetailPrice } from "./pricing/retail";

export type GatewayModelRow = {
  id: string;
  upstream_id: string;
  upstream_model: string;
  display_name: string;
  description: string;
  input_price_usd_micros_per_mtok: string;
  output_price_usd_micros_per_mtok: string;
  markup_bps: string;
  min_plan_tier: number;
  context_window: number;
  enabled: boolean;
  upstream_name: string;
  base_url: string;
  api_key_encrypted: string | null;
  upstream_enabled: boolean;
  retail_input_cny_per_mtok?: number;
  retail_output_cny_per_mtok?: number;
};

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  // Keep existing keys working while the catalog moves to the current
  // DeepSeek generation. The old IDs are no longer listed publicly.
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
};

async function fetchGatewayModel(modelId: string): Promise<GatewayModelRow | null> {
  const result = await query<GatewayModelRow>(
    `SELECT m.id, m.upstream_id, m.upstream_model, m.display_name, m.description,
            m.input_price_usd_micros_per_mtok, m.output_price_usd_micros_per_mtok,
            m.markup_bps, m.min_plan_tier, m.context_window, m.enabled,
            u.name AS upstream_name, u.base_url, u.api_key_encrypted,
            u.enabled AS upstream_enabled
       FROM models m
       JOIN upstreams u ON u.id = m.upstream_id
      WHERE m.id = $1
      LIMIT 1`,
    [modelId],
  );
  return result.rows[0] || null;
}

async function withRetailPrice(model: GatewayModelRow): Promise<GatewayModelRow> {
  try {
    const cost = (await loadLatestCosts([model.id])).get(model.id);
    const retail = computeRetailPrice({
      officialInputUsdMicros: Number(model.input_price_usd_micros_per_mtok),
      officialOutputUsdMicros: Number(model.output_price_usd_micros_per_mtok),
      costInputUsdMicros: cost?.inputUsdMicrosPerMtok,
      costOutputUsdMicros: cost?.outputUsdMicrosPerMtok,
    });
    return {
      ...model,
      retail_input_cny_per_mtok: retail.inputCnyPerMtok,
      retail_output_cny_per_mtok: retail.outputCnyPerMtok,
    };
  } catch {
    // Billing still works with the legacy cost + markup fields.
    return model;
  }
}

export async function getGatewayModel(modelId: string): Promise<GatewayModelRow | null> {
  const direct = await fetchGatewayModel(modelId);
  if (direct?.enabled) return withRetailPrice(direct);

  const alias = LEGACY_MODEL_ALIASES[modelId];
  if (!alias) return direct ? withRetailPrice(direct) : null;

  const current = await fetchGatewayModel(alias);
  const resolved = current?.enabled ? current : direct;
  return resolved ? withRetailPrice(resolved) : null;
}

export function getUpstreamKey(model: GatewayModelRow): string {
  if (!model.upstream_enabled) throw new Error("UPSTREAM_DISABLED");
  if (!model.api_key_encrypted) throw new Error("UPSTREAM_NOT_CONFIGURED");
  return decryptSecret(model.api_key_encrypted);
}

export function upstreamChatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

const ALLOWED_FIELDS = [
  "messages",
  "temperature",
  "top_p",
  "stop",
  "max_tokens",
  "max_completion_tokens",
  "presence_penalty",
  "frequency_penalty",
  "logit_bias",
  "logprobs",
  "top_logprobs",
  "response_format",
  "seed",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "reasoning_effort",
] as const;

export type ChatRequestBody = Record<string, unknown> & {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  n?: number;
  stream_options?: Record<string, unknown>;
};

export function sanitizeChatRequest(
  input: ChatRequestBody,
  upstreamModel: string,
  maxOutputTokens: number,
): ChatRequestBody {
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error("messages 不能为空");
  }
  if (input.n !== undefined && input.n !== 1) {
    throw new Error("暂不支持 n > 1");
  }

  const output: ChatRequestBody = { model: upstreamModel };
  const outputRecord = output as Record<string, unknown>;
  for (const field of ALLOWED_FIELDS) {
    if (input[field] !== undefined) outputRecord[field] = input[field];
  }

  if (output.max_tokens === undefined && output.max_completion_tokens === undefined) {
    output.max_tokens = maxOutputTokens;
  }
  if (typeof output.max_tokens === "number") {
    output.max_tokens = Math.min(Math.max(1, output.max_tokens), maxOutputTokens);
  }
  if (typeof output.max_completion_tokens === "number") {
    output.max_completion_tokens = Math.min(
      Math.max(1, output.max_completion_tokens),
      maxOutputTokens,
    );
  }

  if (input.stream === true) {
    output.stream = true;
    output.stream_options = {
      ...(input.stream_options || {}),
      include_usage: true,
    };
  }

  return output;
}

export function requestedMaxOutputTokens(body: ChatRequestBody): number {
  const value = body.max_completion_tokens ?? body.max_tokens;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(Math.max(1, Math.floor(value)), config.hardMaxOutputTokens);
  }
  return Math.min(config.defaultMaxOutputTokens, config.hardMaxOutputTokens);
}

export function upstreamFetch(
  model: GatewayModelRow,
  body: ChatRequestBody,
  signal?: AbortSignal,
): Promise<Response> {
  const apiKey = getUpstreamKey(model);
  const timeout = AbortSignal.timeout(config.upstreamTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  return fetch(upstreamChatUrl(model.base_url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: body.stream ? "text/event-stream" : "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: combined,
    cache: "no-store",
  });
}

export function upstreamErrorMessage(status: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Upstream body is not JSON; return a safe generic message below.
  }
  if (status === 401 || status === 403) return "上游服务鉴权失败，请联系平台管理员。";
  if (status === 429) return "上游服务繁忙，请稍后重试。";
  if (status === 404) return "上游模型不存在或当前账号无权访问。";
  return "上游服务暂时不可用，请稍后重试。";
}
