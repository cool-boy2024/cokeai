"use client";

import { useState } from "react";
import { saveAlertSettingsAction } from "@/app/actions/admin-alerts";
import type { AlertChannel } from "@/lib/alerts";

const CHANNELS: Array<{ value: AlertChannel; label: string; hint: string }> = [
  {
    value: "wecom",
    label: "企业微信机器人",
    hint: "企业微信群 → 群设置 → 群机器人 → 添加机器人，复制 Webhook 地址。",
  },
  {
    value: "feishu",
    label: "飞书机器人",
    hint: "飞书群 → 设置 → 群机器人 → 添加自定义机器人，复制 Webhook 地址。",
  },
  {
    value: "webhook",
    label: "自定义 Webhook",
    hint: "接收 { text, content, source } JSON 的转发器或自建服务。",
  },
  {
    value: "email",
    label: "邮箱 SMTP",
    hint: "用 QQ / 163 / Gmail 的 SMTP 授权码发信；收件人可填多个，用逗号分隔。",
  },
  {
    value: "off",
    label: "暂不配置",
    hint: "关闭告警推送；攻击事件仍会记录在 /admin/security。",
  },
];

const PRESETS = [
  { value: "qq", label: "QQ 邮箱", host: "smtp.qq.com", port: 465 },
  { value: "163", label: "163 邮箱", host: "smtp.163.com", port: 465 },
  { value: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 465 },
  { value: "custom", label: "自定义 SMTP", host: "", port: 465 },
];

export type AlertFormValues = {
  channel: AlertChannel;
  webhookConfigured: boolean;
  webhookHost: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    from: string;
    to: string;
    replyTo: string;
    passwordConfigured: boolean;
  };
  emailCopy: boolean;
};

export function AlertSettingsForm({ current }: { current: AlertFormValues }) {
  const [channel, setChannel] = useState<AlertChannel>(current.channel);
  const [preset, setPreset] = useState(() => {
    const match = PRESETS.find(
      (item) => item.host && item.host === current.smtp.host,
    );
    return match?.value || "custom";
  });
  const [host, setHost] = useState(current.smtp.host || "smtp.qq.com");
  const [port, setPort] = useState(current.smtp.port || 465);
  const [emailCopy, setEmailCopy] = useState(
    current.channel === "email" || current.emailCopy,
  );

  const active = CHANNELS.find((item) => item.value === channel)!;
  const needsWebhook =
    channel === "wecom" || channel === "feishu" || channel === "webhook";
  // Shop events always email the partner, so SMTP is required for every
  // active channel, not only when the email copy box is checked.
  const showSmtp = channel !== "off";

  const applyPreset = (value: string) => {
    setPreset(value);
    const next = PRESETS.find((item) => item.value === value);
    if (next && next.host) {
      setHost(next.host);
      setPort(next.port);
    }
  };

  return (
    <form action={saveAlertSettingsAction} className="form-stack">
      <div className="field">
        <label htmlFor="alert-channel">告警渠道</label>
        <select
          id="alert-channel"
          className="input"
          name="channel"
          value={channel}
          onChange={(event) => setChannel(event.target.value as AlertChannel)}
        >
          {CHANNELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <small className="hint">{active.hint}</small>
      </div>

      {needsWebhook ? (
        <div className="field">
          <label htmlFor="alert-webhook">机器人 Webhook</label>
          <input
            id="alert-webhook"
            className="input mono"
            name="webhookUrl"
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={
              current.webhookConfigured
                ? `已配置（${current.webhookHost}），留空不修改`
                : "https://..."
            }
          />
          <small className="hint">
            URL 含机器人密钥，只保存在服务器加密存储里，不会回显。
          </small>
        </div>
      ) : null}

      {channel !== "email" ? (
        <label className="field checkbox-field">
          <span>
            <strong>其他告警也发送邮件副本</strong>
            <small className="hint">
              小店下单、付款和异常提醒始终发到下面的伙伴邮箱；勾选后，安全摘要等其他告警也会发邮件。
            </small>
          </span>
          <input
            type="checkbox"
            name="emailCopy"
            value="1"
            checked={emailCopy}
            onChange={(event) => setEmailCopy(event.target.checked)}
          />
        </label>
      ) : null}

      {showSmtp ? (
        <>
          <div className="form-row">
            <div className="field">
              <label htmlFor="smtp-preset">邮箱服务商</label>
              <select
                id="smtp-preset"
                className="input"
                value={preset}
                onChange={(event) => applyPreset(event.target.value)}
              >
                {PRESETS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="smtp-port">端口</label>
              <input
                id="smtp-port"
                className="input mono"
                name="smtpPort"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(Number(event.target.value) || 465)}
                required
              />
              <small className="hint">465 为 SSL，587 为 STARTTLS。</small>
            </div>
          </div>
          <div className="field">
            <label htmlFor="smtp-host">SMTP 服务器</label>
            <input
              id="smtp-host"
              className="input mono"
              name="smtpHost"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="smtp.qq.com"
              required
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="smtp-user">SMTP 账号</label>
              <input
                id="smtp-user"
                className="input"
                name="smtpUser"
                type="email"
                defaultValue={current.smtp.user}
                placeholder="用来发信的邮箱"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="smtp-pass">授权码 / 密码</label>
              <input
                id="smtp-pass"
                className="input"
                name="smtpPass"
                type="password"
                autoComplete="new-password"
                placeholder={
                  current.smtp.passwordConfigured
                    ? "已保存，留空不修改"
                    : "QQ / 163 请填授权码"
                }
              />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="smtp-from">发件人</label>
              <input
                id="smtp-from"
                className="input"
                name="smtpFrom"
                type="email"
                defaultValue={current.smtp.from || current.smtp.user}
                placeholder="通常与 SMTP 账号相同"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="smtp-to">伙伴邮箱（收件人）</label>
              <input
                id="smtp-to"
                className="input"
                name="smtpTo"
                defaultValue={current.smtp.to}
                placeholder="partner@example.com，多个用逗号分隔"
                required={showSmtp}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="smtp-reply-to">伙伴回复邮箱（Reply-To）</label>
            <input
              id="smtp-reply-to"
              className="input"
              name="smtpReplyTo"
              type="email"
              defaultValue={current.smtp.replyTo || current.smtp.from}
              placeholder="留空则回复到发件人邮箱"
            />
            <small className="hint">
              伙伴在邮件里点“回复”会直接发到这个邮箱，形成双向联系；双方都不需要另开聊天工具。
            </small>
          </div>
          <small className="hint">
            小店通知必须走邮箱，所以任何告警渠道都要填写 SMTP。密码/授权码加密存储，
            页面不会回显；留空表示沿用已保存的值。
          </small>
        </>
      ) : null}

      <div className="form-actions">
        <button className="btn btn-light" type="submit" name="intent" value="save">
          保存设置
        </button>
        <button className="btn btn-primary" type="submit" name="intent" value="test">
          保存并发送测试
        </button>
      </div>
    </form>
  );
}
