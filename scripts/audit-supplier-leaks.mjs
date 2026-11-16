#!/usr/bin/env node
/**
 * Read-only supplier-leak audit for public shop pages.
 *
 * Crawls a small, bounded set of public URLs (never admin/API/dashboard) and
 * greps the rendered HTML for supplier identity: source domains, cost/title
 * column names, and sourcing vocabulary. It also checks robots.txt and
 * sitemap.xml from the outside.
 *
 * Usage:
 *   node scripts/audit-supplier-leaks.mjs
 *   node scripts/audit-supplier-leaks.mjs http://127.0.0.1:3000
 *   AUDIT_BASE_URL=https://cokeai.cc.cd node scripts/audit-supplier-leaks.mjs
 *
 * Exit code: 0 = clean, 1 = leak, an unreadable page, or a page the app
 * rate-limited so it could not be checked. A green run therefore means every
 * discovered page was actually inspected.
 * It only sends GET requests and never writes to the database. Requests are
 * paced below the shop rate limit and 429s are retried with backoff.
 */

const args = process.argv.slice(2);
const flagBase = args.find((arg) => arg.startsWith("--base="))?.slice("--base=".length);
const positional = args.find((arg) => !arg.startsWith("-"));
const BASE = (flagBase || positional || process.env.AUDIT_BASE_URL || "http://127.0.0.1:3000")
  .replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;
const MAX_TARGETS = 200;
const TIMEOUT_MS = 15_000;
// The shop enforces 120 requests/minute per client. 600ms between requests
// keeps the audit at 100/min, under the limit, and every response is real
// page HTML rather than a 429 body.
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.AUDIT_DELAY_MS ?? 600) || 0);
const RATE_LIMIT_RETRIES = 3;

const PATTERNS = [
  { name: "supplier domain zyanai.cc", re: /zyanai\.cc/i },
  { name: "supplier name zyanai", re: /\bzyanai\b/i },
  { name: "supplier domain ai-buy.vip", re: /ai-buy\.vip/i },
  { name: "supplier name aibuy", re: /\baibuy\b/i },
  { name: "supplier domain aibijia", re: /aibijia/i },
  { name: "supplier domain wzyp", re: /wzyp\./i },
  { name: "supplier domain gshh.top", re: /gshh\.top/i },
  { name: "supplier domain aibuji.com", re: /aibuji\.com/i },
  { name: "supplier domain lovecodex", re: /lovecodex/i },
  { name: "supplier_cost column", re: /supplier_cost/i },
  { name: "supplier field sourceUrl", re: /source_?url/i },
  { name: "source_title column", re: /source_title/i },
  { name: "source_store column", re: /source_store/i },
  { name: "shop_offers table", re: /shop_offers/i },
  { name: "sourcing vocabulary 货源", re: /货源/ },
  { name: "sourcing vocabulary 供货商", re: /供货商/ },
  { name: "sourcing vocabulary 供货方", re: /供货方/ },
  { name: "sourcing vocabulary 供应商", re: /供应商/ },
  { name: "sourcing vocabulary 拿货/进价", re: /拿货|进价|成本价|代理价/ },
  { name: "settlement split 80/20", re: /80\s*%\s*结算|20\s*%\s*为卡台|卡台手续费/ },
  { name: "refund coaching", re: /退款话术|代申请服务/ },
];

const SKIP_SHOP_PATHS = new Set([
  "/shop",
  "/shop/",
  "/shop/terms",
  "/shop/terms/",
]);

const leaks = [];
const warnings = [];
const checked = [];
const incomplete = [];

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace() {
  const wait = lastRequestAt + REQUEST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function decodeEntities(input) {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&period;/gi, ".")
    .replace(/&commat;/gi, "@")
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/");
}

function safeCodePoint(value) {
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : "";
}

function toPath(value) {
  try {
    const url = new URL(value, BASE);
    if (url.origin !== ORIGIN) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function discoverLinks(html) {
  const links = [];
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const path = toPath(match[1]);
    if (path) links.push(path);
  }
  return links;
}

function addTarget(targets, path) {
  if (!path) return;
  if (targets.has(path)) return;
  if (targets.size >= MAX_TARGETS) return;
  targets.add(path);
}

function retryAfterMs(response, attempt) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header * 1000, 15_000);
  }
  return Math.min(2000 * 2 ** attempt, 10_000);
}

async function fetchPage(path) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  for (let attempt = 0; ; attempt += 1) {
    await pace();
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "CokeAI-Supplier-Leak-Audit/1.0 (+read-only)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = retryAfterMs(response, attempt);
      await response.text().catch(() => "");
      console.log(`  rate-limited on ${path}; retrying in ${Math.round(wait / 1000)}s...`);
      await sleep(wait);
      continue;
    }
    const text = await response.text();
    return { url, status: response.status, text };
  }
}

function scanPage(path, text) {
  const haystack = decodeEntities(text);
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(haystack);
    if (!match) continue;
    const start = Math.max(0, (match.index || 0) - 60);
    const snippet = haystack
      .slice(start, start + 180)
      .replace(/\s+/g, " ")
      .trim();
    leaks.push({
      path,
      pattern: pattern.name,
      snippet,
    });
  }
}

