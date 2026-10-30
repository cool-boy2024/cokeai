# 安全防护与攻击处置

最后核对：2026-10-30。本文按仓库代码和当前生产拓扑写；生产配置可能变化，动手前先按第 8 节在本地复核，生产变更必须单独审批。

## 1. 一句话结论

**当前真正生效的只有应用层防护**：Next.js `src/proxy.ts` 的扫描路径拦截、按 IP/邮箱的登录注册限流、小店/API/Server Action 限流、Redis 安全事件、`/admin/security` 管理员页，以及 n8n 每 5 分钟的安全告警。

**未启用**：边缘 Caddy 限流（Cloudflare Tunnel 仍指向 `app:3000`，不是 `edge:8080`）、CrowdSec、Anubis PoW、WAF。本机 2 vCPU / 3.5GB（约 1.5GB 可用）、40G 磁盘已用 85%（剩约 6GB），也不适合直接上重型 WAF。

**一键开关**：`/admin/security` 右上角的“启动应急防护”。它不是提前开启重防护，而是受攻击时才按的按钮：立即把应用层敏感入口限速减半（24 小时后自动恢复），并向告警通道发送边缘切换步骤。Cloudflare Tunnel 和容器重建仍由运维人工执行，按钮不会自动改生产网络。

## 2. 防护分层

| 层 | 当前状态 | 能挡什么 | 不能挡什么 |
|---|---|---|---|
| 扫描拦截（应用层） | **已启用** | `/.env`、`/.git`、`wp-admin`、`phpMyAdmin`、路径穿越、`.php/.asp/.jsp/.cgi` 等常见探测，直接返回 404 并记录事件 | 伪装成正常路径的业务探测、SQL 注入/XSS 参数、分布式低频扫描、只请求首页和商品页的慢速爬取 |
| 登录/注册频控 | **已启用** | `/login`、`/register` 页面 60 次/分钟/IP；登录 20 次/10 分钟/IP、10 次/10 分钟/邮箱；注册 10 次/10 分钟/IP、5 次/10 分钟/邮箱；失败突增会记 `auth` 事件 | 代理池分布式撞库、已泄露密码的一次性成功登录、人工慢速尝试；不能替代密码强度、2FA 和泄露密码检测 |
| 下单频控 | **已启用** | 验证码接口 30 次/分钟/IP；`/api/shop/*` 120 次/分钟/IP；下单 10 次/10 分钟/用户；商品页 600 次/分钟/IP | 多账号分散下单、真人慢速库存探测、支付欺诈和拒付；不校验商品是否真的该被买 |
| Server Action 频控 | **已启用** | 所有带 `next-action` 的 POST 请求 60 次/分钟/IP，覆盖登录、注册、下单、后台操作等表单入口 | 正常用户连续操作被误伤（尤其共享出口 IP）、伪造普通 POST 绕过 `next-action` 的接口、业务层越权 |
| 通用 API 频控 | **已启用** | `/api/*` 240 次/分钟/IP（`/api/health`、`/api/internal/*` 除外） | 慢速请求、分布式请求；`/api/internal/*` 只靠 `INTERNAL_API_SECRET` 保护，不在这一层 |
| 边缘 Caddy 限流 | **未启用** | 计划在流量到达应用前按 IP 限速，省 CPU/内存，并能覆盖全部路径；`caddy-ratelimit` 由 Caddy 作者 mholt 维护 | 当前 Tunnel 不经过 edge，开了也不生效；不能挡 L3/L4 洪水；配置不当会打断 SSE 流式响应或误伤正常用户 |
| CrowdSec | **未部署（预案）** | 基于边缘日志和社区黑名单做行为封禁，适合切到 edge 后再加 | 没切边缘就没有日志来源；误封需要人工复核；会额外占内存 |
| Anubis PoW | **未启用** | 用工作量证明抬高自动化请求成本，对持续爬虫/洪水有一定效果 | 会挑战正常顾客、伤转化和 SEO；不能区分真人和模拟浏览器；不适合默认开在 `/shop`、`/v1` |
| WAF（SafeLine / BunkerWeb） | **不适配当前机器，未部署** | 规则型 WAF 能挡常见 SQLi/XSS/CVE 扫描和部分恶意载荷 | 本机内存和磁盘不够生产可用配置；会与应用争抢 2 vCPU / 3.5GB；规则误杀需要持续调优 |

## 3. 能不能上：逐项评估

### 3.1 为什么不装 SafeLine / BunkerWeb

