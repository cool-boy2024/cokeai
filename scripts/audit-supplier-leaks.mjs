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
 * Exit code: 0 = clean, 1 = leak (or the audit could not read /shop).
 * It only sends GET requests and never writes to the database.
 */

const args = process.argv.slice(2);
const flagBase = args.find((arg) => arg.startsWith("--base="))?.slice("--base=".length);
const positional = args.find((arg) => !arg.startsWith("-"));
const BASE = (flagBase || positional || process.env.AUDIT_BASE_URL || "http://127.0.0.1:3000")
  .replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;
const MAX_TARGETS = 200;
const TIMEOUT_MS = 15_000;

const PATTERNS = [
  { name: "supplier domain zyanai.cc", re: /zyanai\.cc/i },
  { name: "supplier name zyanai", re: /\bzyanai\b/i },
  { name: "supplier domain aibijia", re: /aibijia/i },
  { name: "supplier domain wzyp", re: /wzyp\./i },
  { name: "supplier domain gshh.top", re: /gshh\.top/i },
  { name: "supplier_cost column", re: /supplier_cost/i },
  { name: "source_title column", re: /source_title/i },
  { name: "source_store column", re: /source_store/i },
  { name: "shop_offers table", re: /shop_offers/i },
  { name: "sourcing vocabulary 货源", re: /货源/ },
  { name: "sourcing vocabulary 供货商", re: /供货商/ },
  { name: "sourcing vocabulary 上游供应商", re: /上游供应商/ },
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

async function fetchPage(path) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "CokeAI-Supplier-Leak-Audit/1.0 (+read-only)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  return { url, status: response.status, text };
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
      warnings.push(`${path} returned ${page.status}; skipped.`);
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

  console.log("");
  console.log("OK: no supplier domains, cost/title fields, or sourcing vocabulary found.");
}

main().catch((error) => {
  console.error("Audit failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
