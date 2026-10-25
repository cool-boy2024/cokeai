"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { query, toNumber, withTransaction } from "@/lib/db";
import { fulfillOrder } from "@/lib/orders";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function saved(path: string): never {
  redirect(`${path}?saved=1`);
}

function decimal(value: FormDataEntryValue | null, field: string): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) throw new Error(`${field}格式无效`);
  return parsed;
}

function integer(value: FormDataEntryValue | null, field: string): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) throw new Error(`${field}格式无效`);
  return parsed;
}

function yuanToMicros(value: FormDataEntryValue | null, field: string): number {
  const amount = decimal(value, field);
  if (amount < 0) throw new Error(`${field}不能为负数`);
  return Math.round(amount * 1_000_000);
}

export async function updateOrderAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const orderId = String(formData.get("orderId") || "");
  const action = String(formData.get("action") || "");
  if (!orderId) fail("/admin/orders", "缺少订单号");

  try {
    if (action === "paid") {
      await fulfillOrder(orderId);
    } else if (action === "cancelled") {
      const cancelled = await query(
        `UPDATE orders
            SET status = 'cancelled', updated_at = now()
          WHERE id = $1
            AND status = 'pending'
            AND payment_provider = 'manual'`,
        [orderId],
      );
      if (cancelled.rowCount === 0) {
        fail("/admin/orders", "在线支付订单不能手动取消，请先在支付渠道处理");
      }
    } else {
      fail("/admin/orders", "操作无效");
    }
  } catch (error) {
    fail("/admin/orders", error instanceof Error ? error.message : "操作失败");
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  saved("/admin/orders");
}

export async function updateUserStatusAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const status = String(formData.get("status") || "");
  if (!userId || !["active", "disabled"].includes(status)) {
    fail("/admin/users", "参数无效");
  }
  if (userId === admin.id) fail("/admin/users", "不能停用当前管理员账户");

  if (status === "disabled") {
    const activeAdmins = await query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
      [userId],
    );
    if (toNumber(activeAdmins.rows[0]?.count) === 0) {
      fail("/admin/users", "至少需要保留一个可用管理员");
    }
  }

  await query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [
    userId,
    status,
  ]);
  revalidatePath("/admin/users");
  saved("/admin/users");
}

export async function adjustBalanceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const note = String(formData.get("note") || "").trim();
  let deltaMicros: number;
  try {
    deltaMicros = Math.round(decimal(formData.get("amountYuan"), "调整金额") * 1_000_000);
  } catch (error) {
    fail("/admin/users", error instanceof Error ? error.message : "金额无效");
  }
  if (!userId) fail("/admin/users", "缺少用户");
  if (!deltaMicros) fail("/admin/users", "调整金额不能为 0");
  if (!note || note.length > 200) fail("/admin/users", "请填写 200 字以内的调整原因");

  try {
    await withTransaction(async (client) => {
      const user = await client.query<{ balance_micros: string }>(
        "SELECT balance_micros FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!user.rows[0]) throw new Error("用户不存在");
      const newBalance = toNumber(user.rows[0].balance_micros) + deltaMicros;
      if (newBalance < 0) throw new Error("扣减金额超过当前余额");
      await client.query(
        "UPDATE users SET balance_micros = $2, updated_at = now() WHERE id = $1",
        [userId, newBalance],
      );
      await client.query(
        `INSERT INTO balance_adjustments (user_id, admin_id, amount_micros, note)
         VALUES ($1, $2, $3, $4)`,
        [userId, admin.id, deltaMicros, note],
      );
    });
  } catch (error) {
    fail("/admin/users", error instanceof Error ? error.message : "调整失败");
  }

  revalidatePath("/admin/users");
  saved("/admin/users");
}

export async function payCommissionAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const commissionId = String(formData.get("commissionId") || "");
  if (!commissionId) fail("/admin", "缺少佣金记录");
  await query(
    `UPDATE commissions
        SET status = 'paid', updated_at = now()
      WHERE id = $1 AND status = 'available'`,
    [commissionId],
  );
  revalidatePath("/admin");
  saved("/admin");
}

export async function updateUpstreamAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const baseUrl = String(formData.get("baseUrl") || "").trim().replace(/\/+$/, "");
  const newApiKey = String(formData.get("apiKey") || "").trim();
  const enabled = formData.get("enabled") === "on";

  if (!id || !name) fail("/admin/models", "上游名称不能为空");
  try {
    new URL(baseUrl);
  } catch {
    fail("/admin/models", "Base URL 格式无效");
  }

  const existing = await query<{ api_key_encrypted: string | null }>(
    "SELECT api_key_encrypted FROM upstreams WHERE id = $1",
    [id],
  );
  if (!existing.rows[0]) fail("/admin/models", "上游不存在");
  const hasKey = Boolean(newApiKey || existing.rows[0].api_key_encrypted);
  if (enabled && !hasKey) fail("/admin/models", "启用上游前必须填写 API Key");

  const encrypted = newApiKey ? encryptSecret(newApiKey) : existing.rows[0].api_key_encrypted;
  await query(
    `UPDATE upstreams
        SET name = $2, base_url = $3, api_key_encrypted = $4, enabled = $5, updated_at = now()
      WHERE id = $1`,
    [id, name, baseUrl, encrypted, enabled],
  );
  revalidatePath("/admin/models");
  revalidatePath("/");
  saved("/admin/models");
}

