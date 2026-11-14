import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { loadEnv } from "./env.mjs";

loadEnv();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 15_000,
});

const plans = [
  {
    id: "starter",
    name: "入门包",
    tagline: "先跑通一个项目",
    price: 9_900_000,
    credits: 10_000_000,
    // Credits never expire; keep a large legacy duration for old code paths.
    days: 36500,
    tier: 0,
    highlight: false,
    sort: 10,
    features: [],
  },
  {
    id: "basic",
    name: "标准包",
    tagline: "日常开发与小项目",
    price: 39_000_000,
    credits: 45_000_000,
    days: 36500,
    tier: 0,
    highlight: true,
    sort: 20,
    features: [],
  },
  {
    id: "pro",
    name: "专业包",
    tagline: "团队与客户项目",
    price: 99_000_000,
    credits: 120_000_000,
    days: 36500,
    tier: 0,
    highlight: false,
    sort: 30,
    features: [],
  },
];

const upstreams = [
  {
    id: "deepseek",
    name: "DeepSeek 官方 API",
    baseUrl: "https://api.deepseek.com/v1",
    enabled: false,
  },
  {
    id: "openai",
    name: "OpenAI 官方 API",
    baseUrl: "https://api.openai.com/v1",
    enabled: false,
  },
];

const models = [
  {
    id: "deepseek-chat",
    upstream: "deepseek",
    upstreamModel: "deepseek-chat",
    name: "DeepSeek Chat",
    description: "通用对话与代码生成，适合日常开发任务。",
    input: 280_000,
    output: 420_000,
    tier: 0,
    context: 128_000,
    sort: 10,
  },
  {
    id: "deepseek-reasoner",
    upstream: "deepseek",
    upstreamModel: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    description: "推理模型，适合复杂分析、规划与代码排查。",
    input: 280_000,
    output: 420_000,
    tier: 1,
    context: 128_000,
    sort: 20,
  },
  {
    id: "gpt-4.1-mini",
    upstream: "openai",
    upstreamModel: "gpt-4.1-mini",
    name: "GPT-4.1 mini",
    description: "低延迟通用模型，适合高频工具调用。",
    input: 400_000,
    output: 1_600_000,
    tier: 1,
    context: 1_047_576,
    sort: 30,
  },
  {
    id: "gpt-4.1",
    upstream: "openai",
    upstreamModel: "gpt-4.1",
    name: "GPT-4.1",
    description: "高质量通用模型，适合复杂工程任务。",
    input: 2_000_000,
    output: 8_000_000,
    tier: 2,
    context: 1_047_576,
    sort: 40,
  },
];

// Standing store notice shown once per visitor as a modal and kept in the
// public announcement bar. Seeded only when the table is empty so operators
// remain free to rewrite or delete it from /admin/announcements.
const welcomeAnnouncement = {
  title: "欢迎来到 CokeAI 小店",
  body: [
    "欢迎来到 CokeAI 小店！这里出售 AI 成品号、接码与数字商品，同时提供 OpenAI 兼容的 API 中转。",
    "",
    "建议注册并登录后购买：订单进度、交付内容和售后记录都在「我的订单」里。",
    "长期网址：cokeai.cc.cd，建议收藏，方便下次购买。",
    "",
    "📦 商品交付与使用",
    "✅ 下单前请确认商品适用平台、使用期限和账号要求，以商品页说明为准。",
    "✅ 付款确认后，卡密、账号或人工说明会显示在订单页，请及时保存并按说明兑换。",
    "✅ 部分商品需要人工采购发货，请以订单页进度为准，不要重复下单。",
    "✅ 账号及订阅类商品，请遵守商品说明中的使用规则，避免违规操作导致账号异常。",
    "⚠️ 如遇兑换失败、充值异常或订单未到账，请先联系客服，不要重复购买。",
    "",
    "💳 支付说明",
    "目前支持 USDT 链上转账与支付宝人工核实。支付宝订单需要按页面提示转账并在订单页上报，运营核对到账后才会开始处理，不是即时到账。",
    "",
    "💬 售后服务",
    "需要售后或人工发货，请点击网站右下角的「客服」留言：",
    "【了解商品】商品名称 + 具体不懂的问题（建议先看商品介绍）",
    "【申请售后】商品名称 + 订单号 + 清晰的问题描述 + 问题截图",
    "复杂问题也可以发邮件到页面底部列出的邮箱。",
  ].join("\n"),
  level: "info",
};

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const plan of plans) {
      await client.query(
        `INSERT INTO plans
          (id, name, tagline, price_micros, credits_micros, duration_days, tier, features, highlight, active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, TRUE, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          plan.id,
          plan.name,
          plan.tagline,
          plan.price,
          plan.credits,
          plan.days,
          plan.tier,
          JSON.stringify(plan.features),
          plan.highlight,
          plan.sort,
        ],
      );
    }

    await client.query(
      `INSERT INTO announcements (title, body, level, pinned)
       SELECT $1, $2, $3, TRUE
        WHERE NOT EXISTS (SELECT 1 FROM announcements)`,
      [welcomeAnnouncement.title, welcomeAnnouncement.body, welcomeAnnouncement.level],
    );

    // First-party `guide.*` tutorials were removed on 2026-11-14 at the
    // operator's request: product pages already carry the usage notices and
    // the guides added little. Delete rows written by older builds. Nothing
    // references help_articles by foreign key, so the delete cannot be blocked.
    await client.query("DELETE FROM help_articles WHERE id LIKE 'guide.%'");

    for (const upstream of upstreams) {
      await client.query(
        `INSERT INTO upstreams (id, name, base_url, enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [upstream.id, upstream.name, upstream.baseUrl, upstream.enabled],
      );
    }

    for (const model of models) {
      await client.query(
        `INSERT INTO models
          (id, upstream_id, upstream_model, display_name, description,
           input_price_usd_micros_per_mtok, output_price_usd_micros_per_mtok,
           markup_bps, min_plan_tier, context_window, enabled, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 18000, $8, $9, FALSE, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          model.id,
          model.upstream,
          model.upstreamModel,
          model.name,
          model.description,
          model.input,
          model.output,
          model.tier,
          model.context,
          model.sort,
        ],
      );
    }

    const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || "";
    if (adminEmail && adminPassword) {
      if (adminPassword.length < 10) {
        throw new Error("ADMIN_PASSWORD must be at least 10 characters");
      }
      const existing = await client.query("SELECT id FROM users WHERE email = $1", [adminEmail]);
      if (existing.rowCount === 0) {
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        const referralCode = `ADMIN${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
        await client.query(
          `INSERT INTO users (email, password_hash, name, role, referral_code)
           VALUES ($1, $2, $3, 'admin', $4)`,
          [adminEmail, passwordHash, "管理员", referralCode],
        );
        console.log(`Admin account created: ${adminEmail}`);
      }
    } else {
      console.log("ADMIN_EMAIL/ADMIN_PASSWORD not set; skipped admin seed.");
    }

    await client.query("COMMIT");
    console.log("Seed data is ready.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
