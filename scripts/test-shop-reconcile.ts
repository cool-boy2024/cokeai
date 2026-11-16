import { loadEnv } from "./env.mjs";

loadEnv();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

/**
 * 支付宝账单对账端到端：
 *   1. 两笔同价待支付订单 → 一笔不带订单号的到账应该进「多单候选」；
 *   2. 带订单号的到账应该精确归属；
 *   3. 确认到账后订单变 paid，流水标记 settled；
 *   4. 同一份账单重复导入不产生重复流水；
 *   5. 同一条流水不能确认两次。
 */
async function main() {
  const { query } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth");
  const { savePaymentSettings } = await import("../src/lib/payments/settings");
  const { createShopOrder, findShopOrderByNo } = await import("../src/lib/shop/orders");
  const { importAlipayStatement, settleStatementRow } = await import(
    "../src/lib/shop/reconcile"
  );

  const stamp = Date.now();
  const admin = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role, referral_code)
     VALUES ($1, $2, 'Reconcile Admin', 'admin', $3) RETURNING id`,
    [
      `reconcile-admin-${stamp}@example.com`,
      await hashPassword("ShopTest123!"),
      `REC${stamp.toString(36).toUpperCase()}`,
    ],
  );
  const adminId = admin.rows[0].id;

  await savePaymentSettings(
    "alipay_manual",
    true,
    {
      payee: "CokeAI Reconcile",
      qrDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0x8AAAAASUVORK5CYII=",
    },
    adminId,
  );

  const buyer = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code)
     VALUES ($1, $2, 'Reconcile Buyer', $3) RETURNING id`,
    [
      `reconcile-buyer-${stamp}@example.com`,
      await hashPassword("ShopTest123!"),
      `RCB${stamp.toString(36).toUpperCase()}`,
    ],
  );
  const buyerId = buyer.rows[0].id;

  const product = await query<{
    id: string;
    price_micros: string;
    input_fields: unknown;
  }>(
    `SELECT id, price_micros, input_fields FROM shop_products
      WHERE status = 'active' AND copy_ready = TRUE ORDER BY sort_order LIMIT 1`,
  );
  assert(product.rows[0], "no active product");
  const item = product.rows[0];
  const fields = Array.isArray(item.input_fields)
    ? (item.input_fields as Array<{ key?: string; required?: boolean }>)
    : [];
  const customerInput: Record<string, string> = {};
  for (const field of fields) {
    if (field.required && field.key) customerInput[field.key] = "buyer@example.com";
  }

  const orderA = await createShopOrder({
    userId: buyerId,
    productId: item.id,
    expectedPriceMicros: Number(item.price_micros),
    paymentProvider: "alipay_manual",
    customerInput,
  });
  const orderB = await createShopOrder({
    userId: buyerId,
    productId: item.id,
    expectedPriceMicros: Number(item.price_micros),
    paymentProvider: "alipay_manual",
    customerInput,
  });
  assert(
    orderA.amountMicros === orderB.amountMicros,
    "两笔订单金额应相同，才能验证多单候选",
  );

  const amountMicros = orderA.amountMicros;
  const amountCents = Math.round(amountMicros / 10_000);
  const amountText = (amountCents / 100).toFixed(2);

  const baseRow = {
    direction: "income" as const,
    tradeStatus: "交易成功",
    counterparty: "张*",
    counterpartyAccount: "zhang***@example.com",
    productDesc: "转账",
    occurredAt: new Date().toISOString(),
  };

  // 1. 不带订单号 → 同金额两张单 → 多单候选。
  const ambiguous = await importAlipayStatement({
    adminId,
    rows: [
      {
        ...baseRow,
        tradeNo: `RCP${stamp}A`,
        amountMicros,
        remark: "转账",
        orderNo: null,
      },
    ],
  });
  assert(ambiguous.ambiguous === 1, `应进多单候选，实际 ${JSON.stringify(ambiguous)}`);

  // 2. 带订单号 → 精确归属。
  const matched = await importAlipayStatement({
    adminId,
    rows: [
      {
        ...baseRow,
        tradeNo: `RCP${stamp}B`,
        amountMicros,
        remark: `订单号 ${orderA.orderNo}`,
        orderNo: orderA.orderNo,
      },
    ],
  });
  assert(matched.matchedOrderNo === 1, `应按订单号归属，实际 ${JSON.stringify(matched)}`);

  // 3. 重复导入同一份账单 → 全部跳过。
  const repeated = await importAlipayStatement({
    adminId,
    rows: [
      {
        ...baseRow,
        tradeNo: `RCP${stamp}B`,
        amountMicros,
        remark: `订单号 ${orderA.orderNo}`,
        orderNo: orderA.orderNo,
      },
    ],
  });
  assert(repeated.duplicates === 1 && repeated.inserted === 0, "重复导入应被跳过");

  const matchedRow = await query<{ id: string; order_no: string | null }>(
    "SELECT id, order_no FROM alipay_statement_rows WHERE trade_no = $1",
    [`RCP${stamp}B`],
  );
  assert(matchedRow.rows[0]?.order_no === orderA.orderNo, "流水未归属到订单");

  // 4. 确认到账 → 订单变 paid。
  await settleStatementRow({
    adminId,
    rowId: matchedRow.rows[0].id,
    orderNo: orderA.orderNo,
  });
  const paidA = await findShopOrderByNo(orderA.orderNo, buyerId);
  assert(paidA?.status === "paid", "确认到账后订单未变 paid");
  assert(paidA.provider_ref === `RCP${stamp}B`, "交易号未写入订单");

  const settled = await query<{ settled_at: string | null }>(
    "SELECT settled_at FROM alipay_statement_rows WHERE id = $1",
    [matchedRow.rows[0].id],
  );
  assert(settled.rows[0]?.settled_at, "流水未标记 settled");

  // 5. 同一流水不能确认两次。
  let reused = false;
  try {
    await settleStatementRow({
      adminId,
      rowId: matchedRow.rows[0].id,
      orderNo: orderB.orderNo,
    });
  } catch {
    reused = true;
  }
  assert(reused, "同一条流水应拒绝二次确认");

  const stillPending = await findShopOrderByNo(orderB.orderNo, buyerId);
  assert(stillPending?.status === "pending_payment", "另一单不应被连带确认");

  // 6. 对账台首页要能把多单候选列出来（这条会走到 $2::timestamptz，
  //    以前 pg 的 Date 被 String() 后带中文时区名，这里会直接 500）。
  const { loadReconcileBoard } = await import("../src/lib/shop/reconcile");
  const board = await loadReconcileBoard();
  assert(board.ambiguous.length >= 1, "对账台应列出多单候选");
  assert(
    board.ambiguous[0].candidates.length >= 1,
    "多单候选应带出同金额的待支付订单",
  );
  assert(board.settled.length >= 1, "已确认流水应出现在最近记录里");

  console.log(
    JSON.stringify(
      {
        ok: true,
        amount: amountText,
        orderA: orderA.orderNo,
        ambiguous: ambiguous.ambiguous,
        matched: matched.matchedOrderNo,
        duplicates: repeated.duplicates,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
