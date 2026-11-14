import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Network,
  Radar,
  ShieldCheck,
  Siren,
  Users,
} from "lucide-react";
import {
  sendSecuritySummaryAlertAction,
  sendSecurityTestAlertAction,
  toggleEmergencyDefenseAction,
  toggleStrictModeAction,
} from "@/app/actions/admin-security";
import {
  ALERT_CHANNEL_LABELS,
  alertConfigTarget,
  getAlertConfig,
} from "@/lib/alerts";
import { requireAdmin } from "@/lib/auth";
import { SecurityVisibility } from "@/components/admin/SecurityVisibility";
import { formatDateTime } from "@/lib/format";
import {
  getSecuritySnapshot,
  SECURITY_EVENT_LABELS,
  SECURITY_STATUS_LABELS,
  securityPolicy,
  securityRecommendations,
  type DefenseMode,
  type SecurityEventType,
} from "@/lib/security";

export const metadata: Metadata = { title: "安全" };
export const dynamic = "force-dynamic";

function typeLabel(type: string): string {
  return SECURITY_EVENT_LABELS[type as SecurityEventType] || type;
}

function defenseRows(defenseMode: DefenseMode) {
  return [
    {
      name: "应急防护（一键）",
      state: defenseMode === "emergency" ? "已启动" : "未启动",
      detail:
        defenseMode === "emergency"
          ? "敏感路径限速减半，24 小时后自动恢复；边缘切换待运维执行"
          : "受到真实攻击时在右上角一键启动，平时保持关闭",
      ok: defenseMode === "emergency",
    },
    {
      name: "应用层扫描拦截",
      state: securityPolicy.guardEnabled ? "已启用" : "已关闭",
      detail: "拦截 /.env、/.git、wp-admin、phpMyAdmin、路径穿越等常见探测",
      ok: securityPolicy.guardEnabled,
    },
    {
      name: "登录 / 注册频控",
      state: securityPolicy.guardEnabled ? "已启用" : "已关闭",
      detail: "IP 与邮箱双维度，失败次数异常上升时记录事件",
      ok: securityPolicy.guardEnabled,
    },
    {
      name: "小店 / API 频控",
      state: securityPolicy.guardEnabled ? "已启用" : "已关闭",
      detail: "验证码、商品页、下单与公开 API 按 IP 限速",
      ok: securityPolicy.guardEnabled,
    },
    {
      name: "Server Action 频控",
      state: securityPolicy.guardEnabled ? "已启用" : "已关闭",
      detail: "所有 POST Server Action 每 IP 60 次/分钟",
      ok: securityPolicy.guardEnabled,
    },
    {
      name: "边缘 Caddy 限流",
      state: defenseMode === "emergency" ? "待运维切换" : "待启用",
      detail:
        defenseMode === "emergency"
          ? "应急已发令；构建镜像、挂载限流片段并验证后，经审批切 Tunnel 到 edge:8080"
          : "Tunnel 仍指向 app:3000；切到 edge:8080 后按 docs/SECURITY.md 开启",
      ok: false,
    },
    {
      name: "CrowdSec 行为封禁",
      state: "预案",
      detail: "边缘启用后再加，按社区黑名单与行为决策封 IP",
      ok: false,
    },
    {
      name: "Anubis PoW 挑战",
      state: "未启用",
      detail: "只适合持续洪水时临时开启；会伤正常顾客转化与 SEO",
      ok: false,
    },
    {
      name: "WAF（BunkerWeb / SafeLine）",
      state: "不适配当前机器",
      detail: "2 vCPU / 3.5GB 内存、磁盘余量约 6GB，装不下生产可用配置",
      ok: false,
    },
  ];
}

