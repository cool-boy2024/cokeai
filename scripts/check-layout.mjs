import puppeteer from "puppeteer-core";

/**
 * 布局溢出巡检：在几个典型宽度下打开公开页面，报告横向滚动与超宽元素。
 *
 * 页面混乱大多来自「某个元素比视口宽」，一旦出现整页可以左右拖动，手机上
 * 非常明显。这个脚本把这件事变成一条命令：
 *
 *   npm run check:layout                       # 检查本地 dev
 *   APP_URL=https://cokeai.cc.cd npm run check:layout   # 检查生产
 *
 * 只做只读访问，不提交任何表单。
 */

const BASE = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// 公开页面：不登录也能访问，覆盖首页、小店、商品、认证、条款。
const PAGES = [
  "/",
  "/shop",
  "/shop/q-36-chatgpt-plus-12",
  "/shop/p-155-gemini",
  "/login",
  "/register",
  "/help",
  "/terms",
  "/privacy",
  "/shop/terms",
];

const WIDTHS = [
  { width: 1440, height: 900, label: "桌面" },
  { width: 768, height: 1024, label: "平板" },
  { width: 390, height: 844, label: "手机" },
  { width: 320, height: 568, label: "小屏" },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

let failures = 0;

try {
  for (const { width, height, label } of WIDTHS) {
    const problems = [];
    for (const path of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      try {
        const response = await page.goto(`${BASE}${path}`, {
          waitUntil: "networkidle0",
          timeout: 60_000,
        });
        if (!response || response.status() >= 400) {
          problems.push(`${path} HTTP ${response?.status() ?? "?"}`);
          continue;
        }
        const result = await page.evaluate(() => {
          const doc = document.documentElement;
          const overflow = doc.scrollWidth - doc.clientWidth;
          const wide = [];
          for (const el of document.querySelectorAll("body *")) {
            const rect = el.getBoundingClientRect();
            if (rect.width <= doc.clientWidth + 2 || rect.height <= 0) continue;
            // 固定定位的装饰层（光晕、遮罩）溢出是设计的一部分。
            if (getComputedStyle(el).position === "fixed") continue;
            const cls = String(el.className || "").split(" ")[0];
            wide.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}(${Math.round(rect.width)}px)`);
          }
          return { overflow, wide: [...new Set(wide)].slice(0, 3) };
        });
        if (result.overflow > 1) {
          problems.push(
            `${path} 横向溢出 ${result.overflow}px${result.wide.length ? ` ← ${result.wide.join(", ")}` : ""}`,
          );
        }
      } catch (error) {
        problems.push(`${path} 加载失败：${error instanceof Error ? error.message.slice(0, 60) : error}`);
      } finally {
        await page.close();
      }
    }

    if (problems.length === 0) {
      console.log(`${label} ${width}px  ✅ ${PAGES.length} 个页面均无横向溢出`);
    } else {
      failures += problems.length;
      console.log(`${label} ${width}px  ❌`);
      for (const problem of problems) console.log(`   · ${problem}`);
    }
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n共 ${failures} 处布局问题。`);
  process.exit(1);
}
console.log("\n布局巡检通过。");
