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
    name: "体验版",
    tagline: "先用真实 API 跑通一个项目",
    price: 9_900_000,
    credits: 10_000_000,
    days: 7,
    tier: 0,
    highlight: false,
    sort: 10,
    features: ["¥10 用量额度", "7 天有效", "独立 API Key", "基础模型", "用量明细"],
  },
  {
    id: "basic",
    name: "开发者版",
    tagline: "适合个人开发者与小项目",
    price: 39_000_000,
    credits: 45_000_000,
    days: 30,
    tier: 1,
    highlight: true,
    sort: 20,
    features: ["¥45 用量额度", "30 天有效", "进阶模型", "成本与余额提醒", "API 文档支持"],
  },
  {
    id: "pro",
    name: "专业版",
    tagline: "为团队和客户项目准备",
    price: 99_000_000,
    credits: 120_000_000,
    days: 30,
    tier: 2,
    highlight: false,
    sort: 30,
    features: ["¥120 用量额度", "30 天有效", "全部模型", "更高默认速率", "优先技术支持"],
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
