import nodemailer from "nodemailer";
import { getAppSetting, saveAppSetting } from "@/lib/app-settings";

/**
 * Admin-managed alert delivery.
 *
 * The channel is configured in /admin/security/alerts and stored encrypted in
 * app_settings. ALERT_WEBHOOK_URL remains a read-only fallback for existing
 * deployments that have not opened the settings page yet.
 */

export type AlertChannel = "wecom" | "feishu" | "webhook" | "email" | "off";

export type SmtpSettings = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
};

export type AlertConfig = {
  channel: AlertChannel;
  webhookUrl: string;
  smtp: SmtpSettings;
};

export type AlertResult = { ok: boolean; error?: string };

const SETTING_KEY = "security_alert";
const CACHE_MS = 15_000;

export const ALERT_CHANNEL_LABELS: Record<AlertChannel, string> = {
  wecom: "企业微信机器人",
  feishu: "飞书机器人",
  webhook: "自定义 Webhook",
  email: "邮箱 SMTP",
  off: "未配置",
};

export const SMTP_PRESETS = {
  qq: { host: "smtp.qq.com", port: 465 },
  "163": { host: "smtp.163.com", port: 465 },
  gmail: { host: "smtp.gmail.com", port: 465 },
  custom: { host: "", port: 465 },
} as const;

const EMPTY_SMTP: SmtpSettings = {
  host: "",
  port: 465,
  user: "",
  pass: "",
  from: "",
  to: "",
};

function emptyConfig(): AlertConfig {
  return { channel: "off", webhookUrl: "", smtp: { ...EMPTY_SMTP } };
}

function normalize(input: Partial<AlertConfig> | null): AlertConfig {
  const base = emptyConfig();
  if (!input || typeof input !== "object") return base;
  const channel = (
    ["wecom", "feishu", "webhook", "email", "off"] as const
  ).includes(input.channel as AlertChannel)
    ? (input.channel as AlertChannel)
    : "off";
  const smtp = (input.smtp || {}) as Partial<SmtpSettings>;
  const port = Number(smtp.port);
  return {
    channel,
    webhookUrl: typeof input.webhookUrl === "string" ? input.webhookUrl : "",
    smtp: {
      host: typeof smtp.host === "string" ? smtp.host : "",
      port: Number.isFinite(port) && port > 0 ? Math.trunc(port) : 465,
      user: typeof smtp.user === "string" ? smtp.user : "",
      pass: typeof smtp.pass === "string" ? smtp.pass : "",
      from: typeof smtp.from === "string" ? smtp.from : "",
      to: typeof smtp.to === "string" ? smtp.to : "",
    },
  };
}

function envFallback(): AlertConfig {
  const url = (process.env.ALERT_WEBHOOK_URL || "").trim();
  if (!url) return emptyConfig();
  return { ...emptyConfig(), channel: "webhook", webhookUrl: url };
}

let cache: { config: AlertConfig; expiresAt: number } | null = null;

export async function getAlertConfig(): Promise<AlertConfig> {
  if (cache && Date.now() < cache.expiresAt) return cache.config;
  let config = envFallback();
  try {
    const stored = await getAppSetting<Partial<AlertConfig>>(SETTING_KEY);
    if (stored) config = normalize(stored);
  } catch (error) {
    console.warn(
      "[alerts] unable to read settings",
      error instanceof Error ? error.message : error,
    );
  }
  cache = { config, expiresAt: Date.now() + CACHE_MS };
  return config;
}

export async function saveAlertConfig(
  config: AlertConfig,
  adminId: string,
): Promise<void> {
  const normalized = normalize(config);
  await saveAppSetting(SETTING_KEY, normalized, adminId);
  cache = { config: normalized, expiresAt: Date.now() + CACHE_MS };
}

export function alertConfigTarget(config: AlertConfig): string {
  if (config.channel === "email") {
    return config.smtp.to || "（未填写收件人）";
  }
  if (config.channel === "off") return "未配置";
  try {
    return new URL(config.webhookUrl).host;
  } catch {
    return "地址无效";
  }
}

