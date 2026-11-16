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
  /** Replies from the operator go here; defaults to the From mailbox. */
  replyTo: string;
};

export type AlertConfig = {
  channel: AlertChannel;
  webhookUrl: string;
  /** 伙伴/运营方向的发信账号：告警、邮件副本和伙伴通知都走它。 */
  smtp: SmtpSettings;
  /**
   * 客户邮件专用发件箱，和 `smtp` 是两个不同身份。
   *
   * 飞书企业邮箱要求 From 必须等于登录账号，所以「发给伙伴的」和「发给客户的」
   * 不能共用一个账号——否则两端都会收到对方的信。留空时客户邮件退回 `smtp`
   *（兼容老部署），并在日志里提示管理员配置独立发件箱。
   */
  customerSmtp: SmtpSettings;
  /**
   * Send an email copy to the partner even when the primary alert channel is
   * WeCom/Feishu/webhook. Shop events always get the copy when SMTP is ready.
   */
  emailCopy: boolean;
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
  feishu: { host: "smtp.feishu.cn", port: 465 },
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
  replyTo: "",
};

function emptyConfig(): AlertConfig {
  return {
    channel: "off",
    webhookUrl: "",
    smtp: { ...EMPTY_SMTP },
    customerSmtp: { ...EMPTY_SMTP },
    emailCopy: false,
  };
}

/** 逐字段修补库里的 SMTP 块；缺失的字段回到空值，避免半截数据把发信弄崩。 */
function normalizeSmtp(input: Partial<SmtpSettings> | null | undefined): SmtpSettings {
  const smtp = (input || {}) as Partial<SmtpSettings>;
  const port = Number(smtp.port);
  return {
    host: typeof smtp.host === "string" ? smtp.host : "",
    port: Number.isFinite(port) && port > 0 ? Math.trunc(port) : 465,
    user: typeof smtp.user === "string" ? smtp.user : "",
    pass: typeof smtp.pass === "string" ? smtp.pass : "",
    from: typeof smtp.from === "string" ? smtp.from : "",
    to: typeof smtp.to === "string" ? smtp.to : "",
    replyTo: typeof smtp.replyTo === "string" ? smtp.replyTo : "",
  };
}

