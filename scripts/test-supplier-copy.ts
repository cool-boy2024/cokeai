import { sanitizeSupplierCopy } from "../src/lib/shop/sanitize";
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

console.log("supplier copy: ok");
