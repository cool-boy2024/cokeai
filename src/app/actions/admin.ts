"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber, withTransaction } from "@/lib/db";
import {
  applyCreditOpById,
  enqueueAdjustment,
} from "@/lib/gateway-credits";
import { fulfillOrder } from "@/lib/orders";
import { syncPricing } from "@/lib/pricing/engine";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";
import { setRemoteUserStatus } from "@/lib/sub2api/identity";

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
      throw new Error("请通过订单的核实到账入口填写实际收款记录");
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

  if (isSub2ApiConfigured()) {
    try {
      await setRemoteUserStatus(userId, status as "active" | "disabled");
    } catch (error) {
      fail(
        "/admin/users",
        error instanceof Error ? `网关状态更新失败：${error.message}` : "网关状态更新失败",
      );
    }
  }

  await query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [
    userId,
    status,
  ]);
  revalidatePath("/admin/users");
  saved("/admin/users");
}

/**
 * Promote or demote an operator. Every admin can grant admin, matching how the
 * shop is run: the owner makes the partner an admin once, and the partner can
 * then add the rest of the team. Two guards keep this from locking anyone out:
 * an admin cannot change their own role, and the last active admin cannot be
 * demoted.
 */
export async function setUserRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  if (!userId || !["user", "admin"].includes(role)) {
    fail("/admin/users", "参数无效");
  }
  if (userId === admin.id) {
    fail("/admin/users", "不能修改自己的角色，请让另一位管理员操作");
  }

  if (role === "user") {
    const otherAdmins = await query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
      [userId],
    );
    if (toNumber(otherAdmins.rows[0]?.count) === 0) {
      fail("/admin/users", "至少需要保留一位可用管理员");
    }
  }

  const updated = await query(
    "UPDATE users SET role = $2, updated_at = now() WHERE id = $1",
    [userId, role],
  );
  if (updated.rowCount === 0) fail("/admin/users", "用户不存在");

  revalidatePath("/admin/users");
  saved("/admin/users");
}

export async function adjustBalanceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") || "");
  const note = String(formData.get("note") || "").trim();
  let deltaMicros = 0;
  try {
    deltaMicros = Math.round(decimal(formData.get("amountYuan"), "调整金额") * 1_000_000);
  } catch (error) {
    fail("/admin/users", error instanceof Error ? error.message : "金额无效");
  }
  if (!userId) fail("/admin/users", "缺少用户");
  if (!deltaMicros) fail("/admin/users", "调整金额不能为 0");
  if (!note || note.length > 200) fail("/admin/users", "请填写 200 字以内的调整原因");

  let opId = "";
  try {
    await withTransaction(async (client) => {
      const user = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!user.rows[0]) throw new Error("用户不存在");
      const op = await enqueueAdjustment(
        {
          userId,
          amountMicros: deltaMicros,
          reference: `cokeai-adjust:${randomUUID()}`,
        },
        client,
      );
      opId = op.id;
      await client.query(
        `INSERT INTO balance_adjustments (user_id, admin_id, amount_micros, note)
         VALUES ($1, $2, $3, $4)`,
        [userId, admin.id, deltaMicros, note],
      );
    });
  } catch (error) {
    fail("/admin/users", error instanceof Error ? error.message : "调整失败");
  }

  if (opId) {
    const applied = await applyCreditOpById(opId);
    if (applied?.status === "failed") {
      fail("/admin/users", "额度调整已登记，但网关暂未到账，请稍后重试");
    }
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

export async function updatePlanAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const tagline = String(formData.get("tagline") || "").trim();
  const priceMicros = yuanToMicros(formData.get("priceYuan"), "售价");
  const creditsMicros = yuanToMicros(formData.get("creditsYuan"), "额度");
  const active = formData.get("active") === "on";
  const highlight = formData.get("highlight") === "on";

  if (!id || !name) fail("/admin/plans", "充值包信息不完整");
  if (priceMicros <= 0) fail("/admin/plans", "售价必须大于 0");
  if (creditsMicros <= 0) fail("/admin/plans", "额度必须大于 0");

  await query(
    `UPDATE plans
        SET name = $2, tagline = $3, tier = 0, duration_days = 36500,
            price_micros = $4, credits_micros = $5, features = '[]'::jsonb,
            active = $6, highlight = $7
      WHERE id = $1`,
    [id, name, tagline, priceMicros, creditsMicros, active, highlight],
  );
  revalidatePath("/admin/plans");
  revalidatePath("/");
  revalidatePath("/pricing");
  revalidatePath("/dashboard/billing");
  saved("/admin/plans");
}

export async function upsertPricingCostAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const modelId = String(formData.get("modelId") || "").trim();
  const platform = String(formData.get("platform") || "").trim();
  const sourceName = String(formData.get("sourceName") || "").trim().slice(0, 80);
  const accountIdRaw = String(formData.get("accountId") || "").trim();
  const accountId = accountIdRaw ? Number.parseInt(accountIdRaw, 10) : null;
  if (!modelId) fail("/admin/pricing", "模型 ID 不能为空");
  if (accountIdRaw && (!Number.isFinite(accountId) || Number(accountId) <= 0)) {
    fail("/admin/pricing", "账号 ID 无效");
  }

  let inputUsd = 0;
  let outputUsd = 0;
  let cacheReadUsd = 0;
  let cacheWriteUsd = 0;
  let perRequestUsd = 0;
  try {
    inputUsd = decimal(formData.get("inputUsd"), "输入成本");
    outputUsd = decimal(formData.get("outputUsd"), "输出成本");
    cacheReadUsd = decimal(formData.get("cacheReadUsd"), "缓存读成本");
    cacheWriteUsd = decimal(formData.get("cacheWriteUsd"), "缓存写成本");
    perRequestUsd = decimal(formData.get("perRequestUsd"), "按次成本");
  } catch (error) {
    fail("/admin/pricing", error instanceof Error ? error.message : "成本格式无效");
  }
  if (inputUsd < 0 || outputUsd < 0 || cacheReadUsd < 0 || cacheWriteUsd < 0 || perRequestUsd < 0) {
    fail("/admin/pricing", "成本不能为负数");
  }
  if (inputUsd <= 0 && outputUsd <= 0 && perRequestUsd <= 0) {
    fail("/admin/pricing", "至少填写输入/输出或按次成本");
  }

  await query(
    `INSERT INTO pricing_costs
      (model_id, platform, account_id, source_name,
       input_usd_per_mtok, output_usd_per_mtok,
       cache_read_usd_per_mtok, cache_write_usd_per_mtok,
       per_request_usd, effective_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [
      modelId,
      platform,
      accountId,
      sourceName,
      inputUsd,
      outputUsd,
      cacheReadUsd,
      cacheWriteUsd,
      perRequestUsd,
    ],
  );
  revalidatePath("/admin/pricing");
  saved("/admin/pricing");
}

export async function deletePricingCostAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) fail("/admin/pricing", "缺少记录");
  await query("DELETE FROM pricing_costs WHERE id = $1", [id]);
  revalidatePath("/admin/pricing");
  saved("/admin/pricing");
}

export async function syncPricingAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const force = formData.get("force") === "on";
  try {
    const result = await syncPricing({ force });
    redirect(
      `/admin/pricing?synced=1&active=${result.modelsActive}&paused=${result.modelsPaused}`,
    );
  } catch (error) {
    fail(
      "/admin/pricing",
      error instanceof Error ? `同步失败：${error.message}` : "同步失败",
    );
  }
}
