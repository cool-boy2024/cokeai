import fs from "node:fs";
import puppeteer from "puppeteer-core";

const token = process.env.SESSION_TOKEN || fs.readFileSync("/tmp/cokeai-session-token", "utf8").trim();
const base = process.env.APP_URL || "http://localhost:3000";
const chrome =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

async function capture(context, path, name, viewport = { width: 1440, height: 1000 }) {
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle0", timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const file = `/tmp/cokeai-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await page.close();
}

try {
  // Public pages in a clean context: no dashboard cookie can leak into /login.
  const publicContext = await browser.createBrowserContext();
  for (const [path, name] of [
    ["/", "home"],
    ["/pricing", "pricing"],
    ["/docs", "docs"],
    ["/login", "login"],
    ["/register", "register"],
  ]) {
    await capture(publicContext, path, name);
  }
  await publicContext.close();

  const authContext = await browser.createBrowserContext();
  await authContext.setCookie({
    name: "cokeai_session",
    value: token,
    domain: "localhost",
    path: "/",
  });

  for (const [path, name] of [
    ["/dashboard", "dashboard"],
    ["/dashboard/billing", "billing"],
    ["/dashboard/shop", "shop-orders"],
    ["/dashboard/settings", "settings"],
    ["/admin", "admin"],
    ["/admin/orders", "admin-orders"],
    ["/admin/users", "admin-users"],
    ["/admin/plans", "admin-plans"],
    ["/admin/pricing", "admin-pricing"],
    ["/admin/gateway", "admin-gateway"],
  ]) {
    await capture(authContext, path, name);
  }

  // Mobile checks.
  for (const [path, name] of [
    ["/", "mobile-home"],
    ["/dashboard", "mobile-dashboard"],
    ["/dashboard/billing", "mobile-billing"],
  ]) {
    await capture(authContext, path, name, { width: 390, height: 844 });
  }
  await authContext.close();
} finally {
  await browser.close();
}
