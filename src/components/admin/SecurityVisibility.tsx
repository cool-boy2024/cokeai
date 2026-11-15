import {
  Activity,
  AlertTriangle,
  Network,
  Radar,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { formatDateTime } from "@/lib/format";
import {
  SECURITY_EVENT_LABELS,
  SECURITY_STATUS_LABELS,
  securityStatusRules,
  type SecurityEventType,
  type SecuritySnapshot,
  type SecurityStatus,
} from "@/lib/security";

function typeLabel(type: string): string {
  return SECURITY_EVENT_LABELS[type as SecurityEventType] || type;
}

function statusMeta(status: SecurityStatus): {
  Icon: typeof ShieldCheck;
  description: string;
} {
  if (status === "emergency") {
    return {
      Icon: Siren,
      description:
        "应急开关已启动，敏感入口限速减半。确认攻击停止后请关闭应急防护，并把边缘配置恢复。",
    };
  }
  if (status === "attack") {
    return {
      Icon: AlertTriangle,
      description:
        "拦截计数已超过攻击阈值。先看类型与来源，再按下方处置建议操作；优先收紧限流和封明确 IP。",
    };
  }
  if (status === "watch") {
    return {
      Icon: Radar,
      description:
        "近期拦截高于日常水平，但还没达到攻击阈值。保持观察，确认告警通道可用。",
    };
  }
  if (status === "scan") {
    return {
      Icon: Radar,
      description:
        "外部扫描器在枚举 .env、.git 等常见敏感路径，已全部拦截。单一来源的小流量扫描属于互联网背景噪声，保持防护即可，不会发送告警。",
    };
  }
  return {
    Icon: ShieldCheck,
    description:
      "近 1 小时拦截低于观察阈值，应用层扫描拦截与限流正常工作。",
  };
}

export function SecurityVisibility({ snapshot }: { snapshot: SecuritySnapshot }) {
  const { Icon, description } = statusMeta(snapshot.status);
  const typeEntries = Object.entries(snapshot.byType).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = Math.max(1, ...typeEntries.map(([, count]) => count));
  const maxHourCount = Math.max(
    1,
    ...snapshot.hourly.map((bucket) => bucket.count),
  );

  if (!snapshot.available) {
    return (
      <section className="panel mb-16">
        <div className="empty">
          Redis 不可用，暂时看不到拦截计数。应用层防护会继续放行请求，优先恢复 Redis。
        </div>
      </section>
    );
  }

  return (
    <>
      <section
        className={`panel mb-16 security-status security-status-${snapshot.status}`}
      >
        <div className="security-status-head">
          <div className="security-status-main">
            <span className="security-status-icon">
              <Icon size={22} />
            </span>
            <div>
              <div className="security-status-kicker">当前防护状态</div>
              <h2>{SECURITY_STATUS_LABELS[snapshot.status]}</h2>
              <p>{description}</p>
            </div>
          </div>
          <div className="security-status-windows" aria-label="最近拦截计数">
            <div>
              <span>近 5 分钟</span>
              <strong>{snapshot.count5m}</strong>
            </div>
            <div>
              <span>近 15 分钟</span>
              <strong>{snapshot.count15m}</strong>
            </div>
            <div>
              <span>近 1 小时</span>
              <strong>{snapshot.count1h}</strong>
            </div>
          </div>
        </div>
        <div className="security-status-rules">
          <strong>判定规则</strong>
          <ul>
            <li>应急防护：应急开关已启动（优先级最高）</li>
            <li>
              攻击中（会告警）：扫描探测 5 分钟 ≥ {securityStatusRules.attackProbe5m}{" "}
              次或 15 分钟 ≥ {securityStatusRules.attackProbe15m} 次；或{" "}
              {securityStatusRules.distributed5mIps} 个以上 IP 在 5 分钟内拦截 ≥{" "}
              {securityStatusRules.distributed5mBlocks} 次；或{" "}
              {securityStatusRules.distributed15mIps} 个以上 IP 在 15 分钟内拦截 ≥{" "}
              {securityStatusRules.distributed15mBlocks} 次；或登录/下单/客服/后台动作
              15 分钟 ≥ {securityStatusRules.attackAbuse15m} 次；或限流触发 15 分钟 ≥{" "}
              {securityStatusRules.attackFlood15m} 次
            </li>
            <li>
              扫描探测（不告警）：单一来源只打被拦截路径，15 分钟 ≥{" "}
              {securityStatusRules.scanProbe15m} 次
            </li>
            <li>
              观察：未达攻击条件，但近 5 分钟 ≥ {securityStatusRules.watch5m} 次或近 1 小时 ≥{" "}
              {securityStatusRules.watch1h} 次
            </li>
            <li>
              正常：以上均不满足；计数按每次实际拦截累计，不受 60 秒事件去重影响
            </li>
          </ul>
        </div>
      </section>

      <div className="stat-grid security-stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            今日拦截 <Activity size={15} />
          </div>
          <div className="stat-value">{snapshot.todayTotal}</div>
          <div className="stat-foot">按北京时间统计，每次拦截都计数</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            近 24 小时 <Radar size={15} />
          </div>
          <div className="stat-value">{snapshot.last24hTotal}</div>
          <div className="stat-foot">按小时聚合，含当前小时</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            近 7 天 <ShieldCheck size={15} />
          </div>
          <div className="stat-value">{snapshot.last7dTotal}</div>
          <div className="stat-foot">含今日，计数保留 9 天</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            今日独立 IP <Network size={15} />
          </div>
          <div className="stat-value">{snapshot.todayUniqueIps}</div>
          <div className="stat-foot">触发过拦截的来源</div>
        </div>
      </div>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>今日拦截类型</h2>
            <p className="small muted">
              按实际拦截次数统计；扫描探测、限流和登录异常分别归类。
            </p>
          </div>
          <span className="badge badge-yellow">今日 {snapshot.todayTotal} 次</span>
        </div>
        <div className="panel-body">
          {typeEntries.length === 0 ? (
            <div className="empty">今日暂无拦截</div>
          ) : (
            <div className="security-type-list">
              {typeEntries.map(([type, count]) => (
                <div className="security-type-item" key={type}>
                  <div className="security-type-name">{typeLabel(type)}</div>
                  <div className="security-type-track">
                    <span
                      className="security-type-fill"
                      style={{
                        width: `${Math.max(4, Math.round((count / maxTypeCount) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="security-type-count">{count}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>近 24 小时拦截时间线</h2>
            <p className="small muted">
              按北京时间小时聚合，最右侧为当前小时，仍在累计。
            </p>
          </div>
          <span className="badge badge-yellow">
            近 24 小时 {snapshot.last24hTotal} 次
          </span>
        </div>
        <div className="panel-body">
          {snapshot.last24hTotal === 0 ? (
            <div className="empty">近 24 小时暂无拦截</div>
          ) : (
            <div className="security-timeline">
              <div
                className="security-timeline-bars"
                role="img"
                aria-label={`近 24 小时共拦截 ${snapshot.last24hTotal} 次`}
              >
                {snapshot.hourly.map((bucket) => (
                  <div
                    className="security-timeline-col"
                    key={bucket.at}
                    title={`${bucket.label} · ${bucket.count} 次`}
                  >
                    <span
                      className={`security-timeline-bar${
                        bucket.count === 0 ? " is-empty" : ""
                      }`}
                      style={{
                        height:
                          bucket.count === 0
                            ? "2px"
                            : `${Math.max(6, Math.round((bucket.count / maxHourCount) * 100))}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="security-timeline-axis" aria-hidden="true">
                <span>{snapshot.hourly[0]?.shortLabel}</span>
                <span>{snapshot.hourly[6]?.shortLabel}</span>
                <span>{snapshot.hourly[12]?.shortLabel}</span>
                <span>{snapshot.hourly[18]?.shortLabel}</span>
                <span>现在</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>拦截时间</h2>
            <p className="small muted">
              最近一次拦截与最近一次超过攻击阈值的时间，均来自真实计数。
            </p>
          </div>
        </div>
        <div className="security-meta-row">
          <div>
            <span>最近一次拦截</span>
            <strong>
              {snapshot.lastEventAt
                ? formatDateTime(new Date(snapshot.lastEventAt).toISOString())
                : "暂无拦截"}
            </strong>
          </div>
          <div>
            <span>最近一次攻击（超过阈值）</span>
            <strong>
              {snapshot.lastAttackAt
                ? formatDateTime(new Date(snapshot.lastAttackAt).toISOString())
                : "暂无记录"}
            </strong>
          </div>
          <div>
            <span>今日独立来源 IP</span>
            <strong>{snapshot.todayUniqueIps}</strong>
          </div>
        </div>
      </section>
    </>
  );
}