- **SafeLine**：最低约 1 vCPU / 1GB 内存，另需约 10GB 磁盘。当前磁盘只剩约 6GB，镜像、规则库、日志一进来就会逼近写满；磁盘写满会同时拖垮 PostgreSQL、Redis 和应用。
- **BunkerWeb**：实际运行约 2GB 内存，All-in-One 部署官方建议 8GB。本机总内存 3.5GB、可用约 1.5GB，装上去会挤压 app、PostgreSQL 和 Sub2API，攻击时先 OOM 的可能是业务本身。
- 结论：**当前机器不装 WAF**。先靠应用层 + Cloudflare 自带能力，等迁移到更大机器或独立防护节点再评估。

### 3.2 为什么 Anubis 不默认开

Anubis 技术上能在本机跑，但它会对访问者发起 PoW 挑战：正常顾客要多等几秒，低端手机更明显；搜索引擎抓取也会受影响。小店靠转化吃饭，默认开启等于用订单换防护。**只在持续攻击、且 Cloudflare 手段仍压不住时临时启用**，并且不要默认套在 `/shop`、`/v1` 上。

### 3.3 为什么必须先切 Tunnel 再谈边缘限流

Caddy 边缘限流只有在流量经过 `edge:8080` 时才生效。现在 Cloudflare Tunnel 的 origin 仍是 `http://app:3000`，公网请求根本不经过 edge，启用 `ops/edge/limits.rate-limit.caddy` 不会改变任何行为。切 Tunnel 会同时改变 `/v1`、`/v1beta` 的路由（从 Next.js 旧网关切到 Sub2API），属于**生产变更**，必须单独审批、单独验证和准备回滚，不能顺手做。

### 3.4 参考项目与定位

星数为 GitHub 约数，仅用于判断成熟度，不代表必须安装。

| 项目 | 星数（约） | 用途 | 当前结论 |
|---|---|---|---|
| Caddy | 78.5k | 反向代理、边缘限流载体 | 已在架构中，限流待 Tunnel 切换后启用 |
| Anubis | 23.8k | PoW 反爬/反洪水 | 仅持续攻击时临时启用 |
| SafeLine | 23.1k | WAF | 机器资源不够，不装 |
| fail2ban | 18.9k | 读日志封 IP | 切边缘后可作轻量候选，当前未部署 |
| CrowdSec | 15.4k | 行为分析 + 社区黑名单 | 切边缘后再评估 |
| BunkerWeb | 11.1k | WAF | 内存不够，不装 |
| caddy-ratelimit | 509 | Caddy 限流模块 | 边缘预案采用，作者 mholt 维护 |

## 4. 攻击时管理员处置手册

顺序固定，**不要跳步**：

### 第一步：先确认告警

- 看告警渠道里的消息：是 n8n 的“疑似正在被攻击”，还是管理员手动“测试告警”。测试消息带 `test: true`，不要当成真实攻击。
- 记录消息里的时间、近 15 分钟拦截次数、阈值、主要类型、Top IP。
- 确认告警时间点与站点异常（变慢、5xx、订单异常）是否对得上。对不上时先别动手，可能只是扫描噪音。

### 第二步：看 `/admin/security`

用管理员账号打开 `/admin/security`，依次看：

1. 顶部是否显示“疑似攻击中”，以及告警冷却剩余时间。
2. “近 15 分钟拦截 / 今日拦截 / 今日独立 IP / 主要类型”。
3. “来源 IP”里的 Top IP 是否集中，还是大量分散 IP。
4. “最近事件”的路径、方法、UA、说明。
5. Redis 是否可用。页面提示 Redis 不可用时，统计数字不可信，先恢复 Redis；应用层限流会 fail-open。

### 第三步：判断类型

