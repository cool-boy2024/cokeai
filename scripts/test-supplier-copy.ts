import {
  sanitizeSupplierAlt,
  sanitizeSupplierCopy,
  stripSupplierPricing,
} from "../src/lib/shop/sanitize";
import { buildRichDescriptionHtml } from "../src/lib/shop/rich-description";

/**
 * Sanitizer checks for public shop copy. No database required:
 * `npm run test:shop:copy`.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT: ${message} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function assertMatch(value: string, pattern: RegExp, message: string): void {
  if (!pattern.test(value)) {
    throw new Error(`ASSERT: ${message} (pattern ${pattern} missing in ${value})`);
  }
}

function assertNotMatch(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) {
    throw new Error(`ASSERT: ${message} (pattern ${pattern} found in ${value})`);
  }
}

// --- settlement arithmetic -------------------------------------------------

const refund = sanitizeSupplierCopy(
  "渠道 1：账号被封时，可自行尝试向 GPT 官方申请退款；符合官方退款条件的订单可申请处理。退款成功可退金额按实际官方退款金额的 80% 结算，另外 20% 为卡台手续费。退款需买家自行查询流程并向官方申请，货源方不提供退款话术或代申请服务。",
);
assertNotMatch(refund, /80\s*%\s*结算|卡台手续费|退款话术|代申请服务|货源方/, "settlement sentences removed");
assertMatch(refund, /可自行尝试向 GPT 官方申请退款/, "non-settlement sentence kept");

assertEqual(
  sanitizeSupplierCopy("如果退款成功，可退金额按实际官方退款金额的 80% 结算，另外 20% 为卡台手续费。"),
  "",
  "whole settlement-only line removed",
);

// --- sourcing vocabulary ---------------------------------------------------

assertNotMatch(
  sanitizeSupplierCopy("到货时间受供货方影响，货源店铺会在 24 小时内处理。"),
  /供货方|货源店铺|货源/,
  "Chinese sourcing words removed",
);
assertMatch(
  sanitizeSupplierCopy("到货时间受供货方影响。"),
  /本店/,
  "sourcing words replaced with 本店",
);
assertNotMatch(
  sanitizeSupplierCopy("Supplier note: wholesale price is lower."),
  /supplier|wholesale\s+price/i,
  "English sourcing words removed",
);
assertEqual(
  sanitizeSupplierCopy("付款后按预约顺序向供货商采购，可能延迟。"),
  "付款后安排采购，可能延迟。",
  "procurement sentence reads as our own action",
);
assertEqual(
  sanitizeSupplierCopy("就算您先买一个测好了，后面批量拿货也可能有些支持、有些不支持。"),
  "就算您先买一个测好了，后面批量购买也可能有些支持、有些不支持。",
  "wholesale wording reads as a normal purchase",
);
assertNotMatch(
  sanitizeSupplierCopy("进价 118 元，成本价和代理价更低。"),
  /进价|成本价|代理价/,
  "wholesale price words removed",
);

// --- domains and brands ----------------------------------------------------

for (const raw of [
  "备用站 lovecodex.cn 可兑换。",
  "打开 foo.ai 查看说明。",
  "联系 customer@example-shop.dev 处理。",
  "详见 https://zyanai.cc/item/442 。",
]) {
  const clean = sanitizeSupplierCopy(raw);
  assertNotMatch(clean, /lovecodex|foo\.ai|example-shop\.dev|zyanai\.cc/, `domain masked: ${raw}`);
}

// Our own domain must survive: its ".cc" prefix looks like a TLD in the
// bare-domain pattern, and masking it used to leave a stray ".cd".
const ownAnnouncement = "长期网址：cokeai.cc.cd，建议收藏，方便下次购买。";
assertEqual(
  sanitizeSupplierCopy(ownAnnouncement),
  ownAnnouncement,
  "our own bare domain kept intact",
);
assertMatch(
  sanitizeSupplierCopy("收藏 https://cokeai.cc.cd/shop 下次直接访问。"),
  /https:\/\/cokeai\.cc\.cd\/shop/,
  "our own URL kept intact",
);

// Official product sites are usage instructions, not supplier identity.
assertMatch(
  sanitizeSupplierCopy("登录 https://chatgpt.com 后在 muse.ai 查看。"),
  /chatgpt\.com/,
  "official host kept",
);
assertMatch(
  sanitizeSupplierCopy("登录 https://chatgpt.com 后在 muse.ai 查看。"),
  /muse\.ai/,
  "official muse.ai kept",
);

// A masked link must not leave a dangling placeholder after words that already
// name the destination ("打开兑换网站 本站商品页").
assertEqual(
  sanitizeSupplierCopy("打开兑换网站 https://lovecodex.cn/。"),
  "打开兑换网站（地址见订单详情页）。",
  "masked redemption link reads as prose",
);
assertEqual(
  sanitizeSupplierCopy("充值卡密与兑换网站 https://lovecodex.cn/"),
  "充值卡密与兑换网站（地址见订单详情页）",
  "masked link inside includes list reads as prose",
);
const redemptionHtml = buildRichDescriptionHtml(
  "<p>2.打开兑换网站 https://lovecodex.cn/ 后按页面提示登录需要充值的账号。</p>",
);
assertNotMatch(redemptionHtml, /本站商品页/, "no dangling placeholder in rich HTML");
assertMatch(redemptionHtml, /地址见订单详情页/, "rich HTML points to the order page");

// Invitation copy names the buyer's own inbox.
assertEqual(
  sanitizeSupplierCopy("你可以在你自己的 https://gmail.com 查看到邮件提醒。"),
  "你可以在你自己的邮箱查看到邮件提醒。",
  "masked inbox reads as the buyer's mailbox",
);

// A downgraded link keeps its destination label but points at the order page.
const destinationHtml = buildRichDescriptionHtml(
  "<p>兑换中心：<span>https://lovecodex.cn/</span></p><p>商品说明文字足够长，用于通过长度检查。</p>",
);
assertNotMatch(destinationHtml, /本站商品页/, "no dangling placeholder after destination label");
assertMatch(
  destinationHtml,
  /兑换中心：<span>地址见订单详情页<\/span>/,
  "destination label points to the order page",
);

// Supplier file names are not useful alt text once the host is masked.
const altHtml = buildRichDescriptionHtml(
  '<p>商品说明文字足够长，用于通过长度检查，请仔细阅读。</p><img src="https://foo.cn/x.png" alt="本站商品页g">',
  {
    imageMap: new Map([
      ["https://foo.cn/x.png", `/api/shop/images/${"a".repeat(64)}.png`],
    ]),
  },
);
assertNotMatch(altHtml, /本站商品页/, "placeholder removed from image alt");
assertMatch(altHtml, /alt="商品说明图片"/, "image alt falls back to a plain label");
assertEqual(
  sanitizeSupplierAlt("本站商品页g"),
  "商品说明图片",
  "mirrored-image alt falls back to a plain label",
);
assertEqual(
  sanitizeSupplierAlt("ChatGPT Plus 封面"),
  "ChatGPT Plus 封面",
  "ordinary alt text kept",
);

// --- rich description links ------------------------------------------------

const relativeLinks = buildRichDescriptionHtml(
  '<p>第一步：打开<a href="/item/442">商品页</a>，第二步：查看<a href="/user/help/article.12">教程</a>，第三步：访问<a href="/shop">本店</a>。</p>',
);
assertNotMatch(relativeLinks, /\/item\/442|\/user\/help\//, "upstream relative paths removed");
assertMatch(relativeLinks, /href="\/shop"/, "our own relative link kept");

const settlementHtml = buildRichDescriptionHtml(
  '<p>正常说明。</p><p>如果退款成功，可退金额按实际官方退款金额的 <strong>80% 结算</strong>，另外 <strong>20% 为卡台手续费</strong>。</p>',
);
assertNotMatch(settlementHtml, /80\s*%<\/strong>|卡台手续费/, "settlement block removed from HTML");

// --- 上游标价不能出现在本站文案里 -----------------------------------------
// 客户看到的价格必须和我们收的一致；文案里带着上游标价既自相矛盾，也暴露拿货价。

assertEqual(
  stripSupplierPricing("codex短效接码-只可接一次 2.5元/条"),
  "codex短效接码-只可接一次按商品页价格",
  "per-unit supplier price is replaced",
);
assertEqual(
  stripSupplierPricing("换号需要收取30元一次。"),
  "换号需要收取按商品页价格。",
  "one-off fee becomes a reference to our price",
);
assertEqual(
  stripSupplierPricing("每笔扣除40元手续费，将剩余应退金额退回"),
  "每笔扣除手续费，将剩余应退金额退回",
  "fee amount dropped, wording kept",
);
assertEqual(
  stripSupplierPricing("本店决定开始加收退费手续费 20 元"),
  "本店决定开始加收退费手续费",
  "trailing fee amount dropped",
);
assertEqual(
  stripSupplierPricing("购买质保 30 天、总价 120 元，第 12 天掉号"),
  "购买质保 30 天、总价，第 12 天掉号",
  "total price dropped",
);
assertEqual(
  stripSupplierPricing("月卡 ¥30.00 元/月"),
  "月卡 按商品页价格",
  "yen sign and monthly price replaced",
);
// 不带「元」的数字（时长、天数）必须原样保留。
assertEqual(
  stripSupplierPricing("质保 30 天，24 小时内发货"),
  "质保 30 天，24 小时内发货",
  "durations are untouched",
);
// 已经清洗过的文案再跑一次不应继续变化。
const once = stripSupplierPricing("扣除40元手续费");
assertEqual(stripSupplierPricing(once), once, "price stripping is idempotent");

// 走完整清洗链时也一样。
assertNotMatch(
  sanitizeSupplierCopy("短效接码 2.5元/条，收取30元一次换号"),
  /\d+(?:\.\d+)?\s*元/,
  "no supplier price survives the full scrub",
);

console.log("supplier copy: ok");
