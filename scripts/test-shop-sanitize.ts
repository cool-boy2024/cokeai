/**
 * Pure-function tests for the supplier copy scrubber.
 * No database and no network: fixtures mirror copy observed on production
 * product pages on 2026-11-14, where supplier shop names were still visible.
 */
import {
  sanitizeSupplierCopy,
  sanitizeSupplierLines,
  type SupplierIdentity,
} from "../src/lib/shop/sanitize";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function clean(input: string, identity: SupplierIdentity = {}): string {
  return sanitizeSupplierCopy(input, identity);
}

function assertNoSupplierName(output: string, label: string): void {
  for (const name of ["AI补给站", "真低价", "子砚", "启航AI", "zyanai", "站长"]) {
    assert(!output.includes(name), `${label} must not leak "${name}": ${output}`);
  }
}

// --- Known shop brands, independent of the offer's store field --------------

const aggregator = clean("欢迎来到「 AI补给站·真低价 」，下单后按顺序发货。");
assert(aggregator.includes("CokeAI 小店"), "aggregator brand is replaced with our shop");
assertNoSupplierName(aggregator, "aggregator copy");

const tagline = clean("这里只做真低价商品。");
assert(tagline === "这里只做价格透明商品。", "standalone tagline becomes neutral copy");

const ziyan = clean("子砚的AI店铺 Muse 图文教程");
assert(ziyan.includes("CokeAI 小店"), "shop name with a brand prefix is replaced");
assert(!ziyan.includes("子砚"), "brand prefix is removed");

const qihang = clean("启航AI 拿货，24 小时内发货。");
assert(!qihang.includes("启航AI"), "ascii shop brand is removed");
assert(qihang.includes("CokeAI 小店"), "ascii shop brand becomes our name");

const station = clean("有问题联系站长本店客服。");
assert(station === "有问题联系本站客服。", "operator wording is rewritten");

// --- Store identity still works -------------------------------------------

const store = clean("欢迎来到「 东京数码 」，请先阅读说明。", {
  store: "东京数码",
  url: "https://shop.example.com/item/1",
});
assert(store.includes("CokeAI 小店"), "offer store name still replaced");
assert(!store.includes("东京数码"), "offer store name does not leak");

// --- Links ----------------------------------------------------------------

const official = clean("打开 https://chatgpt.com/auth/login 登录，或访问 claude.ai。");
assert(official.includes("https://chatgpt.com/auth/login"), "official links are preserved");
assert(official.includes("claude.ai"), "bare official domains are preserved");

const supplierUrl = clean("详见 https://zyanai.cc/user/help/article.9 的说明。");
assert(!supplierUrl.includes("zyanai"), "supplier URL is masked");
assert(!supplierUrl.includes("CokeAI 小店.cc"), "domain is not half-replaced by a brand");

const bareDomain = clean("访问 zyanai.cc 查看教程。");
assert(!bareDomain.includes("zyanai"), "bare supplier domain is masked");
assert(bareDomain.includes("本页教程"), "bare supplier domain becomes the shop pointer");

// --- Contacts -------------------------------------------------------------

const wechat = clean("微信：abcdef123 联系客服");
assert(wechat.includes("本店客服"), "contact handle is masked");
assert(!wechat.includes("abcdef123"), "contact handle does not leak");
assert(
  clean("邮箱 seller@example.com 售后").includes("本店客服"),
  "mailbox is masked",
);

// --- Fulfillment wording ---------------------------------------------------
// Every order is placed with the supplier by hand; supplier auto-delivery
// claims must never reach the buyer.

const cdk = clean("本商品为 CDK 自动发货。下单付款后，系统会自动显示充值卡密。");
assert(!cdk.includes("自动发"), `auto-delivery claim is gone: ${cdk}`);
assert(cdk.includes("本商品为 CDK 卡密商品。"), "CDK claim becomes an item description");
assert(cdk.includes("卡密会显示在你的订单详情页"), "buyer is pointed at the order page");

const hours = clean("① 24小时自动发货，付款后不要关闭网站等待跳转，账号密码会直接显示。");
assert(!hours.includes("自动发"), `24h auto-delivery claim is gone: ${hours}`);
assert(!hours.includes("24小时"), "supplier delivery-time promise is dropped");
assert(hours.includes("下单后人工发货"), "24h claim becomes manual delivery");

const legend = clean("- 标注“自动发货”的会系统秒发，标注“在线发货”的会人工处理发货；");
assert(
  legend === "- 本站商品均为人工发货，付款后由客服按顺序处理；",
  `delivery-method legend is rewritten: ${legend}`,
);

const noWait = clean("• 下单自动发 CDK，不用等待人工发货");
assert(
  noWait === "• 下单后人工发货，卡密会显示在订单详情页",
  `no-wait claim is rewritten: ${noWait}`,
);

const title = clean("【自动发货】GPT PLUS 充值卡密");
assert(title === "【人工发货】GPT PLUS 充值卡密", `product title is rewritten: ${title}`);

assert(clean(cdk) === cdk, "fulfillment scrub is idempotent");
assert(clean(hours) === hours, "fulfillment scrub is idempotent on 24h copy");

// --- Ordinary copy is untouched -------------------------------------------

const ordinary = "本商品为 CDK 卡密商品，发货后请及时修改密码。";
assert(clean(ordinary) === ordinary, "ordinary product copy is unchanged");

const lines = sanitizeSupplierLines(["正常说明", "", "AI补给站 发货"]);
assert(lines.length === 2, "blank lines are dropped");
assert(!lines.join("").includes("AI补给站"), "line scrubber applies the brand list");

// --- Idempotence ----------------------------------------------------------

const once = clean("AI补给站 和 子砚的AI店铺 均按预定顺序采购。");
assert(clean(once) === once, "scrubber is idempotent on its own output");

console.log("test-shop-sanitize: ok");