export async function createUpstreamAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const baseUrl = String(formData.get("baseUrl") || "").trim().replace(/\/+$/, "");
  const apiKey = String(formData.get("apiKey") || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(id)) {
    fail("/admin/models", "上游标识需为 3-40 位小写字母、数字或连字符");
  }
  if (!name) fail("/admin/models", "请输入上游名称");
  try {
    new URL(baseUrl);
  } catch {
    fail("/admin/models", "Base URL 格式无效");
  }
  if (!apiKey) fail("/admin/models", "请输入 API Key");

  try {
    await query(
      `INSERT INTO upstreams (id, name, base_url, api_key_encrypted, enabled)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [id, name, baseUrl, encryptSecret(apiKey)],
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : "";
    fail("/admin/models", code === "23505" ? "上游标识已存在" : "创建上游失败");
  }
  revalidatePath("/admin/models");
  saved("/admin/models");
}

export async function updateModelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  const upstreamModel = String(formData.get("upstreamModel") || "").trim();
  const inputUsd = decimal(formData.get("inputUsd"), "输入价格");
  const outputUsd = decimal(formData.get("outputUsd"), "输出价格");
  const markupPercent = decimal(formData.get("markupPercent"), "加价比例");
  const minPlanTier = integer(formData.get("minPlanTier"), "最低套餐等级");
  const contextWindow = integer(formData.get("contextWindow"), "上下文窗口");
  const enabled = formData.get("enabled") === "on";

  if (!id || !displayName || !upstreamModel) fail("/admin/models", "模型信息不完整");
  if (inputUsd < 0 || outputUsd < 0) fail("/admin/models", "模型价格不能为负数");
  if (markupPercent < 100 || markupPercent > 500) {
    fail("/admin/models", "加价比例应在 100%-500% 之间");
  }
  if (![0, 1, 2].includes(minPlanTier)) fail("/admin/models", "套餐等级无效");
  if (contextWindow < 1000) fail("/admin/models", "上下文窗口过小");

  const readiness = await query<{ ready: boolean }>(
    `SELECT (u.enabled AND u.api_key_encrypted IS NOT NULL) AS ready
       FROM models m JOIN upstreams u ON u.id = m.upstream_id
      WHERE m.id = $1`,
    [id],
  );
  if (!readiness.rows[0]) fail("/admin/models", "模型不存在");
  if (enabled && !readiness.rows[0].ready) {
    fail("/admin/models", "启用模型前请先配置并启用对应上游");
  }

  await query(
    `UPDATE models
        SET display_name = $2, upstream_model = $3,
            input_price_usd_micros_per_mtok = $4,
            output_price_usd_micros_per_mtok = $5,
            markup_bps = $6, min_plan_tier = $7, context_window = $8,
            enabled = $9, updated_at = now()
      WHERE id = $1`,
    [
      id,
      displayName,
      upstreamModel,
      Math.round(inputUsd * 1_000_000),
      Math.round(outputUsd * 1_000_000),
      Math.round(markupPercent * 100),
      minPlanTier,
      contextWindow,
      enabled,
    ],
  );
  revalidatePath("/admin/models");
  revalidatePath("/");
  revalidatePath("/dashboard");
  saved("/admin/models");
}

export async function createModelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "").trim().toLowerCase();
  const upstreamId = String(formData.get("upstreamId") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  const upstreamModel = String(formData.get("upstreamModel") || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,60}[a-z0-9]$/.test(id)) {
    fail("/admin/models", "模型 ID 需为 3-62 位小写字母、数字、点、下划线或连字符");
  }
  if (!upstreamId || !displayName || !upstreamModel) {
    fail("/admin/models", "模型信息不完整");
  }
  try {
    await query(
      `INSERT INTO models
        (id, upstream_id, upstream_model, display_name, description,
         input_price_usd_micros_per_mtok, output_price_usd_micros_per_mtok,
         markup_bps, min_plan_tier, context_window, enabled, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 18000, 0, 128000, FALSE, 100)`,
      [
        id,
        upstreamId,
        upstreamModel,
        displayName,
        String(formData.get("description") || "").trim().slice(0, 300),
        Math.round(decimal(formData.get("inputUsd"), "输入价格") * 1_000_000),
        Math.round(decimal(formData.get("outputUsd"), "输出价格") * 1_000_000),
      ],
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : "";
    fail("/admin/models", code === "23505" ? "模型 ID 已存在" : "创建模型失败");
  }
  revalidatePath("/admin/models");
  saved("/admin/models");
}

export async function updatePlanAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const tagline = String(formData.get("tagline") || "").trim();
  const tier = integer(formData.get("tier"), "套餐等级");
  const days = integer(formData.get("durationDays"), "有效天数");
  const priceMicros = yuanToMicros(formData.get("priceYuan"), "售价");
  const creditsMicros = yuanToMicros(formData.get("creditsYuan"), "额度");
  const active = formData.get("active") === "on";
  const highlight = formData.get("highlight") === "on";
  const features = String(formData.get("features") || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (!id || !name || !tagline) fail("/admin/plans", "套餐信息不完整");
  if (![0, 1, 2].includes(tier)) fail("/admin/plans", "套餐等级无效");
  if (days < 1 || days > 3650) fail("/admin/plans", "有效天数无效");
  if (priceMicros <= 0) fail("/admin/plans", "售价必须大于 0");
  if (creditsMicros <= 0) fail("/admin/plans", "额度必须大于 0");
  if (features.length === 0) fail("/admin/plans", "至少填写一条套餐权益");

  await query(
    `UPDATE plans
        SET name = $2, tagline = $3, tier = $4, duration_days = $5,
            price_micros = $6, credits_micros = $7, features = $8::jsonb,
            active = $9, highlight = $10
      WHERE id = $1`,
    [
      id,
      name,
      tagline,
      tier,
      days,
      priceMicros,
      creditsMicros,
      JSON.stringify(features),
      active,
      highlight,
    ],
  );
  revalidatePath("/admin/plans");
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/dashboard/billing");
  saved("/admin/plans");
}
