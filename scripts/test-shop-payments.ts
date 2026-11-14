import { randomUUID } from "node:crypto";
import { loadEnv } from "./env.mjs";

loadEnv();

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function assertThrows(fn: () => Promise<unknown>, includes: string, message: string) {
  return fn().then(
    () => {
      throw new Error(`ASSERT: ${message}（未抛错）`);
    },
    (error: unknown) => {
      checks += 1;
      const text = error instanceof Error ? error.message : String(error);
      if (!text.includes(includes)) {
        throw new Error(`ASSERT: ${message}（错误信息不符：${text}）`);
      }
      return error;
    },
  );
}

async function main() {
  const { query } = await import("../src/lib/db");
  const { suggestRetailPrice } = await import("../src/lib/shop/catalog");
  const { parseYuanMicros } = await import("../src/lib/payments/validation");
  const {
    markShopOrderPaid,
    rejectShopManualPaymentClaim,
    requestShopRefund,
    refundShopOrder,
  } = await import("../src/lib/shop/orders");

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let userId: string | null = null;
  const orderIds: string[] = [];

  async function makeOrder(input: {
    status: "pending_payment" | "paid" | "procuring" | "cancelled" | "refunded" | "refund_pending";
    provider: "manual" | "alipay_manual" | "usdt_trc20";
    amountMicros: number;
    itemStatus?: "pending" | "to_buy" | "bought" | "delivered" | "refunded" | "out_of_stock";
  }): Promise<{ id: string; orderNo: string }> {
    const orderNo = `TSHOP-${stamp}-${orderIds.length + 1}`;
    const inserted = await query<{ id: string }>(
      `INSERT INTO shop_orders
         (order_no, user_id, status, subtotal_micros, amount_micros,
          payment_provider, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, now() + interval '1 hour')
       RETURNING id`,
      [orderNo, userId, input.status, input.amountMicros, input.provider],
    );
    const id = inserted.rows[0].id;
    orderIds.push(id);
    await query(
      `INSERT INTO shop_order_items
         (order_id, product_slug, product_name, brand, unit_price_micros,
          qty, procurement_status)
       VALUES ($1, $2, 'Payments Test Item', 'other', $3, 1, $4)`,
      [id, `test-sku-${stamp}-${orderIds.length}`, input.amountMicros, input.itemStatus || "pending"],
    );
    return { id, orderNo };
  }

  async function orderStatus(id: string): Promise<string> {
    const result = await query<{ status: string }>("SELECT status FROM shop_orders WHERE id = $1", [id]);
    return result.rows[0]?.status ?? "missing";
  }

  async function eventCount(id: string, event: string): Promise<number> {
    const result = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM shop_order_events WHERE order_id = $1 AND event = $2",
      [id, event],
    );
    return Number(result.rows[0]?.count || 0);
  }

  async function itemStatus(orderId: string): Promise<string> {
    const result = await query<{ procurement_status: string }>(
      "SELECT procurement_status FROM shop_order_items WHERE order_id = $1",
      [orderId],
    );
    return result.rows[0]?.procurement_status ?? "missing";
  }

  try {
    // ------------------------------------------------------------------
    // 1. suggestRetailPrice：任意成本/毛利下都必须落在“分”边界（10000 micros）
    // ------------------------------------------------------------------
    const centCases: Array<[number, number]> = [
      [75_000_000, 2_200],
      [75_000_000, 3_000],
      [75_000_000, 0],
      [75_000_000, 9_999], // 超出上限，应按 9000 处理
      [12_345, 2_200],
      [1, 2_200],
      [107_142_858, 2_200],
      [99_999_999, 9_000],
      [7_500_000, 6_667],
    ];
    for (const [cost, margin] of centCases) {
      const retail = suggestRetailPrice(cost, margin);
      assert(retail > 0, `suggestRetailPrice(${cost}, ${margin}) 应大于 0`);
      assert(
        retail % 10_000 === 0,
        `suggestRetailPrice(${cost}, ${margin})=${retail} 不是 10000（1 分）的整数倍`,
      );
      assert(retail >= cost, `suggestRetailPrice(${cost}, ${margin})=${retail} 低于成本`);
    }
    assert(suggestRetailPrice(0) === 0, "成本为 0 时应返回 0");
    assert(suggestRetailPrice(-1) === 0, "负成本时应返回 0");
    assert(suggestRetailPrice(75_000_000) % 10_000 === 0, "默认毛利下应落在分边界");

    // 旧价格 107142858 显示为 ¥107.14；运营按 ¥107.14 填写得 107140000。
    const legacyAmount = 107_142_858;
    const enteredAmount = Number(parseYuanMicros("107.14"));
    assert(enteredAmount === 107_140_000, "parseYuanMicros('107.14') 应为 107140000");
    assert(
      Math.round(legacyAmount / 10_000) === Math.round(enteredAmount / 10_000),
      "旧值 107142858 与 ¥107.14 应落在同一分",
    );
    assert(
      Math.round(legacyAmount / 10_000) !== Math.round(107_150_000 / 10_000),
      "¥107.15 不应与 107142858 落在同一分",
    );

    // ------------------------------------------------------------------
    // 2. 数据库夹具
    // ------------------------------------------------------------------
    const user = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, referral_code)
       VALUES ($1, 'test-not-a-real-hash', 'Payments Test', 'admin', $2)
       RETURNING id`,
      [
        `shop-payments-${stamp}@example.test`,
        `PAY${stamp.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`,
      ],
    );
    userId = user.rows[0].id;
    const adminId = userId;

    const ref = (label: string) => `${label}${stamp.replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 80);

    // ------------------------------------------------------------------
    // 3. 手工渠道按分匹配：¥107.14 vs 107142858
    // ------------------------------------------------------------------
    const manual = await makeOrder({
      status: "pending_payment",
      provider: "manual",
      amountMicros: legacyAmount,
    });
    const manualPaid = await markShopOrderPaid({
      orderNo: manual.orderNo,
      provider: "manual",
      providerRef: ref("MANUAL"),
      paidAmountMicros: enteredAmount,
      adminId,
    });
    assert(manualPaid.alreadyPaid === false, "手工渠道 ¥107.14 应能确认付款");
    assert((await orderStatus(manual.id)) === "paid", "手工渠道确认后状态应为 paid");
    const receipt = await query<{ amount_micros: string }>(
      "SELECT amount_micros FROM payment_receipts WHERE order_id = $1",
      [manual.id],
    );
    assert(
      Number(receipt.rows[0]?.amount_micros) === enteredAmount,
      "收款登记应记录实际到账金额 107140000",
    );

    const manualAgain = await markShopOrderPaid({
      orderNo: manual.orderNo,
      provider: "manual",
      providerRef: ref("MANUAL"),
      paidAmountMicros: enteredAmount,
      adminId,
    });
    assert(manualAgain.alreadyPaid === true, "重复确认付款应幂等");

    const alipayManual = await makeOrder({
      status: "pending_payment",
      provider: "alipay_manual",
      amountMicros: legacyAmount,
    });
    const alipayManualPaid = await markShopOrderPaid({
      orderNo: alipayManual.orderNo,
      provider: "alipay_manual",
      providerRef: ref("ALIPAY"),
      paidAmountMicros: enteredAmount,
      adminId,
    });
    assert(!alipayManualPaid.alreadyPaid, "alipay_manual 渠道 ¥107.14 应按分匹配成功");
    assert((await orderStatus(alipayManual.id)) === "paid", "alipay_manual 确认后应为 paid");

    // ------------------------------------------------------------------
    // 3b. 同一交易号不能登记到第二张订单；打回后客户可重新提交
    // ------------------------------------------------------------------
    const duplicateRef = ref("DUPTX");
    const firstClaim = await makeOrder({
      status: "pending_payment",
      provider: "alipay_manual",
      amountMicros: 15_000_000,
    });
    await markShopOrderPaid({
      orderNo: firstClaim.orderNo,
      provider: "alipay_manual",
      providerRef: duplicateRef,
      paidAmountMicros: 15_000_000,
      adminId,
    });

    const secondClaim = await makeOrder({
      status: "pending_payment",
      provider: "alipay_manual",
      amountMicros: legacyAmount,
    });
    const duplicateError = await assertThrows(
      () =>
        markShopOrderPaid({
          orderNo: secondClaim.orderNo,
          provider: "alipay_manual",
          providerRef: duplicateRef,
          paidAmountMicros: enteredAmount,
          adminId,
        }),
      "已登记在小店订单",
      "同一交易号登记到第二张订单应被拒绝",
    );
    assert(
      duplicateError instanceof Error && duplicateError.message.includes(firstClaim.orderNo),
      "重复交易号错误信息应指出占用该交易号的订单号",
    );
    assert(
      (await orderStatus(secondClaim.id)) === "pending_payment",
      "重复交易号被拒后订单应保持待付款",
    );
    const noReceipt = await query(
      "SELECT 1 FROM payment_receipts WHERE order_id = $1",
      [secondClaim.id],
    );
    assert(noReceipt.rows.length === 0, "重复交易号不应给第二张订单写入收款记录");

    // 客户上报了错误交易号，运营打回；订单仍待付款，上报信息被清空。
    await query(
      `INSERT INTO manual_alipay_payments
         (order_id, order_kind, qr_data_url, payee, reported_reference, payer_note, reported_at)
       VALUES ($1, 'shop', 'data:image/png;base64,test', '测试收款人', $2, '客户备注', now())`,
      [secondClaim.id, duplicateRef],
    );
    await rejectShopManualPaymentClaim({
      orderId: secondClaim.id,
      adminId,
      reason: "该交易号已用于其他订单，请核对后重新提交",
    });
    const clearedClaim = await query<{ reported_at: string | null; reported_reference: string | null }>(
      "SELECT reported_at, reported_reference FROM manual_alipay_payments WHERE order_id = $1",
      [secondClaim.id],
    );
    assert(
      clearedClaim.rows[0]?.reported_at === null && clearedClaim.rows[0]?.reported_reference === null,
      "打回后应清空客户上报的交易号和时间",
    );
    assert(
      (await orderStatus(secondClaim.id)) === "pending_payment",
      "打回不应改变订单的待付款状态",
    );
    assert(
      (await eventCount(secondClaim.id, "payment_claim_rejected")) === 1,
      "打回应写入 1 条客户可见的事件",
    );
    const rejectedEvent = await query<{ note: string }>(
      "SELECT note FROM shop_order_events WHERE order_id = $1 AND event = 'payment_claim_rejected'",
      [secondClaim.id],
    );
    assert(
      rejectedEvent.rows[0]?.note === "该交易号已用于其他订单，请核对后重新提交",
      "打回原因应写入事件，供客户在支付页查看",
    );

    // 打回后客户改用正确交易号，可以正常确认。
    await markShopOrderPaid({
      orderNo: secondClaim.orderNo,
      provider: "alipay_manual",
      providerRef: ref("RETRYTX"),
      paidAmountMicros: enteredAmount,
      adminId,
    });
    assert(
      (await orderStatus(secondClaim.id)) === "paid",
      "打回后重新提交正确交易号应能确认到账",
    );

    const manualOffByOneCent = await makeOrder({
      status: "pending_payment",
      provider: "manual",
      amountMicros: legacyAmount,
    });
    await assertThrows(
      () =>
        markShopOrderPaid({
          orderNo: manualOffByOneCent.orderNo,
          provider: "manual",
          providerRef: ref("MANUALBAD"),
          paidAmountMicros: 107_150_000,
          adminId,
        }),
      "AMOUNT_MISMATCH",
      "手工渠道差 1 分应拒绝",
    );
    assert(
      (await orderStatus(manualOffByOneCent.id)) === "pending_payment",
      "金额不符时订单不应变为 paid",
    );

    // ------------------------------------------------------------------
    // 4. 其他渠道保持严格比较
    // ------------------------------------------------------------------
    const usdt = await makeOrder({
      status: "pending_payment",
      provider: "usdt_trc20",
      amountMicros: legacyAmount,
    });
    await assertThrows(
      () =>
        markShopOrderPaid({
          orderNo: usdt.orderNo,
          provider: "usdt_trc20",
          providerRef: ref("USDTBAD"),
          paidAmountMicros: enteredAmount,
        }),
      "AMOUNT_MISMATCH",
      "USDT 渠道不应放宽为按分匹配",
    );
    assert((await orderStatus(usdt.id)) === "pending_payment", "USDT 金额不符时状态不变");

    const usdtExact = await makeOrder({
      status: "pending_payment",
      provider: "usdt_trc20",
      amountMicros: legacyAmount,
    });
    const usdtExactPaid = await markShopOrderPaid({
      orderNo: usdtExact.orderNo,
      provider: "usdt_trc20",
      providerRef: ref("USDTOK"),
      paidAmountMicros: legacyAmount,
    });
    assert(!usdtExactPaid.alreadyPaid, "USDT 精确金额应能确认");
    assert((await orderStatus(usdtExact.id)) === "paid", "USDT 精确金额确认后应为 paid");

    // ------------------------------------------------------------------
    // 5. requestShopRefund 状态机
    // ------------------------------------------------------------------
    const paid = await makeOrder({
      status: "paid",
      provider: "manual",
      amountMicros: legacyAmount,
      itemStatus: "to_buy",
    });
    await requestShopRefund({ orderId: paid.id, adminId, reason: "客户协商退款" });
    assert((await orderStatus(paid.id)) === "refund_pending", "paid 应能转入 refund_pending");
    assert((await itemStatus(paid.id)) === "out_of_stock", "转退款后条目应为 out_of_stock");
    assert((await eventCount(paid.id, "refund_requested")) === 1, "应写入 1 条 refund_requested 事件");
    const event = await query<{ note: string; actor_type: string }>(
      "SELECT note, actor_type FROM shop_order_events WHERE order_id = $1 AND event = 'refund_requested'",
      [paid.id],
    );
    assert(event.rows[0]?.note === "客户协商退款", "退款事件应记录原因");
    assert(event.rows[0]?.actor_type === "admin", "退款事件操作人应为 admin");

    // 幂等：重复调用不报错，也不重复写事件。
    await requestShopRefund({ orderId: paid.id, adminId, reason: "重复点击" });
    assert((await orderStatus(paid.id)) === "refund_pending", "重复转退款应保持 refund_pending");
    assert((await eventCount(paid.id, "refund_requested")) === 1, "重复调用不应重复写事件");

    const procuring = await makeOrder({
      status: "procuring",
      provider: "manual",
      amountMicros: 50_000_000,
      itemStatus: "bought",
    });
    await requestShopRefund({ orderId: procuring.id, adminId });
    assert((await orderStatus(procuring.id)) === "refund_pending", "procuring 应能转入 refund_pending");
    assert((await eventCount(procuring.id, "refund_requested")) === 1, "procuring 转退款应写事件");

    for (const status of ["pending_payment", "cancelled", "refunded"] as const) {
      const blocked = await makeOrder({
        status,
        provider: "manual",
        amountMicros: 10_000_000,
        itemStatus: status === "refunded" ? "refunded" : "pending",
      });
      const before = await eventCount(blocked.id, "refund_requested");
      await assertThrows(
        () => requestShopRefund({ orderId: blocked.id, adminId }),
        "只有已支付、处理中的订单可以转退款协商",
        `${status} 状态不应能转退款协商`,
      );
      assert((await orderStatus(blocked.id)) === status, `${status} 状态不应被修改`);
      assert(
        (await eventCount(blocked.id, "refund_requested")) === before,
        `${status} 状态被拒绝时不应写事件`,
      );
    }

    await assertThrows(
      () => requestShopRefund({ orderId: randomUUID(), adminId }),
      "订单不存在",
      "不存在的订单应报错",
    );

    // ------------------------------------------------------------------
    // 6. refundShopOrder 登记退款，金额封顶
    // ------------------------------------------------------------------
    const refundsBefore = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM shop_refunds WHERE order_id = $1",
      [paid.id],
    );
    assert(Number(refundsBefore.rows[0]?.count) === 0, "退款前不应有退款记录");
    await refundShopOrder({
      orderId: paid.id,
      adminId,
      amountMicros: legacyAmount + 9_999_999, // 超过订单金额，应封顶
      reason: "协商退款",
      providerRef: ref("REFUND"),
    });
    assert((await orderStatus(paid.id)) === "refunded", "登记退款后应为 refunded");
    assert((await itemStatus(paid.id)) === "refunded", "登记退款后条目应为 refunded");
    const refundRows = await query<{ amount_micros: string; reason: string; provider_ref: string }>(
      "SELECT amount_micros, reason, provider_ref FROM shop_refunds WHERE order_id = $1",
      [paid.id],
    );
    assert(refundRows.rows.length === 1, "应写入 1 条退款记录");
    assert(
      Number(refundRows.rows[0]?.amount_micros) === legacyAmount,
      "退款金额应封顶为订单金额",
    );
    assert(refundRows.rows[0]?.reason === "协商退款", "退款原因应被记录");
    assert((await eventCount(paid.id, "refunded")) === 1, "应写入 refunded 事件");

    await refundShopOrder({
      orderId: paid.id,
      adminId,
      amountMicros: legacyAmount,
      reason: "重复登记",
    });
    const refundsAfter = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM shop_refunds WHERE order_id = $1",
      [paid.id],
    );
    assert(Number(refundsAfter.rows[0]?.count) === 1, "重复登记退款应幂等");
    assert((await eventCount(paid.id, "refunded")) === 1, "重复登记不应重复写 refunded 事件");

    const lessThanOrder = await makeOrder({
      status: "refund_pending",
      provider: "manual",
      amountMicros: 30_000_000,
      itemStatus: "out_of_stock",
    });
    await refundShopOrder({
      orderId: lessThanOrder.id,
      adminId,
      amountMicros: 12_340_000,
      reason: "部分退款",
    });
    const partial = await query<{ amount_micros: string }>(
      "SELECT amount_micros FROM shop_refunds WHERE order_id = $1",
      [lessThanOrder.id],
    );
    assert(Number(partial.rows[0]?.amount_micros) === 12_340_000, "小于订单金额的退款应原样登记");
    assert((await orderStatus(lessThanOrder.id)) === "refunded", "部分退款后订单应为 refunded");

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks,
          scenarios: {
            suggestRetailPriceCentAlignment: true,
            manualCentsMatching: "manual/alipay_manual",
            strictMatching: "usdt_trc20",
            refundStateMachine: ["paid", "procuring", "rejected"],
            refundAmountCapped: true,
            duplicateReceipt: "rejected with owner order; claim can be returned",
            eventsWritten: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    // 只清理本脚本创建的数据；订单删除会级联 items/events/refunds。
    if (orderIds.length > 0) {
      await query("DELETE FROM payment_receipts WHERE order_id = ANY($1::uuid[])", [orderIds]);
      await query("DELETE FROM manual_alipay_payments WHERE order_id = ANY($1::uuid[])", [orderIds]);
      await query("DELETE FROM shop_orders WHERE id = ANY($1::uuid[])", [orderIds]);
    }
    if (userId) {
      await query("DELETE FROM users WHERE id = $1", [userId]);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