| 类型 | 典型信号 | 处置建议 |
|---|---|---|
| 扫描探测 | `probe` 事件集中在 `/.env`、`/.git`、`wp-admin`、`phpMyAdmin`、`.php` 等 | 多数是互联网背景噪音，保持 404 即可。单 IP 高频时在 Cloudflare 封该 IP；大量 IP 同时扫且影响性能时，再考虑 Under Attack Mode。不要因为几条扫描就全站验证码 |
| 撞库/暴力登录 | `auth` 事件、`/login` 或 `/register` 大量 429、Top IP 集中、失败次数超过 8 次/10 分钟/IP 或 60 次/10 分钟全局 | 立即开“临时收紧限流”；Cloudflare 封 Top IP；观察是否有成功登录；确认泄露后再要求相关用户改密，不要无差别强制全员改密 |
| 恶意下单/库存探测 | `shop` 事件、验证码接口 429、同一用户 10 分钟内多次下单、短时间大量未支付订单 | 开“临时收紧限流”；暂停被针对的商品或相关入口；保留订单号和证据；不要直接删订单。暂停商品用后台状态，不改数据库 |
| Server Action/API 被刷 | `server_action`、`rate_limit`、`support` 事件，`next-action` POST 或 `/api/support/chat` 激增，CPU/内存上升 | 开“临时收紧限流”；Cloudflare 封单 IP；确认被刷的是客服、登录还是后台接口；必要时暂停对应入口。不要用重启“解决”持续流量 |
| 流量洪水/5xx | 全站变慢、5xx 上升、`cloudflared` 或 app 日志刷屏、CPU/内存/磁盘告警 | 先在 Cloudflare 开 Under Attack Mode 或封明确来源；看是应用过载还是上游/数据库问题；检查磁盘是否接近写满。不要在没定位前重启或清 Redis |

### 第四步：采取动作

**可以立即做：**

- 在 `/admin/security` 点“启动应急防护”：应用层限速立即减半，并通知告警通道，24 小时后自动恢复。需要更短时用旁边的“临时收紧限流”（60 分钟）。
- 在 Cloudflare 封明确攻击的单个 IP，或临时开 Under Attack Mode。
- 在后台暂停被针对的商品/入口；保留数据和订单。
- 检查 app、cloudflared、n8n 日志和 `/api/health`、服务器 CPU/内存/磁盘。
- 点“测试告警”确认通道仍然可用。
- 记录处置时间线和证据（不要记录密钥、token、顾客隐私）。

**必须慎重：**

- **重启 app / 数据库 / Redis**：会中断 SSE 流式响应和正在进行的请求；攻击未定位时重启只是把问题延后。
- **清空 Redis**：会丢 session、限流计数、队列和缓存，可能让所有用户掉线；严禁 `FLUSHALL`。
- **直接改 Cloudflare Tunnel**：会影响全部公网流量和 `/v1` 路由，必须走第 7 节的审批和回滚流程。
- **封大段 IP/ASN**：会误伤真实顾客和上游回调，只封确认的单个 IP，大段封禁必须由所有者审批。
- **全站验证码/PoW**：伤转化和 SEO，只在持续攻击且其他手段无效时临时开，攻击停止后立即撤。

### 第五步：通知/记录

- 通知所有者和当班伙伴：时间、现象、判定类型、已做动作、当前影响。
- 在运维记录里写清：告警原文、Top IP（脱敏后）、涉及路径、处置动作、恢复时间。
- 不要把攻击细节、IP 列表、日志原文贴到公开仓库或公开聊天；不要在仓库里写真实顾客信息。

### 第六步：恢复

- 等近 15 分钟拦截数回落到阈值以下，再撤临时措施。
- “应急防护”点“关闭应急防护”立即恢复；“临时收紧限流”可等 60 分钟自动恢复，也可在页面手动关闭。都不需要清 Redis。
- Cloudflare 的临时 IP 封禁和 Under Attack Mode 确认无复发后撤掉，避免长期误伤。
- 恢复暂停的商品/入口，确认下单、登录、`/api/health` 正常。
- 观察至少一个告警周期（5 分钟 × 数个周期），确认 5xx、CPU、内存、磁盘回到正常。
- 事后补一份简短复盘：入口、原因、有效动作、无效动作、下一步是否要切边缘或加规则。

## 5. 告警通道配置与验证

- `ALERT_WEBHOOK_URL` **与健康告警共用**，不重复定义。支持接收 `{ "text": "...", "content": "..." }` 的 Webhook（Slack、Discord 或自建转发器）。
- n8n 工作流 `n8n/workflows/08-security-alert.json` 每 5 分钟调用内部摘要接口 `/api/internal/security/summary?mark=1`。`mark=1` 会占用告警冷却，保证一波攻击只推一条，不会每 5 分钟刷屏。
- 阈值：近 15 分钟拦截次数 ≥ `SECURITY_ATTACK_THRESHOLD`（默认 60）判定为疑似攻击。
- 冷却：同一波攻击最多每 `SECURITY_ALERT_COOLDOWN_MINUTES`（默认 30 分钟）告警一次，Redis key 为 `sec:alert:cooldown`。
- 管理员页有两个手动入口：
  - “测试告警”：发一条明确标注测试的消息，30 秒内只能点一次。
  - “把当前摘要发到告警通道”：把当前统计和最近事件摘要立即发送，用于确认通道和内容格式。
