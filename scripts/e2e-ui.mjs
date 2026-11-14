import assert from "node:assert/strict";
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const token = fs.readFileSync("/tmp/cokeai-session-token", "utf8").trim();
const chrome =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.APP_URL || "http://localhost:3000";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setCookie({ name: "cokeai_session", value: token, domain: "localhost", path: "/" });

try {
  await page.goto(`${base}/dashboard`, { waitUntil: "networkidle0" });

  const navLabels = await page.$$eval(".sidebar-nav .sidebar-link span", (els) =>
    els.map((el) => el.textContent?.trim() || "").filter(Boolean),
  );
  for (const removed of ["API Key", "用量", "接入教程"]) {
    assert(!navLabels.includes(removed), `customer nav still shows ${removed}`);
  }
  for (const kept of ["概览", "充值", "我的订单", "设置"]) {
    assert(navLabels.includes(kept), `customer nav is missing ${kept}`);
  }

  const docsLinks = await page.$$eval('a[href="/docs"]', (els) => els.length);
  assert.equal(docsLinks, 0, "customer console still links to /docs");

  await page.goto(`${base}/dashboard/keys`, { waitUntil: "networkidle0" });
  assert.equal(new URL(page.url()).pathname, "/dashboard", "keys page did not redirect");

  await page.goto(`${base}/dashboard/usage`, { waitUntil: "networkidle0" });
  assert.equal(new URL(page.url()).pathname, "/dashboard", "usage page did not redirect");

  await page.screenshot({ path: "/tmp/cokeai-dashboard.png", fullPage: true });
  console.log(JSON.stringify({ navLabels, docsLinks, redirectedTo: "/dashboard" }));
} finally {
  await browser.close();
}
