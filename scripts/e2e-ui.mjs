import fs from "node:fs";
import puppeteer from "puppeteer-core";

const token = fs.readFileSync("/tmp/cokeai-session-token", "utf8").trim();
const chrome =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setCookie({ name: "cokeai_session", value: token, domain: "localhost", path: "/" });

await page.goto("http://localhost:3000/dashboard/keys", { waitUntil: "networkidle0" });
await page.type("#key-name", "e2e-ui");
await page.click("form button[type=submit]");
await page.waitForSelector(".key-reveal", { timeout: 30000 });
const key = await page.$eval(".key-value", (el) => el.textContent?.trim() || "");
console.log(JSON.stringify({ key, prefix: key.slice(0, 14) }));
await page.screenshot({ path: "/tmp/cokeai-keys-created.png", fullPage: true });
await browser.close();