- `SECURITY_GUARD_ENABLED=false` 会同时关闭扫描拦截和所有限流，只用于本地排障；生产不要长期关闭。

验证步骤：

1. 在 `.env` 配好 `ALERT_WEBHOOK_URL`，确认 app 和 n8n 能访问该地址。
2. 打开 `/admin/security`，确认“告警通道”显示“已配置”。
3. 点“测试告警”，到接收端确认收到；页面应提示“测试告警已发送”。
4. 点“把当前摘要发到告警通道”，确认收到摘要且没有密钥、token、顾客隐私。
5. 在 n8n 里手动执行一次 `08-security-alert.json`，确认返回 `ok: true`，且 `alert_channel_configured: true`。
6. 确认工作流已启用；n8n 工作流默认不启用，导入后先手动跑一次再启用。

### 5.1 飞书 / 企业微信对接（交给伙伴完成）

应用当前发送通用 JSON `{ "text": "...", "content": "...", "source": "cokeai-security", ... }`，Slack、Discord 和自建转发器可直接接收；**飞书和企业微信的机器人不吃这个格式**，需要伙伴在 `src/lib/security.ts` 的 `postAlertWebhook` 里按所选渠道改 body：

- 飞书自定义机器人：`{"msg_type":"text","content":{"text":"..."}}`
- 企业微信机器人：`{"msgtype":"text","text":{"content":"..."}}`

对接清单：

1. 在飞书群或企业微信群添加自定义机器人，拿到 webhook URL。URL 含凭证，只放服务器 `.env`，不要进仓库、PR、聊天或截图。
2. 生产 `.env` 设置 `ALERT_WEBHOOK_URL=<机器人地址>`，重启 app 和 n8n。
3. 修改 `postAlertWebhook` 的 body 适配所选渠道；保留 `source`、`attack`、`emergency_defense` 等字段，方便以后换渠道。
4. 在 `/admin/security` 点“测试告警”，确认群内收到；再点“发送当前摘要”。
5. 手动执行一次 n8n 工作流 `08-security-alert.json`，确认攻击时能推送。
6. 在 `docs/HANDOFF.md` 的待办里把这一项勾掉，并写明使用的是飞书还是企业微信（不要写 URL）。

## 6. 一键应急防护与临时收紧

### 6.1 启动应急防护（推荐用于真实攻击）

- **入口**：`/admin/security` 右上角“启动应急防护”。
- **立即生效**：应用层敏感入口（登录、注册、验证码、下单、API、Server Action）限速减半，不需要发版。
- **自动通知**：向 `ALERT_WEBHOOK_URL` 推送启动消息和边缘切换三步命令；通道未配置时只改限流、不阻塞操作。
- **自动恢复**：24 小时后自动过期；也可以在页面点“关闭应急防护”立即恢复。Redis key 为 `sec:defense`，配合 `sec:strict`。
- **不会自动做的事**：不修改 Cloudflare Tunnel、不重建容器、不安装 Anubis/CrowdSec/WAF。边缘切换和重型防护仍按第 7 节由运维人工执行。
- **注意**：它是降压，不是封禁。攻击者换 IP 仍可继续；仍需配合 Cloudflare 封 IP、Under Attack Mode 或边缘限流。

### 6.2 临时收紧限流（短时窗口）

- **入口**：`/admin/security` 的“临时收紧限流”。
- **实现**：Redis key `sec:strict`，值 `1`，TTL 3600 秒；应用侧约 15 秒缓存。
- **影响与恢复**：同样减半，60 分钟后自动恢复；可手动关闭，不需要重启或清 Redis。

## 7. 边缘启用/回滚 runbook

**默认不启用。** 预案文件（由边缘改造单独维护）：`ops/edge/Dockerfile`、`ops/edge/limits.rate-limit.caddy`、`ops/edge/README.md`。在 Tunnel 切到 `edge:8080` 之前，启用限流片段没有任何效果。管理员点“启动应急防护”只会收紧应用层并通知运维，**不会自动执行本节**。

这是**生产变更**，必须单独审批、单独安排窗口，不能和业务发布混在一起。

### 7.1 启用前

