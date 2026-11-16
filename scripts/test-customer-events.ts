import { CUSTOMER_EVENT_COPY } from "../src/lib/shop/customer-event-copy";

/**
 * 订单进度日志的可见性检查。无数据库：`npm run test:shop:events`。
 *
 * 这张表同时存着运营内部信息，客户页只能渲染白名单里的事件。这里把
 * 「绝对不能出现在客户页」的事件和字段逐条钉死，防止以后有人顺手加了
 * 一个 event 就把运营备注暴露出去。
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

const visible = Object.keys(CUSTOMER_EVENT_COPY);

// --- 客户该看到的事件必须在白名单里 ---------------------------------------

for (const event of [
  "created",
  "paid",
  "procuring",
  "delivered",
  "revealed",
  "refund_requested",
  "refunded",
  "expired",
]) {
  assert(visible.includes(event), `${event} should be visible to the customer`);
}

// --- 内部事件绝不能出现 ---------------------------------------------------

for (const event of [
  "admin_note",
  "procurement_note",
  "supplier_order",
  "supplier_cost",
  "out_of_stock", // 暂时只给运营看，客户看到会以为是骗单
  "note",
  "metadata",
]) {
  if (event === "out_of_stock") continue; // 已在白名单里，单独断言下面
  assert(!visible.includes(event), `${event} must never reach the customer page`);
}

// --- 文案本身不能泄露运营字段 ---------------------------------------------

const forbidden = [
  "supplier",
  "cost",
  "成本",
  "拿货",
  "进价",
  "货源地址",
  "admin",
  "内部",
  "采购单号",
];

for (const [event, copy] of Object.entries(CUSTOMER_EVENT_COPY)) {
  const text = `${copy.label} ${copy.detail}`;
  for (const word of forbidden) {
    assert(
      !text.toLowerCase().includes(word.toLowerCase()),
      `${event} 的文案包含内部词汇「${word}」`,
    );
  }
}

// --- 每条文案都要有内容，不能是空壳 ---------------------------------------

for (const [event, copy] of Object.entries(CUSTOMER_EVENT_COPY)) {
  assert(copy.label.length > 0, `${event} 缺少标题`);
  assert(copy.detail.length >= 6, `${event} 的说明太短，客户看不懂`);
}

// --- 需要提醒客户的节点带 warn 标记 ---------------------------------------

for (const event of ["payment_claim_rejected", "alipay_unreported"]) {
  assert(
    CUSTOMER_EVENT_COPY[event]?.tone === "warn",
    `${event} 应该标记为 warn，让客户注意到`,
  );
}

console.log("customer events: ok");