export default async function AdminSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const snapshot = await getSecuritySnapshot(100);
  const alertConfig = await getAlertConfig();

  const rows = defenseRows(snapshot.defenseMode);
  const advice = securityRecommendations(snapshot);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>安全</h1>
          <p>应用层拦截、攻击事件与管理员告警。数据来自 Redis，保留最近 2000 条。</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-light btn-sm" href="/admin/security/alerts">
            <Bell size={14} /> 告警设置
          </Link>
          <Link className="btn btn-light btn-sm" href="/admin/security/sessions">
            <Users size={14} /> 在线会话
          </Link>
          <form action={sendSecuritySummaryAlertAction}>
            <button className="btn btn-light btn-sm" type="submit">
              <Bell size={14} /> 发送当前摘要
            </button>
          </form>
          <form action={sendSecurityTestAlertAction}>
            <button className="btn btn-light btn-sm" type="submit">
              <ShieldCheck size={14} /> 测试告警
            </button>
          </form>
          <form action={toggleEmergencyDefenseAction}>
            <input
              type="hidden"
              name="mode"
              value={snapshot.defenseMode === "emergency" ? "off" : "on"}
            />
            <button
              className={`btn btn-sm ${
                snapshot.defenseMode === "emergency" ? "btn-dark" : "btn-danger"
              }`}
              type="submit"
            >
              <Siren size={14} />
              {snapshot.defenseMode === "emergency"
                ? "关闭应急防护"
                : "启动应急防护"}
            </button>
          </form>
          <form action={toggleStrictModeAction}>
            <input type="hidden" name="mode" value={snapshot.strictMode ? "off" : "on"} />
            <button
              className={`btn btn-sm ${snapshot.strictMode ? "btn-dark" : "btn-light"}`}
              type="submit"
            >
              {snapshot.strictMode ? "恢复正常限流" : "临时收紧限流"}
            </button>
          </form>
          <span
            className={`badge badge-dot ${
              snapshot.status === "attack" || snapshot.status === "emergency"
                ? "badge-red"
                : snapshot.status === "watch"
                  ? "badge-yellow"
                  : "badge-green"
            }`}
          >
            {SECURITY_STATUS_LABELS[snapshot.status]}
          </span>
        </div>
      </div>

      {params.test === "sent" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>测试告警已发送，请到告警渠道确认收到。</div>
        </div>
      ) : null}
      {params.test === "summary_sent" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>当前安全摘要已发送到告警通道。</div>
        </div>
      ) : null}
      {params.test === "failed" ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>
            告警未发送。到“告警设置”检查渠道是否配置，并点“保存并发送测试”验证。
          </div>
        </div>
      ) : null}
      {params.mode === "strict" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>已临时收紧限流：敏感路径限速减半，60 分钟后自动恢复。</div>
        </div>
      ) : null}
      {params.mode === "normal" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>已恢复正常限流。</div>
        </div>
      ) : null}
      {params.mode === "failed" ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>限流模式切换失败。检查 Redis 是否可用。</div>
        </div>
      ) : null}
      {params.defense === "on" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>
            应急防护已启动：应用层限速立即减半，24 小时后自动恢复；告警通道已收到边缘切换步骤。Tunnel 仍需运维人工切换。
          </div>
        </div>
      ) : null}
      {params.defense === "off" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>
            应急防护已关闭，限流恢复常规。请确认 Cloudflare Tunnel origin 已改回 app:3000，并复验核心页面。
          </div>
        </div>
      ) : null}
      {params.defense === "failed" ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>应急防护切换失败。检查 Redis 是否可用。</div>
        </div>
      ) : null}

      {snapshot.attack ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>
            近 {snapshot.windowMinutes} 分钟已拦截 {snapshot.windowCount} 次，超过阈值{" "}
            {snapshot.threshold}。n8n 每 5 分钟检查一次；同一波攻击最多每{" "}
            {securityPolicy.alertCooldownMinutes} 分钟告警一次。
            {snapshot.alertCooldownSeconds > 0
              ? ` 当前告警冷却剩余约 ${Math.ceil(snapshot.alertCooldownSeconds / 60)} 分钟。`
              : " 尚未发送告警。"}
          </div>
        </div>
      ) : (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>
            近 {snapshot.windowMinutes} 分钟拦截 {snapshot.windowCount} 次，低于阈值{" "}
            {snapshot.threshold}。持续扫描会自动进入告警状态。
          </div>
        </div>
      )}

      {!snapshot.available ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>Redis 不可用，当前看不到拦截明细。应用层防护会继续放行请求，优先恢复 Redis。</div>
        </div>
      ) : null}

      <SecurityVisibility snapshot={snapshot} />

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>应急防护</h2>
            <p className="small muted">
              确认正在被攻击后由管理员一键启动；平时保持关闭，避免误伤正常顾客。
            </p>
          </div>
          <span
            className={`badge ${
              snapshot.defenseMode === "emergency" ? "badge-red" : "badge-green"
            }`}
          >
            {snapshot.defenseMode === "emergency"
              ? `已启动 · 剩余 ${Math.ceil(snapshot.defenseSecondsRemaining / 3600)} 小时`
              : "未启动"}
          </span>
        </div>
        <div
          className={`notice ${
            snapshot.defenseMode === "emergency" ? "notice-red" : ""
          }`}
        >
          <Siren size={16} />
          <div>
            {snapshot.defenseMode === "emergency"
              ? "应用层敏感路径限速已减半，安全事件继续记录。边缘限流是否生效取决于 Tunnel 是否已切到 edge:8080，请看下方待办。"
              : "点右上角“启动应急防护”：应用层限速立即减半，同时给告警通道发送边缘切换步骤，24 小时后自动恢复。"}
          </div>
        </div>
        <ol className="small" style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>立即生效：登录、注册、下单、API、Server Action 等敏感入口限速减半，不需要发版。</li>
          <li>自动通知：告警通道已配置时，会收到启动信息和三步边缘切换命令。</li>
          <li>
            待运维：构建 <code>cokeai-caddy:ratelimit</code> 镜像、挂载
            <code>limits.rate-limit.caddy</code>、验证 429 与 SSE，再经审批把 Tunnel origin 从
            <code>app:3000</code> 改到 <code>edge:8080</code>。
          </li>
          <li>
            关闭：点“关闭应急防护”恢复常规限流，并把 Tunnel 改回 <code>app:3000</code>。
          </li>
        </ol>
        <p className="small muted">
          按钮不会自动修改 Cloudflare Tunnel 或重建容器——这两步是生产变更，必须由运维在服务器执行。
          完整步骤与回滚见 <code>docs/SECURITY.md</code> 和 <code>ops/edge/README.md</code>。
        </p>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>处置建议</h2>
            <p className="small muted">
              顺序：确认告警 → 判断类型 → 先控制影响 → 记录时间线 → 再恢复。优先用可逆动作，不要一上来就重启或清 Redis。
            </p>
          </div>
          <span className={`badge ${snapshot.strictMode ? "badge-red" : "badge-yellow"}`}>
            {snapshot.strictMode
              ? `严格限流中 · 剩余 ${Math.ceil(snapshot.strictSecondsRemaining / 60)} 分钟`
              : "常规限流"}
          </span>
        </div>
        <ol className="small" style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          {advice.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>告警通道</h2>
            <p className="small muted">
              支持企业微信、飞书、自定义 Webhook 和邮箱 SMTP。n8n 只负责每 5 分钟拉取摘要，实际发送由应用完成。
            </p>
          </div>
          <span
            className={`badge ${
              snapshot.alertChannelConfigured ? "badge-green" : "badge-red"
            }`}
          >
            {snapshot.alertChannelConfigured ? "已配置" : "未配置"}
          </span>
        </div>
        <div className="notice">
          <Radar size={16} />
          <div>
            {snapshot.alertChannelConfigured
              ? `当前通道：${ALERT_CHANNEL_LABELS[alertConfig.channel]} · ${alertConfigTarget(alertConfig)}。攻击达到阈值后，同一波攻击受 30 分钟冷却限制。`
              : "还没有配置告警通道。"}
            {" "}
            <Link href="/admin/security/alerts">去告警设置</Link>
            ，填好机器人或邮箱后点“保存并发送测试”。
          </div>
        </div>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>防护状态</h2>
            <p className="small muted">
              重防护默认不启用，避免误伤顾客。开启顺序与回滚见 docs/SECURITY.md。
            </p>
          </div>
          <Activity size={16} />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>层</th>
                <th>状态</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <div className="small">{row.name}</div>
                  </td>
                  <td>
                    <span className={`badge ${row.ok ? "badge-green" : "badge-yellow"}`}>
                      {row.state}
                    </span>
                  </td>
                  <td>
                    <div className="small muted">{row.detail}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>来源 IP</h2>
            <p className="small muted">今日触发拦截最多的来源。</p>
          </div>
          <Network size={16} />
        </div>
        {snapshot.topIps.length === 0 ? (
          <div className="empty">今天还没有拦截记录。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>IP</th>
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.topIps.map((item) => (
                  <tr key={item.ip}>
                    <td className="mono small">{item.ip}</td>
                    <td className="mono small">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>最近事件</h2>
            <p className="small muted">
              最多显示 100 条，同一 IP 同一类型 1 分钟内合并。查询串不入库，避免记录敏感参数。
            </p>
          </div>
        </div>
        {snapshot.recent.length === 0 ? (
          <div className="empty">没有拦截事件。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>来源</th>
                  <th>请求</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recent.map((event, index) => (
                  <tr key={`${event.at}-${index}`}>
                    <td className="mono small nowrap">
                      {formatDateTime(new Date(event.at).toISOString())}
                    </td>
                    <td>
                      <span className="badge badge-yellow">{typeLabel(event.type)}</span>
                    </td>
                    <td className="mono small">{event.ip}</td>
                    <td>
                      <div className="mono small">
                        {event.method} {event.path}
                      </div>
                      {event.ua ? (
                        <div className="small muted" style={{ maxWidth: 360 }}>
                          {event.ua}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="small muted">{event.detail || "—"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
