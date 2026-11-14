import { query } from "@/lib/db";
import { isSub2ApiConfigured } from "@/lib/sub2api/client";
import {
  applyCreditOpById,
  creditToMicros,
  enqueueAdjustment,
  getCreditOpByReference,
  getGatewayBalance,
  getLatestShopBalanceOp,
  SHOP_BALANCE_REVERSED,
  SHOP_BALANCE_REVERSAL_FAILED,
  shopBalanceAttempt,
  shopBalanceReference,
  type CreditOp,
} from "@/lib/gateway-credits";
import { markShopOrderPaid } from "./orders";
import { notifyShopOpsOnce } from "./ops-alert";

export type ShopBalanceSettlement =
  | { ok: true; orderNo: string; alreadyPaid: boolean }
  | {
      ok: false;
      code: "INSUFFICIENT" | "PROCESSING" | "FAILED" | "CLOSED" | "REVERSAL_FAILED";
      error: string;
    };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

function isReversed(op: CreditOp | null): boolean {
  const message = op?.last_error || "";
  return (
    message === SHOP_BALANCE_REVERSED ||
    message === SHOP_BALANCE_REVERSAL_FAILED ||
    message.startsWith(`${SHOP_BALANCE_REVERSED}：`) ||
    message.startsWith(`${SHOP_BALANCE_REVERSAL_FAILED}：`)
  );
}

/**
 * Settles one shop order with the account balance.
 *
 * The outbox row is the idempotency boundary: the reference is derived from the
 * order id, so a page reload or a double submit can never debit twice. A debit
 * that would take the balance below zero is reversed immediately and the order
 * stays pending for a retry after top-up. The reference is deliberately marked
 * terminal after a reversal so the generic retry worker cannot replay the
 * original (already visible in Sub2API balance history) debit.
 */
export async function settleShopBalanceOrder(input: {
  orderId: string;
  userId: string;
}): Promise<ShopBalanceSettlement> {
  const result = await query<{
    order_no: string;
    status: string;
    amount_micros: string | number;
    payment_provider: string;
  }>(
    `SELECT order_no, status, amount_micros, payment_provider
       FROM shop_orders
      WHERE id = $1 AND user_id = $2
      LIMIT 1`,
    [input.orderId, input.userId],
  );
  const order = result.rows[0];
  if (!order) return { ok: false, code: "FAILED", error: "订单不存在。" };
  if (order.payment_provider !== "balance") {
    return { ok: false, code: "FAILED", error: "该订单不是余额支付订单。" };
  }
  if (["paid", "procuring", "delivered"].includes(order.status)) {
    return { ok: true, orderNo: order.order_no, alreadyPaid: true };
  }
  if (order.status !== "pending_payment") {
    return { ok: false, code: "CLOSED", error: "订单已关闭，无法使用余额支付。" };
  }

  const amountMicros = Number(order.amount_micros);
  let op = await getLatestShopBalanceOp(input.orderId);
  if (op && op.user_id !== input.userId) {
    return { ok: false, code: "FAILED", error: "余额支付记录与当前账号不匹配。" };
  }
  let reference = op?.reference || shopBalanceReference(input.orderId);
  if (op && isReversed(op) && !op.last_error?.startsWith(SHOP_BALANCE_REVERSAL_FAILED)) {
    // A reversed debit is terminal. A retry (for example after topping up)
    // starts a new attempt so the original already-applied reference is never
    // replayed.
    const attempt = shopBalanceAttempt(op.reference) + 1;
    reference = shopBalanceReference(input.orderId, attempt);
    op = null;
  }

  if (op?.last_error?.startsWith(SHOP_BALANCE_REVERSAL_FAILED)) {
    await notifyShopOpsOnce(
      `shop-balance-reversal-failed:${input.orderId}`,
      [
        "【CokeAI 小店】余额支付冲正失败，需要人工核对",
        `订单号：${order.order_no}`,
        `用户：${input.userId}`,
        `金额：¥${(amountMicros / 1_000_000).toFixed(2)}`,
        "扣款后余额为负且自动冲正失败；订单仍为待付款，请勿重复扣款。",
      ].join("\n"),
    );
    return {
      ok: false,
      code: "REVERSAL_FAILED",
      error: "余额扣款需要人工核对，请稍后刷新订单页或联系客服。",
    };
  }

  if (!op) {
    // Check the authoritative balance before creating the debit. If Sub2API
    // is configured but unavailable, fail closed: a stale local mirror must
    // not authorise a charge.
    const balance = await getGatewayBalance(input.userId);
    if (isSub2ApiConfigured() && balance.source !== "gateway") {
      return {
        ok: false,
        code: "FAILED",
        error: "余额查询失败，请稍后重试。",
      };
    }
    if (creditToMicros(balance.balance) < amountMicros) {
      return {
        ok: false,
        code: "INSUFFICIENT",
        error: "账户余额不足，请充值后重试。",
      };
    }

    try {
      op = await enqueueAdjustment({
        userId: input.userId,
        amountMicros: -amountMicros,
        reference,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      op = await getCreditOpByReference(reference);
    }
    if (!op || op.user_id !== input.userId) {
      return { ok: false, code: "FAILED", error: "余额支付初始化失败，请重试。" };
    }
    reference = op.reference;
  }

  if (!op) {
    return { ok: false, code: "FAILED", error: "余额支付初始化失败，请重试。" };
  }
  if (op.status === "applying") {
    return {
      ok: false,
      code: "PROCESSING",
      error: "余额支付处理中，请稍后刷新订单页。",
    };
  }

  const applied = await applyCreditOpById(op.id, { requireNonNegative: true });
  if (!applied) {
    return { ok: false, code: "FAILED", error: "余额支付失败，请重试。" };
  }
  if (applied.status === "applied") {
    try {
      await markShopOrderPaid({
        orderNo: order.order_no,
        provider: "balance",
        providerRef: reference,
        paidAmountMicros: amountMicros,
        note: "账户余额支付",
      });
    } catch (error) {
      console.error(
        "[shop] balance paid but order update failed",
        order.order_no,
        error instanceof Error ? error.message : error,
      );
      return {
        ok: false,
        code: "PROCESSING",
        error: "扣款已完成，订单状态更新中；请刷新页面，不要重复付款。",
      };
    }
    return { ok: true, orderNo: order.order_no, alreadyPaid: false };
  }

  if (applied.last_error?.startsWith(SHOP_BALANCE_REVERSAL_FAILED)) {
    await notifyShopOpsOnce(
      `shop-balance-reversal-failed:${input.orderId}`,
      [
        "【CokeAI 小店】余额支付冲正失败，需要人工核对",
        `订单号：${order.order_no}`,
        `用户：${input.userId}`,
        `金额：¥${(amountMicros / 1_000_000).toFixed(2)}`,
        "扣款后余额为负且自动冲正失败；订单仍为待付款，请勿重复扣款。",
      ].join("\n"),
    );
    return {
      ok: false,
      code: "REVERSAL_FAILED",
      error: "余额扣款需要人工核对，请稍后刷新订单页或联系客服。",
    };
  }
  if (
    applied.last_error === "INSUFFICIENT_BALANCE" ||
    applied.last_error?.startsWith(SHOP_BALANCE_REVERSED)
  ) {
    return {
      ok: false,
      code: "INSUFFICIENT",
      error: "账户余额不足，请充值后重试。",
    };
  }
  return {
    ok: false,
    code: "FAILED",
    error: "余额支付未完成，请稍后重试。",
  };
}
