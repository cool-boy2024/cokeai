import {
  normalizeDisplayCategory,
  productCategorySlug,
} from "../src/lib/shop/categories";
import { classifyOffer } from "../src/lib/shop/offer-classify";

/**
 * Pure-function checks for the public category rail. No database required:
 * `npm run test:shop:categories`.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERT: ${message} (expected ${expected}, got ${actual})`);
  }
}

const product = (displayCategory: string, brand: string) => ({
  display_category: displayCategory,
  brand,
  slug: "test-product",
});

// New canonical labels.
assertEqual(productCategorySlug(product("ChatGPT", "other")), "gpt", "ChatGPT label");
assertEqual(productCategorySlug(product("Claude", "other")), "claude", "Claude label");
assertEqual(productCategorySlug(product("Gemini", "other")), "gemini", "Gemini label");
assertEqual(productCategorySlug(product("Grok", "other")), "grok", "Grok label");
assertEqual(productCategorySlug(product("邮箱", "other")), "email", "email label");
assertEqual(productCategorySlug(product("接码", "other")), "sms", "sms label");
assertEqual(productCategorySlug(product("其他", "other")), "other", "other label");

// Values written by the previous rail or by manual edits still resolve.
assertEqual(productCategorySlug(product("GPT", "other")), "gpt", "legacy GPT");
assertEqual(productCategorySlug(product("谷歌", "other")), "gemini", "legacy 谷歌");
assertEqual(productCategorySlug(product("设计类 AI", "other")), "other", "legacy 设计类 AI");
assertEqual(productCategorySlug(product("Muse", "muse")), "other", "legacy Muse");
assertEqual(productCategorySlug(product("CapCut", "other")), "other", "legacy CapCut");
assertEqual(productCategorySlug(product("YouTube", "other")), "other", "legacy YouTube");
assertEqual(productCategorySlug(product("", "muse")), "other", "muse falls back to other");
assertEqual(productCategorySlug(product("", "chatgpt")), "gpt", "brand fallback");
assertEqual(productCategorySlug(product("", "gemini")), "gemini", "gemini brand fallback");

assertEqual(normalizeDisplayCategory("谷歌"), "Gemini", "normalize 谷歌");
assertEqual(normalizeDisplayCategory("ChatGPT"), "ChatGPT", "normalize ChatGPT");
assertEqual(normalizeDisplayCategory("unknown-supplier-value"), "其他", "unknown normalizes to 其他");

// Offer classification decides which drafts get 邮箱 / 接码.
assertEqual(classifyOffer("Outlook 邮箱 成品号 美国").category, "email", "Outlook mailbox");
assertEqual(classifyOffer("Gmail 邮箱账号").category, "email", "Gmail mailbox");
assertEqual(
  classifyOffer("ChatGPT 成品号 带邮箱").category,
  "account",
  "AI account with mailbox is not email",
);
assertEqual(classifyOffer("Codex 接码 美国号").category, "sms", "Codex sms");
assertEqual(classifyOffer("ChatGPT Plus 订阅").category, "subscription", "subscription");

console.log("category tests ok");
