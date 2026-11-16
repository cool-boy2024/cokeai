import { randomUUID } from "node:crypto";
import { loadEnv } from "./env.mjs";

loadEnv();

// This test exercises the local balance mirror (CI and rollback mode). Force
// the gateway credentials off before any module reads lib/config so a local
// .env that also contains staging credentials can never move real credits.
process.env.SUB2API_ADMIN_EMAIL = "";
process.env.SUB2API_ADMIN_PASSWORD = "";
process.env.SUB2API_GROUP_ID = "0";

let checks = 0;

function assert(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  const { query } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth");
  const { createShopOrder, expireShopOrders } = await import(
    "../src/lib/shop/orders"
  );
  const { settleShopBalanceOrder } = await import("../src/lib/shop/balance");
  const {
    applyCreditOpById,
    enqueueAdjustment,
    getLatestShopBalanceOp,
    shopBalanceAttempt,
    shopBalanceReference,
  } = await import("../src/lib/gateway-credits");
  const { buildAlertConfig } = await import("../src/lib/alerts");

  // Pure reference helpers.
  const orderId = randomUUID();
  assert(
    shopBalanceReference(orderId) === `cokeai-shop-balance:${orderId}`,
    "首次余额支付流水号不正确",
  );
  assert(
    shopBalanceReference(orderId, 2) === `cokeai-shop-balance:${orderId}:2`,
    "重试流水号不正确",
  );
  assert(shopBalanceAttempt(shopBalanceReference(orderId)) === 1, "首次流水号应解析为第 1 次");
  assert(shopBalanceAttempt(shopBalanceReference(orderId, 2)) === 2, "重试流水号应解析为第 2 次");

  // Alert settings: email copy and the two-way Reply-To mailbox.
  const smtp = {
    host: "smtp.example.com",
    port: 465,
    user: "sender@example.com",
    pass: "secret",
    from: "sender@example.com",
    to: "partner@example.com",
    replyTo: "",
  };
  // Partner mailbox and the separate customer mailbox are two identities.
  const customerSmtp = {
    host: "smtp.feishu.cn",
    port: 465,
    user: "support@example.com",
    pass: "customer-secret",
    from: "support@example.com",
    to: "",
    replyTo: "support@example.com",
  };
  const current = {
    channel: "wecom" as const,
    webhookUrl: "https://example.com/hook",
    smtp,
    customerSmtp,
    emailCopy: false,
  };
  const copy = buildAlertConfig(
    {
      channel: "wecom",
      ...{
        smtpHost: smtp.host,
        smtpPort: String(smtp.port),
        smtpUser: smtp.user,
        smtpPass: smtp.pass,
        smtpFrom: smtp.from,
        smtpTo: smtp.to,
        smtpReplyTo: "reply@example.com",
      },
      emailCopy: "1",
    },
    current,
  );
  assert("config" in copy && copy.config.emailCopy, "勾选邮件副本后应写入 emailCopy=true");
  assert(
    "config" in copy && copy.config.smtp.replyTo === "reply@example.com",
    "Reply-To 应保存伙伴回复邮箱",
  );

  const blankReply = buildAlertConfig(
    {
      channel: "email",
      smtpHost: smtp.host,
      smtpPort: String(smtp.port),
      smtpUser: smtp.user,
      smtpPass: smtp.pass,
      smtpFrom: smtp.from,
      smtpTo: smtp.to,
      smtpReplyTo: "",
    },
    current,
  );
  assert(
    "config" in blankReply && blankReply.config.smtp.replyTo === smtp.from,
    "Reply-To 留空时应回落到发件人",
  );

  const badReply = buildAlertConfig(
    {
      channel: "email",
      smtpHost: smtp.host,
      smtpPort: String(smtp.port),
      smtpUser: smtp.user,
      smtpPass: smtp.pass,
      smtpFrom: smtp.from,
      smtpTo: smtp.to,
      smtpReplyTo: "not-an-email",
    },
    current,
  );
  assert("error" in badReply, "无效 Reply-To 应被拒绝");

  const copyOff = buildAlertConfig({ channel: "wecom", emailCopy: "" }, current);
  assert(
    "config" in copyOff && !copyOff.config.emailCopy,
    "取消勾选后应关闭邮件副本",
  );

  // 客户发件箱：关闭告警不能把它一起清掉；改伙伴邮箱也不能顶掉它。
  const alertsOff = buildAlertConfig({ channel: "off" }, current);
  assert(
    "config" in alertsOff &&
      alertsOff.config.customerSmtp.user === customerSmtp.user &&
      alertsOff.config.customerSmtp.pass === customerSmtp.pass,
    "关闭告警不应清空客户邮件发件箱",
  );
  assert(
    "config" in copy && copy.config.customerSmtp.user === customerSmtp.user,
    "只改伙伴邮箱时客户发件箱应保持不变",
  );

  const separated = buildAlertConfig(
    {
      channel: "email",
      smtpHost: "smtp.feishu.cn",
      smtpPort: "465",
      smtpUser: "partner@example.com",
      smtpPass: "partner-secret",
      smtpFrom: "partner@example.com",
      smtpTo: "partner@example.com",
      smtpReplyTo: "",
      customerSmtpHost: "smtp.feishu.cn",
      customerSmtpPort: "465",
      customerSmtpUser: "support@example.com",
      customerSmtpPass: "customer-secret-2",
      customerSmtpFrom: "support@example.com",
    },
    current,
  );
  assert(
    "config" in separated &&
      separated.config.smtp.user === "partner@example.com" &&
      separated.config.customerSmtp.user === "support@example.com" &&
      separated.config.customerSmtp.pass === "customer-secret-2" &&
      separated.config.customerSmtp.to === "",
    "伙伴邮箱和客户发件箱应各自保存，互不覆盖",
  );

  const badCustomer = buildAlertConfig(
    {
      channel: "email",
      smtpHost: smtp.host,
      smtpPort: String(smtp.port),
      smtpUser: smtp.user,
      smtpPass: smtp.pass,
      smtpFrom: smtp.from,
      smtpTo: smtp.to,
      customerSmtpHost: "smtp.feishu.cn",
      customerSmtpPort: "465",
      customerSmtpUser: "not-an-email",
      customerSmtpPass: "x",
      customerSmtpFrom: "support@example.com",
    },
    current,
  );
  assert("error" in badCustomer, "客户发件箱账号非法时应被拒绝");

  // Integration: order creation + local balance settlement.
  const passwordHash = await hashPassword("ShopBalance123!");
  const stamp = `${Date.now()}`;
  const buyer = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code, balance_micros)
     VALUES ($1, $2, 'Balance Test', $3, 0) RETURNING id`,
    [`shop-balance-${stamp}@example.com`, passwordHash, `BAL${stamp}`],
  );
  const userId = buyer.rows[0].id;
  const other = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, referral_code)
     VALUES ($1, $2, 'Balance Other', $3) RETURNING id`,
    [`shop-balance-other-${stamp}@example.com`, passwordHash, `BOT${stamp}`],
  );
  const otherUserId = other.rows[0].id;

  const products = await query<{
    id: string;
    price_micros: string;
    input_fields: unknown;
  }>(
    `SELECT id, price_micros, input_fields
       FROM shop_products
      WHERE status = 'active' AND copy_ready = TRUE
        AND availability IN ('in_stock', 'low_stock')
      ORDER BY sort_order
      LIMIT 20`,
  );
  const product = products.rows.find((row) => {
    const fields = Array.isArray(row.input_fields) ? row.input_fields : [];
    return !fields.some(
      (field) =>
        typeof field === "object" &&
        field !== null &&
        (field as { required?: boolean }).required,
    );
  });
  assert(product, "没有可用于余额测试的无必填商品");
  const price = Number(product.price_micros);
  assert(price > 0, "测试商品价格应为正数");

  const orderIds: string[] = [];
  try {
    await query("UPDATE users SET balance_micros = $2 WHERE id = $1", [
      userId,
      price * 3,
    ]);
    const first = await createShopOrder({
      userId,
      productId: product.id,
      expectedPriceMicros: price,
      paymentProvider: "balance",
    });
    orderIds.push(first.id);

    const settled = await settleShopBalanceOrder({ orderId: first.id, userId });
    assert(settled.ok && !settled.alreadyPaid, "余额充足时应一次支付成功");
    const paidOrder = await query<{ status: string; provider_ref: string | null }>(
      "SELECT status, provider_ref FROM shop_orders WHERE id = $1",
      [first.id],
    );
    assert(paidOrder.rows[0]?.status === "paid", "支付后订单应为 paid");
    assert(
      paidOrder.rows[0]?.provider_ref === shopBalanceReference(first.id),
      "订单应记录余额支付流水号",
    );
    const balanceAfter = await query<{ balance_micros: string }>(
      "SELECT balance_micros FROM users WHERE id = $1",
      [userId],
    );
    assert(
      Number(balanceAfter.rows[0]?.balance_micros) === price * 2,
      "余额应只扣一次订单金额",
    );

    const replay = await settleShopBalanceOrder({ orderId: first.id, userId });
    assert(replay.ok && replay.alreadyPaid, "重复结算应幂等返回已支付");
    const balanceReplay = await query<{ balance_micros: string }>(
      "SELECT balance_micros FROM users WHERE id = $1",
      [userId],
    );
    assert(
      Number(balanceReplay.rows[0]?.balance_micros) === price * 2,
      "重复结算不得再次扣款",
    );

    const wrongOwner = await settleShopBalanceOrder({
      orderId: first.id,
      userId: otherUserId,
    });
    assert(!wrongOwner.ok && wrongOwner.code === "FAILED", "他人订单不得用当前账号结算");

    // Insufficient checkout creates no debit; topping up allows the exact same
    // retry path the checkout page offers.
    await query("UPDATE users SET balance_micros = $2 WHERE id = $1", [
      userId,
      price - 1,
    ]);
    const second = await createShopOrder({
      userId,
      productId: product.id,
      expectedPriceMicros: price,
      paymentProvider: "balance",
    });
    orderIds.push(second.id);
    const insufficient = await settleShopBalanceOrder({
      orderId: second.id,
      userId,
    });
    assert(
      !insufficient.ok && insufficient.code === "INSUFFICIENT",
      "余额不足应返回 INSUFFICIENT",
    );
    const noOp = await getLatestShopBalanceOp(second.id);
    assert(noOp === null, "余额不足时不应创建扣款流水");
    const pendingBalance = await query<{ balance_micros: string }>(
      "SELECT balance_micros FROM users WHERE id = $1",
      [userId],
    );
    assert(
      Number(pendingBalance.rows[0]?.balance_micros) === price - 1,
      "余额不足不得改变余额",
    );

    await query("UPDATE users SET balance_micros = $2 WHERE id = $1", [
      userId,
      price * 2,
    ]);
    const retried = await settleShopBalanceOrder({ orderId: second.id, userId });
    assert(retried.ok, "充值后重试余额支付应成功");
    const secondOrder = await query<{ status: string }>(
      "SELECT status FROM shop_orders WHERE id = $1",
      [second.id],
    );
    assert(secondOrder.rows[0]?.status === "paid", "重试成功后订单应为 paid");

    // A debit that succeeded but whose order update was lost must not be
    // expired by the cleanup worker; the checkout retry has to reconcile it.
    const third = await createShopOrder({
      userId,
      productId: product.id,
      expectedPriceMicros: price,
      paymentProvider: "balance",
    });
    orderIds.push(third.id);
    const lostOp = await enqueueAdjustment({
      userId,
      amountMicros: -price,
      reference: shopBalanceReference(third.id),
    });
    const lostDebit = await applyCreditOpById(lostOp.id, {
      requireNonNegative: true,
    });
    assert(lostDebit?.status === "applied", "测试前置扣款应成功");
    await query(
      "UPDATE shop_orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [third.id],
    );
    await expireShopOrders();
    const protectedOrder = await query<{ status: string }>(
      "SELECT status FROM shop_orders WHERE id = $1",
      [third.id],
    );
    assert(
      protectedOrder.rows[0]?.status === "pending_payment",
      "已扣款但订单未更新的余额订单不得被过期任务关闭",
    );

    // The outbox itself refuses to go negative, and a failed local debit can
    // be retried after top-up without double debiting.
    await query("UPDATE users SET balance_micros = 0 WHERE id = $1", [userId]);
    const directRef = shopBalanceReference(randomUUID());
    const direct = await enqueueAdjustment({
      userId,
      amountMicros: -1_000_000,
      reference: directRef,
    });
    const refused = await applyCreditOpById(direct.id, { requireNonNegative: true });
    assert(refused?.status === "failed", "余额为 0 时扣款流水应失败");
    assert(
      refused?.last_error === "INSUFFICIENT_BALANCE",
      "失败原因应为 INSUFFICIENT_BALANCE",
    );
    await query("UPDATE users SET balance_micros = 2_000_000 WHERE id = $1", [
      userId,
    ]);
    const applied = await applyCreditOpById(direct.id, { requireNonNegative: true });
    assert(applied?.status === "applied", "充值后同一流水应可成功扣款");
    const finalBalance = await query<{ balance_micros: string }>(
      "SELECT balance_micros FROM users WHERE id = $1",
      [userId],
    );
    assert(
      Number(finalBalance.rows[0]?.balance_micros) === 1_000_000,
      "最终余额应为充值额减去一次扣款",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks,
          scenarios: {
            references: ["base", "attempt"],
            alertReplyTo: ["saved", "default", "invalid"],
            emailCopy: ["on", "off"],
            settlement: ["success", "idempotent-replay", "wrong-owner"],
            insufficient: ["no-debit", "topup-retry"],
            outboxGuard: ["refused", "retry-after-topup"],
          },
        },
        null,
        2,
      ),
    );
  } finally {
    if (orderIds.length > 0) {
      await query("DELETE FROM shop_orders WHERE id = ANY($1::uuid[])", [orderIds]);
    }
    await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [userId, otherUserId],
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
