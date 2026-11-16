import { authHref, safeNextPath } from "../src/lib/redirects";

/**
 * Pure-function checks for the post-auth redirect helper and the auth link
 * builder. No database or Redis required: `npm run test:redirects`.
 *
 * The buyer flow this protects: 商品页 → 注册/登录 → 回到商品页 → 下单。
 * If `next` is dropped or laundered, a buyer finishes signup at the dashboard
 * with an empty cart, which is exactly the bug these checks pin down.
 */

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `ASSERT: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  }
}

// --- safeNextPath: allowed values ------------------------------------------

assertEqual(safeNextPath("/shop/p-46"), "/shop/p-46", "product path survives");
assertEqual(
  safeNextPath("/shop/checkout/SHOP-123"),
  "/shop/checkout/SHOP-123",
  "checkout path survives",
);
assertEqual(
  safeNextPath("/shop/p-46?from=home#buy"),
  "/shop/p-46?from=home#buy",
  "query and hash survive",
);
assertEqual(safeNextPath(undefined), "/dashboard", "missing value uses the default");
assertEqual(safeNextPath(""), "/dashboard", "empty value uses the default");
assertEqual(safeNextPath("/shop/p-46", "/"), "/shop/p-46", "explicit fallback unused when valid");
assertEqual(safeNextPath(undefined, ""), "", "explicit empty fallback is honoured");

// --- safeNextPath: open-redirect attempts ---------------------------------

for (const evil of [
  "//evil.com",
  "//evil.com/shop",
  "/\\evil.com",
  "\\\\evil.com",
  "https://evil.com",
  "http://evil.com/shop",
  "javascript:alert(1)",
  "shop/p-46",
  "/shop/\np-46",
  "/shop/\tp-46",
]) {
  assertEqual(
    safeNextPath(evil, ""),
    "",
    `rejected: ${JSON.stringify(evil)}`,
  );
}

assertEqual(
  safeNextPath("//evil.com", "/dashboard"),
  "/dashboard",
  "rejected value falls back to the given default",
);
// Written with escapes so the source file stays free of control bytes.
assertEqual(safeNextPath("/shop/\u0000p-46", ""), "", "NUL is rejected");
assertEqual(safeNextPath("/shop/\u007fp-46", ""), "", "DEL is rejected");

// --- authHref: no options --------------------------------------------------

assertEqual(authHref("/login"), "/login", "bare login link");
assertEqual(authHref("/register"), "/register", "bare register link");

// --- authHref: next is preserved ------------------------------------------

assertEqual(
  authHref("/register", { next: "/shop/p-46" }),
  "/register?next=%2Fshop%2Fp-46",
  "register keeps the product the buyer came from",
);
assertEqual(
  authHref("/login", { next: "/shop/checkout/SHOP-123" }),
  "/login?next=%2Fshop%2Fcheckout%2FSHOP-123",
  "login keeps the checkout page",
);
assertEqual(
  authHref("/register", { next: "/shop/p-46?from=home" }),
  "/register?next=%2Fshop%2Fp-46%3Ffrom%3Dhome",
  "query inside next is encoded, not split into a second param",
);

// --- authHref: referral code ----------------------------------------------

assertEqual(
  authHref("/register", { ref: "abc123" }),
  "/register?ref=ABC123",
  "referral codes are upper-cased",
);
assertEqual(
  authHref("/register", { next: "/shop/p-46", ref: " abc123 " }),
  "/register?next=%2Fshop%2Fp-46&ref=ABC123",
  "next comes before ref",
);
assertEqual(
  authHref("/login", { ref: "x".repeat(60) }),
  `/login?ref=${"X".repeat(32)}`,
  "referral codes are capped at 32 characters",
);
assertEqual(authHref("/login", { ref: "   " }), "/login", "blank ref is dropped");

// --- authHref: hostile next cannot launder an open redirect ---------------

for (const evil of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
  assertEqual(
    authHref("/login", { next: evil }),
    "/login",
    `auth link drops hostile next: ${JSON.stringify(evil)}`,
  );
}

// --- the round trip the buyer actually takes ------------------------------

const productPath = "/shop/p-46-claude-claude-pro";
const registerHref = authHref("/register", { next: productPath });
const loginHref = authHref("/login", { next: productPath });

// A guest clicking 注册后购买 lands on /register with next intact, and the
// 登录 switch on that page keeps it; same the other way round.
const params = new URL(registerHref, "https://cokeai.invalid").searchParams;
assertEqual(params.get("next"), productPath, "register link round-trips next");
assertEqual(
  authHref("/login", { next: params.get("next") ?? undefined }),
  loginHref,
  "switching register → login preserves next",
);
assertEqual(
  safeNextPath(new URL(loginHref, "https://cokeai.invalid").searchParams.get("next") ?? ""),
  productPath,
  "login redirect target is the product page",
);

console.log("redirects: ok");
