/**
 * Builds the in-site product tutorial videos.
 *
 * The supplier's own tutorial file is gone (the help article now points at a
 * 404), so the shop ships its own walkthrough: slides rendered by headless
 * Chrome plus macOS `say` narration, muxed with ffmpeg. Re-run this script to
 * regenerate `public/media/*.mp4` after changing the steps:
 *
 *   node scripts/build-tutorial-videos.mjs
 *
 * macOS only (`say`, Chrome, ffmpeg are needed). The generated videos are
 * committed because the production image does not run this script.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VOICE = process.env.TUTORIAL_VOICE || "Tingting";
const WIDTH = 1280;
const HEIGHT = 720;
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "media");
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cokeai-tutorial-"));

const TUTORIALS = [
  {
    file: "codex-sms-tutorial",
    brand: "Codex",
    slides: [
      {
        title: "Codex 单次接码使用演示",
        body: "只支持 OpenAI app 的登录验证。",
        narration: "Codex 单次接码使用演示。",
      },
      {
        step: "01",
        title: "下单后收到 CDK 卡密",
        body: "卡密里包含接码平台地址，打开平台后输入 CDK。",
        narration:
          "第一步，下单后收到 CDK 卡密，卡密里包含接码平台地址。打开接码平台，输入卡密。",
      },
      {
        step: "02",
        title: "获取美国号码（+1）",
        body: "平台会分配一个美国号码，单次有效，保底能接。",
        narration:
          "第二步，平台会分配一个美国号码，单次有效，保底能接。",
      },
      {
        step: "03",
        title: "只支持下面这个页面",
        body: "在 OpenAI app 登录验证页填入号码：地区选美国（+1），方式选短信，再点「继续」。",
        image: path.join(ROOT, "public", "shop", "codex-sms-supported-page.png"),
        narration:
          "第三步，只支持这个页面。在 OpenAI app 登录验证页填入号码，地区选美国，方式选短信，再点继续。其他网址或功能都不保证。",
      },
      {
        step: "04",
        title: "收到验证码，填回 OpenAI",
        body: "短信到达后，把验证码填进 OpenAI 的验证框，完成登录。",
        narration: "第四步，收到验证码后，把验证码填回 OpenAI，完成登录。",
      },
      {
        step: "05",
        title: "收不到码，就释放号码换号",
        body: "点「释放号码」重新取号即可。没收到验证码不会消耗卡密。",
        narration:
          "第五步，收不到码就点释放号码，重新取号。没有收到验证码，不会消耗卡密。",
      },
      {
        title: "注意",
        body: "无法接 Google 风控验证，无法用于注册账号。乱拍不退。",
        narration:
          "最后提醒，无法接 Google 风控验证，无法用于注册账号，乱拍不退。操作演示到此结束。",
      },
    ],
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "pipe", ...options });
}

function slideHtml({ step, title, body, brand, image, isCover }, index, total) {
  const imageData = image
    ? `data:image/png;base64,${fs.readFileSync(image).toString("base64")}`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 64px 72px 56px;
    background: #f7f6f3;
    color: #161615;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgba(22,22,21,.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(22,22,21,.05) 1px, transparent 1px);
    background-size: 64px 64px;
    pointer-events: none;
  }
  .top {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 20px;
    color: #6b6b66;
    letter-spacing: .02em;
  }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 600; color: #161615; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #1f6f5c; }
  .main {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 56px;
  }
  .copy { flex: 1; min-width: 0; }
  .step {
    display: inline-block;
    margin-bottom: 20px;
    color: #1f6f5c;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: .1em;
    font-variant-numeric: tabular-nums;
  }
  h1 {
    margin: 0;
    font-size: ${isCover ? 64 : 52}px;
    line-height: 1.18;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  p {
    max-width: 720px;
    margin: 24px 0 0;
    color: #4a4a45;
    font-size: 28px;
    line-height: 1.6;
  }
  .shot {
    flex: 0 0 300px;
    padding: 10px;
    border: 1px solid #dedcd4;
    border-radius: 20px;
    background: #fff;
    box-shadow: 0 24px 60px rgba(22,22,21,.12);
  }
  .shot img { display: block; width: 100%; height: auto; border-radius: 12px; }
  .foot {
    position: relative;
    display: flex;
    justify-content: space-between;
    font-size: 18px;
    color: #8a8a84;
  }
</style>
</head>
<body>
  <div class="top">
    <span class="brand"><span class="dot"></span>CokeAI · ${brand}</span>
    <span>${index + 1} / ${total}</span>
  </div>
  <div class="main">
    <div class="copy">
      ${step ? `<span class="step">STEP ${step}</span>` : ""}
      <h1>${title}</h1>
      <p>${body}</p>
    </div>
    ${imageData ? `<div class="shot"><img src="${imageData}" alt="" /></div>` : ""}
  </div>
  <div class="foot">
    <span>操作示意，以实际页面为准</span>
    <span>CokeAI 小店</span>
  </div>
</body>
</html>`;
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("build-tutorial-videos.mjs needs macOS (`say`) and ffmpeg");
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  for (const tutorial of TUTORIALS) {
    const segments = [];
    const tutorialDir = path.join(WORK_DIR, tutorial.file);
    fs.mkdirSync(tutorialDir, { recursive: true });

    for (let i = 0; i < tutorial.slides.length; i += 1) {
      const slide = tutorial.slides[i];
      const base = path.join(tutorialDir, `${String(i).padStart(2, "0")}`);
      const png = `${base}.png`;
      const aiff = `${base}.aiff`;
      const wav = `${base}.wav`;
      const mp4 = `${base}.mp4`;

      await page.setContent(
        slideHtml(
          { ...slide, brand: tutorial.brand, isCover: i === 0 },
          i,
          tutorial.slides.length,
        ),
        { waitUntil: "load" },
      );
      await page.screenshot({ path: png, type: "png" });

      run("say", ["-v", VOICE, "-r", "178", "-o", aiff, slide.narration]);
      run("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "2", wav]);

      const probe = run("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        wav,
      ])
        .toString()
        .trim();
      const narrationSeconds = Number(probe);
      const duration = Math.max(4.5, 0.6 + narrationSeconds + 1.1);
      const fadeOutStart = (duration - 0.35).toFixed(2);

      run("ffmpeg", [
        "-y",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        png,
        "-i",
        wav,
        "-filter_complex",
        `[0:v]format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOutStart}:d=0.35[v];` +
          `[1:a]adelay=600:all=1,apad[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        duration.toFixed(2),
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-tune",
        "stillimage",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        mp4,
      ]);

      segments.push({ mp4, duration, png });
      console.log(`  ${tutorial.file} slide ${i + 1}/${tutorial.slides.length} ${duration.toFixed(2)}s`);
    }

    const listFile = path.join(tutorialDir, "concat.txt");
    fs.writeFileSync(
      listFile,
      segments.map((segment) => `file '${segment.mp4}'`).join("\n") + "\n",
    );
    const out = path.join(OUT_DIR, `${tutorial.file}.mp4`);
    run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      out,
    ]);

    const poster = path.join(OUT_DIR, `${tutorial.file}-poster.jpg`);
    run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      segments[0].png,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      poster,
    ]);
    const size = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(`${path.relative(ROOT, out)}  ${size} KB`);
  }

  await browser.close();
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
}

await main();
