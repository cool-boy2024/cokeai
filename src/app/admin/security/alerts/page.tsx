import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  Mail,
} from "lucide-react";
import {
  ALERT_CHANNEL_LABELS,
  alertConfigTarget,
  getAlertConfig,
  isAlertConfigured,
} from "@/lib/alerts";
import { requireAdmin } from "@/lib/auth";
import {
  AlertSettingsForm,
  type AlertFormValues,
} from "@/components/admin/AlertSettingsForm";

export const metadata: Metadata = { title: "告警设置" };
export const dynamic = "force-dynamic";

export default async function AlertSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const config = await getAlertConfig();
  const configured = await isAlertConfigured();

  let webhookHost = "";
  try {
    webhookHost = config.webhookUrl ? new URL(config.webhookUrl).host : "";
  } catch {
    webhookHost = "";
  }

  const current: AlertFormValues = {
    channel: config.channel,
    webhookConfigured: Boolean(config.webhookUrl),
    webhookHost,
    smtp: {
      host: config.smtp.host,
      port: config.smtp.port,
      user: config.smtp.user,
      from: config.smtp.from,
      to: config.smtp.to,
      passwordConfigured: Boolean(config.smtp.pass),
    },
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>告警设置</h1>
          <p>
            被攻击时把告警发到企业微信、飞书或邮箱。填写后点“保存并发送测试”，
            群里/邮箱收到消息即生效。
          </p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-light btn-sm" href="/admin/security">
            <ArrowLeft size={14} /> 返回安全
          </Link>
        </div>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>告警设置已保存。</div>
        </div>
      ) : null}
      {params.test === "sent" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>测试消息已发送，请到群里或邮箱确认收到。</div>
        </div>
      ) : null}
      {params.test === "failed" ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>
            设置已保存，但测试发送失败。检查 Webhook / SMTP 信息、服务器出口和授权码；
            企业微信和飞书机器人要确认群机器人仍在。
          </div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>当前通道</h2>
            <p className="small muted">
              n8n 每 5 分钟检查一次安全摘要；达到攻击阈值时由应用直接发送，
              机器人地址和 SMTP 密码不会传给 n8n。
            </p>
          </div>
          <span className={`badge ${configured ? "badge-green" : "badge-yellow"}`}>
            {configured ? "已配置" : "未配置"}
          </span>
        </div>
        <div className="notice">
          {config.channel === "email" ? <Mail size={16} /> : <Bell size={16} />}
          <div>
            <strong>{ALERT_CHANNEL_LABELS[config.channel]}</strong>
            {" · "}
            {alertConfigTarget(config)}
            {configured
              ? "。攻击告警、应急防护通知和管理员手动摘要都会走这个通道。"
              : "。填写下面的信息并发送测试后生效。"}
          </div>
        </div>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>通道信息</h2>
            <p className="small muted">
              只需要运营/伙伴自己的机器人或邮箱信息；密码类字段保存后不回显，留空表示不修改。
            </p>
          </div>
        </div>
        <div className="panel-body">
          <AlertSettingsForm current={current} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>安全边界</h2>
          </div>
        </div>
        <ul className="small" style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>企业微信/飞书只接收文本消息，不包含密钥、顾客信息或完整日志。</li>
          <li>Webhook 地址和 SMTP 密码使用项目密钥加密后存数据库。</li>
          <li>测试、摘要和攻击告警共用同一通道；冷却时间仍是 30 分钟。</li>
          <li>
            旧的 <code>ALERT_WEBHOOK_URL</code> 仍作为未配置时的兜底，可在服务器
            <code>.env</code> 保留或删除。
          </li>
        </ul>
      </section>
    </>
  );
}