export async function isAlertConfigured(): Promise<boolean> {
  const config = await getAlertConfig();
  if (config.channel === "off") return false;
  if (config.channel === "email") {
    return Boolean(
      config.smtp.host &&
        config.smtp.user &&
        config.smtp.pass &&
        config.smtp.from &&
        config.smtp.to,
    );
  }
  return Boolean(config.webhookUrl);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export type AlertConfigInput = {
  channel: string;
  webhookUrl?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpTo?: string;
};

/**
 * Validates and merges a settings form. Blank secrets keep the saved value so
 * the admin can change a destination without re-entering the password.
 */
export function buildAlertConfig(
  input: AlertConfigInput,
  current: AlertConfig,
): { config: AlertConfig } | { error: string } {
  const channel = input.channel as AlertChannel;
  if (!["wecom", "feishu", "webhook", "email", "off"].includes(channel)) {
    return { error: "未知的告警渠道" };
  }
  if (channel === "off") {
    return { config: { ...emptyConfig(), channel: "off" } };
  }

  if (channel === "email") {
    const host = (input.smtpHost || current.smtp.host || "").trim();
    const port = Number(input.smtpPort || current.smtp.port || 465);
    const user = (input.smtpUser || current.smtp.user || "").trim();
    const pass = (input.smtpPass || current.smtp.pass || "").trim();
    const from = (input.smtpFrom || current.smtp.from || "").trim();
    const to = (input.smtpTo || current.smtp.to || "").trim();
    if (!host) return { error: "请填写 SMTP 服务器" };
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      return { error: "SMTP 端口不正确" };
    }
    if (!isEmail(user)) return { error: "SMTP 账号需要是邮箱地址" };
    if (!pass) return { error: "请填写 SMTP 授权码或密码" };
    if (!isEmail(from)) return { error: "发件人需要是邮箱地址" };
    const recipients = to
      .split(/[,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (recipients.length === 0 || !recipients.every(isEmail)) {
      return { error: "收件人需要是邮箱地址，多个用逗号分隔" };
    }
    return {
      config: {
        channel: "email",
        webhookUrl: "",
        smtp: {
          host,
          port: Math.trunc(port),
          user,
          pass,
          from,
          to: recipients.join(","),
        },
      },
    };
  }

  const url = (input.webhookUrl || current.webhookUrl || "").trim();
  if (!url) return { error: "请填写机器人 Webhook 地址" };
  if (!validWebhookUrl(url)) {
    return { error: "Webhook 必须是 https 地址（本地调试允许 localhost）" };
  }
  return {
    config: {
      channel,
      webhookUrl: url,
      smtp: { ...EMPTY_SMTP },
    },
  };
}

async function postJson(url: string, body: unknown): Promise<AlertResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "CokeAI-Alert/1.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { ok: false, error: `告警通道返回 HTTP ${response.status}` };
    }
    // WeCom and Feishu return HTTP 200 with a non-zero errcode on failure.
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {
        errcode?: number;
        code?: number;
        msg?: string;
        msg_type?: string;
      };
      const code = parsed.errcode ?? parsed.code;
      if (typeof code === "number" && code !== 0) {
        return { ok: false, error: `告警通道错误码 ${code}` };
      }
    } catch {
      // Non-JSON success responses are fine for custom webhooks.
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "告警通道不可达" };
  }
}

async function sendEmail(
  smtp: SmtpSettings,
  text: string,
  subject: string,
): Promise<AlertResult> {
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 12_000,
    });
    await transport.sendMail({
      from: smtp.from,
      to: smtp.to,
      subject,
      text,
    });
    transport.close();
    return { ok: true };
  } catch (error) {
    console.warn(
      "[alerts] email failed",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "邮件发送失败，请检查 SMTP 配置" };
  }
}

export async function sendAlert(
  text: string,
  extra: Record<string, unknown> = {},
): Promise<AlertResult> {
  const config = await getAlertConfig();
  if (config.channel === "off") return { ok: false, error: "未配置告警通道" };

  if (config.channel === "wecom") {
    return postJson(config.webhookUrl, {
      msgtype: "text",
      text: { content: text.slice(0, 1500) },
    });
  }
  if (config.channel === "feishu") {
    return postJson(config.webhookUrl, {
      msg_type: "text",
      content: { text: text.slice(0, 3000) },
    });
  }
  // Shop notifications reuse this channel but must not masquerade as security
  // alerts: different webhook source, different mail subject.
  const event = typeof extra.event === "string" ? extra.event : "";
  const isShop = event.startsWith("shop_");

  if (config.channel === "webhook") {
    return postJson(config.webhookUrl, {
      text,
      content: text,
      source: isShop ? "cokeai-shop" : "cokeai-security",
      ...extra,
    });
  }

  const subject =
    extra.emergency_defense === "on" || extra.emergency_defense === "off"
      ? "CokeAI 应急防护通知"
      : extra.attack
        ? "CokeAI 安全攻击告警"
        : event === "shop_manual_payment_reported"
          ? "CokeAI 小店：客户已上报支付宝付款"
          : isShop
            ? "CokeAI 小店订单提醒"
            : "CokeAI 安全告警";
  return sendEmail(config.smtp, text, subject);
}