1. 确认磁盘至少留出镜像和日志空间。当前 40G 已用 85%，构建自定义 Caddy 镜像前先看 `df -h`。
2. 备份当前 app 镜像和 Cloudflare Tunnel 配置记录（origin 当前是 `http://app:3000`）。
3. 确认 `/v1`、`/v1beta` 切到 Sub2API 后 Key 校验、计费、SSE 流式都兼容；这一步没验证完不要切 Tunnel。
4. 确认回滚人、回滚时间和观察窗口。

### 7.2 构建与本地/回源验证

1. 用 `ops/edge/Dockerfile` 构建带 `caddy-ratelimit` 的自定义 Caddy 镜像，固定 tag 或 digest，不要用浮动 `latest`。
2. 在 `.env` 设置 `CADDY_IMAGE` 指向该镜像，`EDGE_LIMITS_FILE` 指向实际限流片段；仓库默认是空片段，不改变行为。
3. 启动 edge 后，在服务器回源验证（不经过公网）：
   - `curl` 带 `Host: cokeai.cc.cd` 访问 `127.0.0.1:8080/healthz`，应为 200。
   - 访问首页、`/shop`、`/login`，确认状态码和页面正常。
   - 用测试 Key 访问 `/v1/models` 和一次流式请求，确认 SSE 没有被限流或缓冲打断。
   - 对敏感路径做小流量连发，确认超限返回 429，且正常单次请求不受影响。
4. 观察 edge 容器 CPU/内存和日志，确认没有配置错误、没有误伤静态资源。

### 7.3 切 Tunnel

1. 在 Cloudflare Zero Trust 把 `cokeai.cc.cd` 的 origin 从 `http://app:3000` 改为 `http://edge:8080`。
2. 立即验证：首页、`/shop`、`/login`、`/api/health`、`/v1/models`、一次 SSE 流式请求。
3. 观察 5xx、延迟、429 比例和 edge/app 资源至少一个观察窗口。

### 7.4 回滚

回滚动作只有一条：在 Cloudflare Zero Trust 把该主机名的 origin 从 `http://edge:8080` 改回 **`http://app:3000`**。edge 容器可以保留但不再接流量。改回后立即验证首页、`/shop`、`/login`、`/v1` 和 `/api/health`，确认公网恢复。不要在攻击处置中临时改 Tunnel；这属于第 7 节的计划变更。

## 8. 本地验证（不碰生产）

先启动本地依赖和应用（Redis 必须可用，否则限流会 fail-open）：

```bash
npm install
npm run dev
```

另开终端：

```bash
# 类型与构建
npm run typecheck
npm run build

# 扫描路径应被拦截为 404
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/.env
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/.git/config
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/wp-login.php

# 连续请求验证码接口，超过 30 次/分钟/IP 应出现 429
for i in $(seq 1 40); do
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/shop/captcha
done | sort | uniq -c

# 登录页连续请求，超过 60 次/分钟/IP 应出现 429
for i in $(seq 1 70); do
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
done | sort | uniq -c
```

预期：

- 扫描路径返回 404，且 `/admin/security` 的“最近事件”出现 `扫描探测`。
- 验证码接口在约第 31 次开始返回 429，并出现 `触发限流` 事件。
- 登录页在约第 61 次开始返回 429。
- 用管理员账号打开 `/admin/security`，能看到统计、Top IP、最近事件、防护状态表。
- 配置了 `ALERT_WEBHOOK_URL` 后点“测试告警”，接收端应收到测试消息；未配置时应提示失败，而不是静默成功。

注意：本地是开发环境，`next dev` 的编译会干扰连续请求的耗时；以状态码分布为准，不要用本地结果推断生产容量。

## 9. 红线

- 不读取、不打印、不提交 `.env`、真实密钥、token、顾客数据。
- 不运行 `docker compose config`；它会展开并打印生产环境变量。
- 不绕过 Cloudflare 或上游的限制，不做地区/指纹/出口伪装。
- 不伪造攻击数据、不手动往 Redis 写假事件来“演示”告警。
- 不自动封禁大段 IP/ASN；封禁必须人工确认，大段封禁由所有者审批。
- 不把 Anubis PoW 默认开在 `/shop`、`/v1`；只在持续攻击时临时启用并尽快撤掉。
- 不在攻击处置中清空 Redis、重启数据库或临时改 Tunnel；这些动作要么走预案，要么由所有者批准。
- 不把安全事件、IP 列表、日志原文贴到公开页面、公开仓库或公开聊天。
- 不把告警机器人 webhook URL（飞书/企业微信等）写进仓库、PR、文档或聊天。
