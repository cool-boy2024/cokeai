import { adminRequest, userRequest } from "./auth";
import type { GatewayIdentity } from "./identity";
import type { Sub2ApiPaginated, Sub2ApiUsageLog } from "./client";

export type AdminDashboardStats = {
  total_users: number;
  today_new_users: number;
  active_users: number;
  total_api_keys: number;
  active_api_keys: number;
  total_requests: number;
  total_tokens: number;
  total_actual_cost: number;
  today_requests: number;
  today_tokens: number;
  today_actual_cost: number;
  today_cost?: number;
  total_accounts?: number;
  normal_accounts?: number;
  error_accounts?: number;
  average_duration_ms?: number;
  rpm?: number;
  tpm?: number;
};

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  return adminRequest<AdminDashboardStats>("/api/v1/admin/dashboard/stats");
}

export type DashboardStats = {
  total_api_keys: number;
  active_api_keys: number;
  total_requests: number;
  total_tokens: number;
  total_actual_cost: number;
  today_requests: number;
  today_tokens: number;
  today_actual_cost: number;
  average_duration_ms: number;
  rpm: number;
  tpm: number;
};

export type TrendPoint = {
  date: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  actual_cost: number;
};

export type ModelStat = {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  actual_cost: number;
};

function identityArgs(identity: GatewayIdentity) {
  return [identity.user_id, identity.sub2api_email, identity.password_encrypted] as const;
}

export async function getUserDashboardStats(identity: GatewayIdentity): Promise<DashboardStats> {
  const [userId, email, password] = identityArgs(identity);
  return userRequest<DashboardStats>(
    userId,
    email,
    password,
    "/api/v1/usage/dashboard/stats",
  );
}

export async function getUserUsageTrend(
  identity: GatewayIdentity,
  startDate: string,
  endDate: string,
  granularity: "day" | "hour" = "day",
): Promise<TrendPoint[]> {
  const [userId, email, password] = identityArgs(identity);
  const data = await userRequest<{ trend?: TrendPoint[] }>(
    userId,
    email,
    password,
    `/api/v1/usage/dashboard/trend?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&granularity=${granularity}&timezone=Asia/Shanghai`,
  );
  return data.trend || [];
}

export async function getUserModelStats(
  identity: GatewayIdentity,
  startDate: string,
  endDate: string,
): Promise<ModelStat[]> {
  const [userId, email, password] = identityArgs(identity);
  const data = await userRequest<{ models?: ModelStat[] }>(
    userId,
    email,
    password,
    `/api/v1/usage/dashboard/models?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&timezone=Asia/Shanghai`,
  );
  return data.models || [];
}

export async function listUserUsage(
  identity: GatewayIdentity,
  options: {
    page?: number;
    pageSize?: number;
    startDate?: string;
    endDate?: string;
  } = {},
): Promise<Sub2ApiPaginated<Sub2ApiUsageLog>> {
  const [userId, email, password] = identityArgs(identity);
  const params = new URLSearchParams({
    page: String(options.page || 1),
    page_size: String(options.pageSize || 20),
    timezone: "Asia/Shanghai",
  });
  if (options.startDate) params.set("start_date", options.startDate);
  if (options.endDate) params.set("end_date", options.endDate);
  return userRequest<Sub2ApiPaginated<Sub2ApiUsageLog>>(
    userId,
    email,
    password,
    `/api/v1/usage?${params.toString()}`,
  );
}