async function main() {
  const targets = new Set();

  console.log(`Supplier leak audit: ${BASE}`);
  console.log("");

  // 1. Entry pages that are intentionally public.
  const shop = await fetchPage("/shop").catch((error) => ({ status: 0, text: "", error }));
  if (shop.status !== 200) {
    console.error(
      `FAILED to read /shop (status ${shop.status}${shop.error ? `, ${shop.error.message}` : ""}). ` +
        "Start the app first or pass a reachable base URL.",
    );
    process.exitCode = 1;
  } else {
    checked.push("/shop");
    scanPage("/shop", shop.text);
    for (const link of discoverLinks(shop.text)) {
      const pathname = link.split("?")[0];
      if (pathname.startsWith("/shop/") && !SKIP_SHOP_PATHS.has(pathname)) {
        addTarget(targets, pathname);
      }
    }
  }

  const help = await fetchPage("/help").catch((error) => ({ status: 0, text: "", error }));
  if (help.status === 200) {
    checked.push("/help");
    scanPage("/help", help.text);
    for (const link of discoverLinks(help.text)) {
      if (link.split("?")[0].startsWith("/help/")) addTarget(targets, link.split("?")[0]);
    }
  } else if (help.status === 429 || help.status === 0 || help.status >= 500) {
    incomplete.push(`/help returned ${help.status}; help pages were not audited.`);
  } else {
    warnings.push(`/help returned ${help.status}; skipped (help centre may be empty).`);
  }

  // 2. Sitemap: collect public product/help URLs and verify nothing internal
  //    is advertised.
  const sitemap = await fetchPage("/sitemap.xml").catch((error) => ({ status: 0, text: "", error }));
  if (sitemap.status === 200) {
    for (const match of sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
      const path = toPath(match[1].trim());
      if (!path) continue;
      if (
        /^\/shop\/zy-/i.test(path) ||
        /^\/shop\/(?:auto-(?:zyanai|aibijia|aibuji|wzyp|lovecodex|ldxp|kapay|beibei|aisou|talkai|gshh)|q-)-/i.test(path)
      ) {
        leaks.push({
          path: "/sitemap.xml",
          pattern: "supplier-prefixed product URL",
          snippet: path,
        });
      }
      if (/^\/(?:admin|api|dashboard)(?:\/|$)/.test(path)) {
        leaks.push({
          path: "/sitemap.xml",
          pattern: "internal path advertised in sitemap",
          snippet: path,
        });
        continue;
      }
      if (/^\/shop\//.test(path) && !SKIP_SHOP_PATHS.has(path.split("?")[0])) {
        addTarget(targets, path.split("?")[0]);
      } else if (/^\/help\//.test(path)) {
        addTarget(targets, path.split("?")[0]);
      }
    }
  } else if (sitemap.status === 429 || sitemap.status === 0 || sitemap.status >= 500) {
    incomplete.push(`/sitemap.xml returned ${sitemap.status}; discovery is incomplete.`);
  } else {
    warnings.push(`/sitemap.xml returned ${sitemap.status}; product pages not discovered from it.`);
  }

  // 3. robots.txt: advisory check.
  const robots = await fetchPage("/robots.txt").catch(() => ({ status: 0, text: "" }));
  if (robots.status === 200) {
    for (const required of ["/admin", "/api", "/dashboard"]) {
      if (!robots.text.includes(`Disallow: ${required}`)) {
        warnings.push(`robots.txt does not disallow ${required}.`);
      }
    }
  } else {
    warnings.push(`/robots.txt returned ${robots.status}.`);
  }

  // 4. Crawl discovered product/help pages.
  const targetList = [...targets];
  for (let index = 0; index < targetList.length; index += 1) {
    const path = targetList[index];
    const page = await fetchPage(path).catch((error) => ({
      status: 0,
      text: "",
      error,
    }));
    if (page.status !== 200) {
      if (page.status === 429 || page.status === 0 || page.status >= 500) {
        incomplete.push(`${path} returned ${page.status}; page not inspected.`);
      } else {
        // A 404 on a discovered link is stale markup, not a leak.
        warnings.push(`${path} returned ${page.status}; skipped.`);
      }
      continue;
    }
    checked.push(path);
    scanPage(path, page.text);
    if ((index + 1) % 20 === 0) {
      console.log(`  checked ${index + 1}/${targetList.length} discovered pages...`);
    }
  }

  console.log("");
  console.log(`Checked ${checked.length} public pages (${targetList.length} discovered).`);

  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  if (leaks.length > 0) {
    console.log("");
    console.log(`LEAKS FOUND: ${leaks.length}`);
    for (const leak of leaks) {
      console.log(`  [${leak.pattern}] ${leak.path}`);
      console.log(`    ...${leak.snippet}...`);
    }
    console.log("");
    console.log("Do not deploy this build. See docs/SECURITY.md → 货源信息保护.");
    process.exitCode = 1;
    return;
  }

  if (incomplete.length > 0) {
    console.log("");
    console.log(`INCOMPLETE: ${incomplete.length} page(s) could not be inspected.`);
    for (const entry of incomplete) console.log(`  - ${entry}`);
    console.log("");
    console.log(
      "No leak was seen on the pages that loaded, but coverage is incomplete. " +
        "Retry when the app is under load or raise AUDIT_DELAY_MS.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(
    `OK: no supplier domains, cost/title fields, or sourcing vocabulary found ` +
      `in ${checked.length} public pages.`,
  );
}

main().catch((error) => {
  console.error("Audit failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