function normalize(input: Partial<AlertConfig> | null): AlertConfig {
  const base = emptyConfig();
  if (!input || typeof input !== "object") return base;
  const channel = (
    ["wecom", "feishu", "webhook", "email", "off"] as const
  ).includes(input.channel as AlertChannel)
    ? (input.channel as AlertChannel)
    : "off";
  return {
    channel,
    webhookUrl: typeof input.webhookUrl === "string" ? input.webhookUrl : "",
    smtp: normalizeSmtp(input.smtp),
    customerSmtp: normalizeSmtp(input.customerSmtp),
    emailCopy:
      typeof input.emailCopy === "boolean" ? input.emailCopy : channel === "email",
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

function smtpReady(smtp: SmtpSettings): boolean {
  return Boolean(smtp.host && smtp.user && smtp.pass && smtp.from && smtp.to);
}

/** 发信的最低要求。客户邮件没有固定收件人，所以不看 `to`。 */
function smtpCanSend(smtp: SmtpSettings): boolean {
  return Boolean(smtp.host && smtp.user && smtp.pass && smtp.from);
}

export async function isAlertConfigured(): Promise<boolean> {
  const config = await getAlertConfig();
  if (config.channel === "off") return false;
  if (config.channel === "email") return smtpReady(config.smtp);
  // Shop notifications always go to the partner's mailbox, so every active
  // channel needs SMTP as well as its webhook.
  return Boolean(config.webhookUrl) && smtpReady(config.smtp);
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
  smtpReplyTo?: string;
  /** 客户邮件专用发件箱；留空表示不改动已保存的值。 */
  customerSmtpHost?: string;
  customerSmtpPort?: string;
  customerSmtpUser?: string;
  customerSmtpPass?: string;
  customerSmtpFrom?: string;
  emailCopy?: string;
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
    // 关掉告警不等于注销客户发件箱：客户邮件不是告警，不该跟着一起被清空。
    return {
      config: {
        ...emptyConfig(),
        channel: "off",
        customerSmtp: { ...current.customerSmtp },
      },
    };
  }

  const emailCopy =
    channel === "email"
      ? true
      : input.emailCopy === undefined
        ? current.emailCopy
        : ["1", "true", "on", "yes"].includes(
            String(input.emailCopy).trim().toLowerCase(),
          );

  const host = (input.smtpHost || current.smtp.host || "").trim();
  const port = Number(input.smtpPort || current.smtp.port || 465);
  const user = (input.smtpUser || current.smtp.user || "").trim();
  const pass = (input.smtpPass || current.smtp.pass || "").trim();
  const from = (input.smtpFrom || current.smtp.from || "").trim();
  const to = (input.smtpTo || current.smtp.to || "").trim();

  // 客户邮件发件箱：和伙伴通知完全分开，避免发给 wjl 的邮件和发给客户的邮件
  // 混在同一账号里（飞书要求 From 必须等于登录账号，两个身份就要两个邮箱）。
  // 四项都留空 = 不改动已保存的值；填了任一项就要求四项齐全，宁可报错也不让
  // 它悄悄退回伙伴账号发信。收件人固定在发送时决定，所以这里不存 `to`。
  const customerHost = (input.customerSmtpHost ?? "").trim();
  // 端口字段在表单里始终有值；这里再兜一层，避免只改账号时因为没带端口而报错。
  const customerPort = Number(
    input.customerSmtpPort || current.customerSmtp.port || 465,
  );
  const customerUser = (input.customerSmtpUser ?? "").trim();
  const customerPass = (input.customerSmtpPass ?? "").trim();
  const customerFrom = (input.customerSmtpFrom ?? "").trim();
  // 端口在表单里始终有值，单凭它分不清「改没改」，所以不参与「动过」判断。
  const customerTouched = Boolean(
    customerHost || customerUser || customerPass || customerFrom,
  );
  let customerSmtp: SmtpSettings = { ...current.customerSmtp };
  if (customerTouched) {
    if (!customerHost) return { error: "客户邮件发件箱：请填写 SMTP 服务器" };
    if (!Number.isFinite(customerPort) || customerPort <= 0 || customerPort > 65535) {
      return { error: "客户邮件发件箱：SMTP 端口不正确" };
    }
    if (!isEmail(customerUser)) {
      return { error: "客户邮件发件箱：账号需要是邮箱地址" };
    }
    if (!isEmail(customerFrom)) {
      return { error: "客户邮件发件箱：发件人需要是邮箱地址" };
    }
    // 密码留空沿用已保存的值，和伙伴邮箱的规则一致；但换账号时必须重填，
    // 免得把旧密码套到新账号上。
    const sameIdentity =
      customerHost.toLowerCase() === current.customerSmtp.host.toLowerCase() &&
      customerUser.toLowerCase() === current.customerSmtp.user.toLowerCase() &&
      customerFrom.toLowerCase() === current.customerSmtp.from.toLowerCase();
    const nextPass = customerPass || (sameIdentity ? current.customerSmtp.pass : "");
    if (!nextPass) {
      return { error: "客户邮件发件箱：请填写授权码或专用密码" };
    }
    customerSmtp = {
      host: customerHost,
      port: Math.trunc(customerPort),
      user: customerUser,
      pass: nextPass,
      from: customerFrom,
      to: "",
      replyTo: customerFrom,
    };
  }

  // Email is mandatory for every active channel: shop events are always
  // delivered to the partner's mailbox even when WeCom/Feishu is primary.
  const needsSmtp = true; // "off" already returned above
  // The Reply-To field is shown whenever SMTP is in use, so an empty value
  // there means "reply to the sender" rather than "keep the old mailbox".
  const replyTo = needsSmtp
    ? (input.smtpReplyTo || "").trim()
    : current.smtp.replyTo.trim();

  if (needsSmtp) {
    if (!host) return { error: "请填写 SMTP 服务器（伙伴邮件通知需要）" };
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      return { error: "SMTP 端口不正确" };
    }
    if (!isEmail(user)) return { error: "SMTP 账号需要是邮箱地址" };
    if (!pass) return { error: "请填写 SMTP 授权码或密码" };
    if (!isEmail(from)) return { error: "发件人需要是邮箱地址" };
    if (replyTo && !isEmail(replyTo)) {
      return { error: "回复邮箱需要是有效邮箱地址，留空则回到发件人" };
    }
    const recipients = to
      .split(/[,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (recipients.length === 0 || !recipients.every(isEmail)) {
      return { error: "伙伴邮箱需要是有效邮箱地址，多个用逗号分隔" };
    }
    const smtp = {
      host,
      port: Math.trunc(port),
      user,
      pass,
      from,
      to: recipients.join(","),
      replyTo: replyTo || from,
    };
    if (channel === "email") {
      return { config: { channel, webhookUrl: "", smtp, customerSmtp, emailCopy: true } };
    }
    const url = (input.webhookUrl || current.webhookUrl || "").trim();
    if (!url) return { error: "请填写机器人 Webhook 地址" };
    if (!validWebhookUrl(url)) {
      return { error: "Webhook 必须是 https 地址（本地调试允许 localhost）" };
    }
    return {
      config: { channel, webhookUrl: url, smtp, customerSmtp, emailCopy },
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
      smtp: { ...current.smtp, replyTo: replyTo || current.smtp.replyTo },
      customerSmtp,
      emailCopy: false,
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

/**
 * Recipients should see the shop's name instead of the mailbox account (for
 * example a QQ number). The address itself must stay the authenticated sender.
 */
function senderHeader(from: string): { name: string; address: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (match) {
    return { name: match[1] || "CokeAI", address: match[2].trim() };
  }
  return { name: "CokeAI", address: from.trim() };
}

async function sendEmailTo(
  smtp: SmtpSettings,
  to: string,
  text: string,
  subject: string,
  replyNote: string,
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
    const replyTo = smtp.replyTo.trim() || smtp.from;
    await transport.sendMail({
      from: senderHeader(smtp.from),
      to,
      replyTo: replyTo || undefined,
      subject,
      text: replyTo ? `${text}\n\n---\n${replyNote}` : text,
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

function sendEmail(
  smtp: SmtpSettings,
  text: string,
  subject: string,
): Promise<AlertResult> {
  return sendEmailTo(
    smtp,
    smtp.to,
    text,
    subject,
    "直接回复本邮件即可联系 CokeAI 运营负责人。",
  );
}

/**
 * Sends a one-off message to a customer (e.g. a shop delivery notice).
 *
 * 客户邮件优先使用「客户邮件发件箱」（`customerSmtp`），和发给伙伴/运营的通知
 * 是两个不同身份，避免两端互相收到对方的信。没配置专用发件箱时退回伙伴账号以
 * 兼容老部署，并在日志里点名，提醒管理员去后台把两个身份分开。
 * Customer mail is not an alert: it never goes to the partner recipient or
 * webhook. Callers must treat a failure as non-fatal.
 */
export async function sendCustomerEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<AlertResult> {
  const config = await getAlertConfig();
  const to = input.to.trim();
  if (!isEmail(to)) return { ok: false, error: "客户邮箱无效" };
  const dedicated = smtpCanSend(config.customerSmtp) ? config.customerSmtp : null;
  const fallback = smtpCanSend(config.smtp) ? config.smtp : null;
  const smtp = dedicated || fallback;
  if (!smtp) {
    return { ok: false, error: "SMTP 未配置，客户邮件未发送" };
  }
  if (!dedicated) {
    console.warn(
      "[alerts] 客户邮件正在借用伙伴邮箱发件，请在后台配置「客户邮件发件箱」把两个身份分开",
    );
  }
  return sendEmailTo(
    smtp,
    to,
    input.text,
    input.subject,
    "直接回复本邮件即可联系 CokeAI 客服。",
  );
}

/** Whether customer mail can actually leave the shop right now. */
export async function customerMailReady(): Promise<boolean> {
  const config = await getAlertConfig();
  return smtpCanSend(config.customerSmtp) || smtpCanSend(config.smtp);
}

/** 客户邮件是否已经用上独立发件箱（后台据此提示「还没分开」）。 */
export async function customerMailSeparated(): Promise<boolean> {
  const config = await getAlertConfig();
  return smtpCanSend(config.customerSmtp);
}

export async function sendAlert(
  text: string,
  extra: Record<string, unknown> = {},
): Promise<AlertResult> {
  const config = await getAlertConfig();
  if (config.channel === "off") return { ok: false, error: "未配置告警通道" };

  // Shop notifications reuse this channel but must not masquerade as security
  // alerts: different webhook source, different mail subject.
  const event = typeof extra.event === "string" ? extra.event : "";
  // Shop events use `shop_...`; maintenance alerts use `shop-...`.
  const isShop = event.startsWith("shop_") || event.startsWith("shop-");
  const subject =
    extra.emergency_defense === "on" || extra.emergency_defense === "off"
      ? "CokeAI 应急防护通知"
      : extra.attack
        ? "CokeAI 安全攻击告警"
        : event === "shop_order_created"
          ? "CokeAI 小店：客户已下单（待付款）"
          : event === "shop_manual_payment_reported"
            ? "CokeAI 小店：客户已上报支付宝付款"
            : event === "shop_balance_ops_note"
              ? "CokeAI 小店：余额支付异常处理说明"
              : isShop
                ? "CokeAI 小店订单提醒"
                : "CokeAI 安全告警";

  let primary: AlertResult;
  if (config.channel === "wecom") {
    primary = await postJson(config.webhookUrl, {
      msgtype: "text",
      text: { content: text.slice(0, 1500) },
    });
  } else if (config.channel === "feishu") {
    primary = await postJson(config.webhookUrl, {
      msg_type: "text",
      content: { text: text.slice(0, 3000) },
    });
  } else if (config.channel === "webhook") {
    primary = await postJson(config.webhookUrl, {
      text,
      content: text,
      source: isShop ? "cokeai-shop" : "cokeai-security",
      ...extra,
    });
  } else {
    return sendEmail(config.smtp, text, subject);
  }

  // The partner can be on WeCom/Feishu and still wants an email record. Shop
  // events always get the copy; other alerts follow the admin toggle.
  const wantsEmailCopy = config.emailCopy || isShop;
  if (wantsEmailCopy && smtpReady(config.smtp)) {
    const copy = await sendEmail(config.smtp, text, subject);
    if (!copy.ok) {
      console.warn("[alerts] email copy not delivered:", copy.error);
      if (isShop) return copy;
    }
    return primary.ok ? primary : copy.ok ? copy : primary;
  }
  return primary;
}
