import { config } from "@/lib/config";

export type Sub2ApiEnvelope<T> = {
  code: number;
  message: string;
  reason?: string;
  metadata?: unknown;
  data: T;
};

/**
 * Sub2API stores IDs as BIGINT. Depending on the Go JSON encoder and the
 * database driver they may arrive as numbers (small values) or strings (large
 * values). Always treat them as opaque IDs and interpolate them through
 * sub2ApiPathId().
 */
export type Sub2ApiId = string | number;

export const LEGAL_ACK_REQUIRED_MESSAGE =
  "Sub2API 管理员账号尚未完成一次性法律确认。请通过 SSH 隧道登录 Sub2API 后台完成确认后重试（系统不会自动代为同意）。";

const LEGAL_ACK_PATTERNS = [
  /\blegal\b/i,
  /acknowledg/i,
  /disclaimer/i,
  /\bconsent\b/i,
  /\bterms\b/i,
  /\bagreement\b/i,
  /compliance/i,
  /法律/,
  /免责/,
  /条款/,
  /协议/,
  /同意/,
  /风险告知/,
  /管理员确认/,
  /合规/,
];

export function isLegalAcknowledgementMessage(message: string): boolean {
  return LEGAL_ACK_PATTERNS.some((pattern) => pattern.test(message));
}

export class Sub2ApiError extends Error {
  status: number;
  code?: number;
  reason?: string;
  requiresLegalAcknowledgement: boolean;

  constructor(
    message: string,
    status: number,
    code?: number,
    reason?: string,
    requiresLegalAcknowledgement = false,
  ) {
    super(message);
    this.name = "Sub2ApiError";
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.requiresLegalAcknowledgement = requiresLegalAcknowledgement;
  }
}

/**
 * Validates and stringifies a Sub2API BIGINT ID before it is interpolated into
 * a URL path. Throws instead of silently building a malformed path.
 */
export function sub2ApiPathId(value: Sub2ApiId | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Sub2ApiError("网关返回了无效的资源 ID", 0);
  }
  return text;
}

export function hasSub2ApiId(value: Sub2ApiId | null | undefined): value is Sub2ApiId {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) && text !== "0";
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  idempotencyKey?: string;
};

function urlFor(path: string): string {
  return `${config.sub2apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Calls the Sub2API HTTP API and unwraps its { code, message, data } envelope.
 * Never logs Authorization headers, API keys, or password fields.
 */
export async function sub2apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(urlFor(path), {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? config.sub2apiTimeoutMs),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "网关响应超时"
        : "无法连接网关";
    throw new Sub2ApiError(message, 0);
  }

  const text = await response.text();
  let payload: Sub2ApiEnvelope<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as Sub2ApiEnvelope<T>) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || payload.code !== 0) {
    const message =
      payload?.message ||
      payload?.reason ||
      (response.status === 401 ? "网关认证失败" : `网关请求失败 (${response.status})`);
    const requiresLegalAcknowledgement =
      response.status >= 400 &&
      response.status < 500 &&
      isLegalAcknowledgementMessage(`${message} ${payload?.reason || ""}`);
    throw new Sub2ApiError(
      requiresLegalAcknowledgement ? LEGAL_ACK_REQUIRED_MESSAGE : message,
      response.status,
      payload?.code,
      payload?.reason,
      requiresLegalAcknowledgement,
    );
  }

  return payload.data;
}

export function isSub2ApiConfigured(): boolean {
  return Boolean(
    config.sub2apiUrl &&
      config.sub2apiAdminEmail &&
      config.sub2apiAdminPassword &&
      config.sub2apiGroupId > 0,
  );
}

export type Sub2ApiLoginData = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

export type Sub2ApiUser = {
  id: Sub2ApiId;
  email: string;
  username?: string;
  role: string;
  balance: number;
  frozen_balance?: number;
  concurrency?: number;
  status: string;
  allowed_groups?: Sub2ApiId[] | null;
  total_recharged?: number;
  rpm_limit?: number;
  created_at?: string;
};

export type Sub2ApiApiKey = {
  id: Sub2ApiId;
  user_id: Sub2ApiId;
  key: string;
  name: string;
  group_id?: Sub2ApiId | null;
  status: string;
  quota?: number;
  quota_used?: number;
  created_at?: string;
  last_used_at?: string | null;
};

export type Sub2ApiUsageLog = {
  id: Sub2ApiId;
  user_id: Sub2ApiId;
  api_key_id?: Sub2ApiId;
  model?: string;
  requested_model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  total_cost?: number;
  actual_cost?: number;
  rate_multiplier?: number;
  duration_ms?: number;
  first_token_ms?: number;
  stream?: boolean;
  created_at: string;
  request_type?: string;
  billing_type?: number;
};

export type Sub2ApiPaginated<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type Sub2ApiProfile = {
  id: Sub2ApiId;
  email: string;
  username?: string;
  balance: number;
  frozen_balance?: number;
  concurrency?: number;
  status?: string;
  created_at?: string;
};
