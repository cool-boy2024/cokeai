# 安全防护与攻击处置

最后核对：2026-11-15。本文按仓库代码和当前生产拓扑写；生产配置可能变化，动手前先按第 8 节在本地复核，生产变更必须单独审批。

## 1. 一句话结论

**当前真正生效的只有应用层防护**：Next.js `src/proxy.ts` 的扫描路径拦截、按 IP/邮箱的登录注册限流、小店/API/Server Action 限流、商品页枚举检测、Redis 安全事件、`/admin/security` 管理员页，以及 n8n 每 5 分钟的安全告警。

**未启用**：边缘 Caddy 限流（Cloudflare Tunnel 仍指向 `app:3000`，不是 `edge:8080`）、CrowdSec、Anubis PoW、WAF。本机 2 vCPU / 3.5GB（约 1.5GB 可用）、40G 磁盘已用 85%（剩约 6GB），也不适合直接上重型 WAF。

**一键开关**：`/admin/security` 右上角的“启动应急防护”。它不是提前开启重防护，而是受攻击时才按的按钮：立即把应用层敏感入口限速减半（24 小时后自动恢复），并向告警通道发送边缘切换步骤。Cloudflare Tunnel 和容器重建仍由运维人工执行，按钮不会自动改生产网络。

**可视化**：`/admin/security` 顶部显示当前防护状态、5 分钟 / 15 分钟 / 1 小时窗口、今日 / 近 24 小时 / 近 7 天拦截数、按类型分布和 24 小时时间线。拦截计数、Top IP、路径和应急开关**只在运营后台显示**。

**客户提示**：临时收紧限流或应急防护生效期间，公开页和控制台顶部显示一条通用提示（“网站正在遭受攻击，部分访问可能短暂受限……”）；被限流的访客会看到 429 友好页面，按 `Retry-After` 自动刷新。提示不包含拦截计数、路径或防护开关状态。

**管理员登录豁免**：管理员成功登录后，其出口 IP 会记录到 Redis 7 天，期间不受应用层限流拦截；也可用 `SECURITY_ADMIN_IPS`（逗号分隔的精确 IP）预先授权固定 IP。登录接口自身的每 IP / 每邮箱尝试上限仍然生效。边缘（Cloudflare）限流若封了管理员 IP，仍需在 Cloudflare 控制台放行，应用层无法覆盖。

## 2. 防护分层

| 层 | 当前状态 | 能挡什么 | 不能挡什么 |
|---|---|---|---|
| 扫描拦截（应用层） | **已启用** | `/.env`、`/.git`、`wp-admin`、`phpMyAdmin`、路径穿越、`.php/.asp/.jsp/.cgi` 等常见探测，直接返回 404 并记录事件 | 伪装成正常路径的业务探测、SQL 注入/XSS 参数、分布式低频扫描、只请求首页和商品页的慢速爬取 |
| 登录/注册频控 | **已启用** | `/login`、`/register` 页面 60 次/分钟/IP；登录 20 次/10 分钟/IP、10 次/10 分钟/邮箱；注册 10 次/10 分钟/IP、5 次/10 分钟/邮箱；失败突增会记 `auth` 事件 | 代理池分布式撞库、已泄露密码的一次性成功登录、人工慢速尝试；不能替代密码强度、2FA 和泄露密码检测 |
| 下单频控 | **已启用** | 验证码接口 30 次/分钟/IP；`/api/shop/*` 120 次/分钟/IP；下单 10 次/10 分钟/用户；商品页 120 次/分钟/IP | 多账号分散下单、真人慢速库存探测、支付欺诈和拒付；不校验商品是否真的该被买 |
| 商品页枚举检测 | **已启用** | 按 IP 统计**不同**商品详情页数量（滚动 60 秒，重复访问同一商品不累加）：正常 20 个/分钟、收紧时 10 个/分钟，超过返回 429 并记 `rate_limit` 事件 | 换 IP 的分布式镜像、绕开详情页直接抓 API、模拟搜索引擎 UA 的爬虫；它是「别让人一次抄完整店」，不是身份验证 |
| Server Action 频控 | **已启用** | 所有带 `next-action` 的 POST 请求 60 次/分钟/IP，覆盖登录、注册、下单、后台操作等表单入口 | 正常用户连续操作被误伤（尤其共享出口 IP）、伪造普通 POST 绕过 `next-action` 的接口、业务层越权 |
| 通用 API 频控 | **已启用** | `/api/*` 240 次/分钟/IP（`/api/health`、`/api/internal/*` 除外） | 慢速请求、分布式请求；`/api/internal/*` 只靠 `INTERNAL_API_SECRET` 保护，不在这一层 |
| 边缘 Caddy 限流 | **未启用** | 计划在流量到达应用前按 IP 限速，省 CPU/内存，并能覆盖全部路径；`caddy-ratelimit` 由 Caddy 作者 mholt 维护 | 当前 Tunnel 不经过 edge，开了也不生效；不能挡 L3/L4 洪水；配置不当会打断 SSE 流式响应或误伤正常用户 |
| CrowdSec | **未部署（预案）** | 基于边缘日志和社区黑名单做行为封禁，适合切到 edge 后再加 | 没切边缘就没有日志来源；误封需要人工复核；会额外占内存 |
| Anubis PoW | **未启用** | 用工作量证明抬高自动化请求成本，对持续爬虫/洪水有一定效果 | 会挑战正常顾客、伤转化和 SEO；不能区分真人和模拟浏览器；不适合默认开在 `/shop`、`/v1` |
| WAF（SafeLine / BunkerWeb） | **不适配当前机器，未部署** | 规则型 WAF 能挡常见 SQLi/XSS/CVE 扫描和部分恶意载荷 | 本机内存和磁盘不够生产可用配置；会与应用争抢 2 vCPU / 3.5GB；规则误杀需要持续调优 |

### 2.1 响应头、CSP 上报与定时任务失败告警（2026-11-14）

- **CSP 已强制生效**：响应头从 `Content-Security-Policy-Report-Only` 改为
  `Content-Security-Policy`，策略在 `next.config.ts`。站内字体、图标、图片和视频都是
  自托管，脚本/样式保留 Next.js 需要的 `'unsafe-inline'`/`'unsafe-eval'`。
- **违规上报**：`report-uri /api/csp-report`。接口只接受最大 16 KB 的 JSON，日志只保留
  主机名和路径（去掉查询串），每分钟最多记录 20 条，避免坏页面刷爆日志。浏览器控制台
  出现 CSP 报错时，先看服务器日志里的 `[csp]` 行。
- **货源同步新鲜度**：`/api/internal/health` 会检查已启用的供货商；aibijia 超过 6 小时、
  zyanai 超过 24 小时没有成功同步，状态降为 `degraded` 并写入 `last_error`。现有的每
  15 分钟健康告警会推送，即使 n8n 吞掉了单次请求错误也能发现。
- **n8n 不再静默失败**：同步类工作流移除了 `neverError`，HTTP 非 2xx 会让执行失败；
  新增 `n8n/workflows/11-workflow-error-alert.json`。在 n8n 设置里把它选为
  **Error Workflow** 后，失败会推到 `ALERT_WEBHOOK_URL`。工作流改动需要重新导入 n8n，
  仅合并仓库不会自动更新生产 n8n。
- **例外**：`04-gateway-maintenance.json` 的六个任务相互独立，失败时继续执行后续任务；
  这些接口自身记录错误，关键数据链路由上面的新鲜度检查兜底。

### 2.2 商品页枚举检测（2026-11-15）

单个 IP 在原有的 120 次/分钟预算内，足以把 36 个商品详情页全部走一遍；固定的请求计数挡不住这种「慢速整店镜像」。现在在 `src/proxy.ts` 里按 IP 统计**不同**商品详情页：

- **口径**：Redis 有序集合 `sec:crawl:<ip>`，成员是商品 slug、分数是首次访问时间；进入前先删掉 60 秒前的成员，重复访问同一 slug 只更新时间，不增加数量。只有 `GET /shop/<slug>` 参与，`/shop` 列表页、条款/隐私/FAQ 等非商品 slug 不算。
- **阈值**：正常 20 个不同商品/60 秒；应急防护或临时收紧时为 10 个。超过直接返回 429（JSON 请求返回 JSON），并记一条 `rate_limit` 事件，detail 形如 `商品页枚举 21/20 个/60s`。
- **例外**：Googlebot、bingbot、百度、Yandex、Applebot、DuckDuckBot、搜狗、360 等搜索引擎 UA 不参与计数，避免自断收录。用 UA 伪装成搜索引擎可以绕过这一层，所以它是降低镜像速度，不是身份验证。
- **失败开放**：Redis 不可用时返回 0，不拦截；固定窗口限流仍然生效。正常顾客几十秒内看 10–20 个商品几乎不可能，误伤面很小。
- **代码**：`src/lib/shop-crawl-guard.ts`（纯函数，可测）+ `src/lib/rate-limit.ts` 的 `rollingDistinctCount`；测试 `npm run test:site-guards`。
- **robots/sitemap**：此前生产 `APP_URL` 未设置，`robots.txt` 和 `sitemap.xml` 会输出 `http://localhost:3000`。现在两个路由改为从请求的 `x-forwarded-host` / `host` 推导公开域名（`src/lib/public-url.ts`），生产应输出 `https://cokeai.cc.cd`。

### 2.3 Cloudflare 边缘层配置清单（控制台操作）

应用层之外，Cloudflare 是当前唯一可用的边缘防护，不需要动 Tunnel 配置。以下在 Cloudflare 控制台由域名管理员操作，仓库不自动修改：

1. **Security → Bots**：开启 Bot Fight Mode（免费版）或 Super Bot Fight Mode（Pro 及以上）。对「Definitely automated」设 Block，对「Verified bots」放行；**免费版 Bot Fight Mode 不支持按路径排除**，如影响 `/v1` 的 API 调用，先只开观察、确认无业务影响再升级策略。
2. **Security → WAF → Managed rules**：启用 Cloudflare Managed Ruleset（免费版提供托管规则集），先以默认动作运行，观察 24 小时的误杀记录再收紧。
3. **Security → WAF → Rate limiting rules**（免费版可建 1 条，Pro 更多）：
   - `http.request.uri.path matches "^/shop/"` → 60 次/分钟/IP → 动作 Block 或 Managed Challenge；
   - `http.request.uri.path eq "/login" or eq "/register"` → 10 次/分钟/IP → Managed Challenge；
   - `starts_with(http.request.uri.path, "/api/")` → 120 次/分钟/IP → Block。
   应用层阈值更细，边缘规则只做粗筛，宁可先松后紧。
4. **Under Attack Mode**：只在确认攻击且站点明显变慢时临时开启，会挑战所有访客，影响转化，处理完立即关闭。
5. **不要**在 Cloudflare 改 Tunnel、源站或 DNS 记录来「顺手加防护」；Tunnel 变更属于生产变更，按第 7 节单独审批。

> 判断标准：先看 `/admin/security` 的拦截类型和 Top IP，再决定是加边缘规则还是只封单个 IP。不要因为背景扫描就开 Under Attack Mode。

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

1. 顶部“当前防护状态”，以及告警冷却剩余时间。
2. 状态判定窗口：近 5 分钟 / 近 15 分钟 / 近 1 小时的实际拦截数。
3. “今日拦截 / 近 24 小时 / 近 7 天”，以及今日按类型的分布和 24 小时时间线。
4. “最近一次拦截 / 最近一次攻击（超过阈值）”。数据为空时页面会明确写“暂无拦截”。
5. “来源 IP”里的 Top IP 是否集中，还是大量分散 IP。
6. “最近事件”的路径、方法、UA、说明。
7. Redis 是否可用。页面提示 Redis 不可用时，统计数字不可信，先恢复 Redis；应用层限流会 fail-open。

状态判定规则（`src/lib/security.ts`）：

- **应急防护**：管理员已启动应急开关，优先级最高。
- **攻击中（会告警）**：满足任一条即可——扫描探测 5 分钟 ≥ 300 次或 15 分钟 ≥ 600 次；≥ 5 个来源 IP 在 5 分钟内被拦 ≥ 60 次（或 ≥ 10 个 IP / 15 分钟 ≥ 120 次）；登录/下单/客服/后台动作任一类型 15 分钟 ≥ 10 次；限流触发 15 分钟 ≥ 600 次。
- **扫描探测（不告警）**：单一来源只打被拦截路径，15 分钟 ≥ 30 次。公网 `.env` / `.git` 扫描属于背景噪声，页面显示中性状态，不发告警、不需要处置。
- **观察**：未达以上条件，但近 5 分钟 ≥ 5 次或近 1 小时 ≥ 10 次。
- **正常**：以上都不满足。

这样单一 IP 几十次配置探测不会再被当成攻击；只有分布式来源、业务接口滥用或真正的洪流才会叫醒人。

计数写入 Redis：`sec:stats:YYYY-MM-DD`（hash，`total` + 类型字段 + `h00`..`h23`，TTL 9 天）、`sec:stats:m:<分钟>`（逐分钟总数）、`sec:stats:t:<分钟>`（逐分钟按类型计数）、`sec:stats:i:<分钟>`（逐分钟来源 IP 的 HyperLogLog，用于统计不同来源数），后三者 TTL 2 小时；另有 `sec:stats:last`（最近拦截时间）和 `sec:stats:attack:last`（最近一次满足攻击判定的时间）。这些计数器在每次拦截时累加，不依赖 `sec:events` 的 60 秒去重；`sec:ips:YYYY-MM-DD` 与 `sec:ipcount:YYYY-MM-DD` 也按每次拦截累计，Top IP 次数与总拦截数一致。

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

告警渠道在后台 **`/admin/security` → “告警设置”**（`/admin/security/alerts`）配置，不需要改 `.env` 或重启。

- 支持：**企业微信机器人、飞书机器人、自定义 Webhook、邮箱 SMTP**。
- 企业微信/飞书：在群里添加自定义机器人，把 Webhook 地址粘进后台；二维码/密钥只加密存数据库，不回显。
- 邮箱：选 QQ / 163 / Gmail 或自定义 SMTP，填邮箱地址、SMTP 授权码、收件人。QQ/163 的“密码”是邮箱设置里生成的授权码，不是登录密码。
- 保存后点“保存并发送测试”，群里或邮箱收到测试消息即生效。
- 旧的 `ALERT_WEBHOOK_URL` 只作为后台未配置时的兜底，可保留或删除。
- n8n 工作流 `n8n/workflows/08-security-alert.json` 每 5 分钟调用内部摘要接口 `/api/internal/security/summary?mark=1`。`mark=1` 会占用告警冷却；**实际发送由应用在接口内完成**，n8n 不接触机器人地址或 SMTP 密码。
- 触发条件：只有满足上方“攻击中”判定才告警——扫描洪流（5 分钟 ≥ 300 / 15 分钟 ≥ 600 次）、分布式来源（5 分钟内 ≥ 5 个 IP 共 60 次，或 15 分钟内 ≥ 10 个 IP 共 120 次）、业务接口滥用（登录/下单/客服/后台动作任一类型 15 分钟 ≥ 10 次）、限流洪流（15 分钟 ≥ 600 次）。单一来源几十次 `.env` / `.git` 探测只会显示“扫描探测”，不发告警。
- 冷却：同一波攻击最多每 `SECURITY_ALERT_COOLDOWN_MINUTES`（默认 30 分钟）告警一次，Redis key 为 `sec:alert:cooldown`。
- 管理员页有两个手动入口：
  - “测试告警”：发一条明确标注测试的消息，30 秒内只能点一次。
  - “发送当前摘要”：把当前统计和最近事件摘要立即发送，用于确认通道和内容格式。
- `SECURITY_GUARD_ENABLED=false` 会同时关闭扫描拦截和所有限流，只用于本地排障；生产不要长期关闭。

验证步骤：

1. 打开 `/admin/security/alerts`，选择渠道并填好信息。
2. 点“保存并发送测试”，到群里或邮箱确认收到。
3. 回到 `/admin/security`，确认“告警通道”显示“已配置”和当前通道。
4. 点“发送当前摘要”，确认收到摘要且没有密钥、token、顾客隐私。
5. 在 n8n 里手动执行一次 `08-security-alert.json`，确认返回 `ok: true`；攻击时 `alert_sent` 为 true。
6. 确认工作流已启用；n8n 工作流默认不启用，导入后先手动跑一次再启用。

### 5.1 伙伴只需要做什么

1. 在飞书群或企业微信群添加自定义机器人，复制 Webhook 地址；或准备一个用于发信的邮箱和 SMTP 授权码。
2. 登录运营后台 → 安全 → 告警设置，选择渠道，粘贴/填写自己的信息。
3. 点“保存并发送测试”，确认自己的群或邮箱收到。
4. 不需要改代码、`.env`、n8n 或服务器；Webhook/授权码不要发到聊天或写进仓库。

## 6. 一键应急防护与临时收紧

### 6.1 启动应急防护（推荐用于真实攻击）

- **入口**：`/admin/security` 右上角“启动应急防护”。
- **立即生效**：应用层敏感入口（登录、注册、验证码、下单、API、Server Action）限速减半，不需要发版。
- **自动通知**：向后台配置的告警通道推送启动消息和边缘切换三步命令；通道未配置时只改限流、不阻塞操作。
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

- 扫描路径返回 404，且 `/admin/security` 的“最近事件”出现 `扫描探测`；今日拦截、5 分钟窗口和近 24 小时时间线同步增加。
- 验证码接口在约第 31 次开始返回 429，并出现 `触发限流` 事件；每次 429 都会计入统计，即使事件被 60 秒去重。
- 登录页在约第 61 次开始返回 429。
- 用管理员账号打开 `/admin/security`，能看到防护状态、今日 / 近 24 小时 / 近 7 天、按类型分布、时间线、Top IP、最近事件和防护状态表。
- 用 `curl` 或浏览器打开任意公开页，页脚不应出现“应用层防护已开启”或拦截计数；这些只在 `/admin/security` 显示。
- 在 `/admin/security/alerts` 保存渠道后点“测试告警”，接收端应收到测试消息；未配置时应提示失败，而不是静默成功。

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

## 10. 货源信息保护

外部人员和爬虫不应从公开站点拿到任何货源线索。这里说的货源信息包括：供应商名称 / 店铺名、供应商域名（`zyanai.cc`、`aibijia*`、`wzyp*`、`gshh.top` 等）、`source_title`、`source_store`、`supplier_cost_micros`、`shop_offers.url/raw`，以及“货源 / 供货商 / 上游供应商”这类措辞。

### 10.1 分层规则

| 层 | 规则 | 位置 |
|---|---|---|
| 公开商品读取 | 所有公开字段（名称、副标题、描述、你将收到、使用说明、购买须知、售后、输入字段、图片 alt）在每次读取时都过 `sanitizeSupplierCopy`；供应商域名和联系方式替换为“本站商品页 / 本店客服” | `src/lib/shop/catalog.ts`、`src/lib/shop/sanitize.ts` |
| 帮助中心 | 教程从供应商镜像而来，标题、摘要和正文在公开读取时再次清洗：外部 `href/src/poster` 被删除，域名和货源措辞被替换。后台仍显示原文 | `src/lib/help/store.ts`、`src/lib/help/sync.ts` |
| 后台与 API | `/admin/**` 页面由 `requireAdmin()` 保护（未登录 307 到登录页，普通用户 307 到 `/dashboard`）；admin API 也要独立校验，非管理员返回 404。Server Action 自己在第一行调用 `requireAdmin()`，不能只依赖布局 | `src/app/admin/layout.tsx`、`src/app/api/admin/**`、`src/app/actions/admin*.ts` |
| 内部任务 | `/api/internal/**` 只认 `x-internal-secret`（长度至少 24）；同步/导入/定价/帮助任务只能由 n8n 或管理员 Server Action 触发。失败响应只返回固定错误码，细节只写服务器日志 | `src/lib/internal.ts`、`src/app/api/internal/**`、`src/app/actions/*` |
| 公开 URL | 商品 slug 只用中性前缀（`p-<编号>` 与 `auto-<摘要>-<编号>`），不得出现供应商名或上游商品 id。2026-11-15 之前的 `zy-*` / `auto-<供应商>-*` 由 schema 迁移改写，旧链接经 301 跳到新 slug | `db/schema.sql`、`src/lib/shop/zyanai.ts`、`src/lib/shop/import.ts`、`src/lib/shop-crawl-guard.ts` |
| 抓取 | `/shop` 与商品页 120 次/分钟/IP，`/api/shop/*` 120 次/分钟/IP；超出 429 | `src/proxy.ts` |
| 索引 | `robots.txt` Disallow `/admin`、`/api`、`/dashboard`；`next.config.ts` 给这三类路径加 `X-Robots-Tag: noindex, nofollow, noarchive` 和 `Cache-Control: no-store`；sitemap 只列公开页面 | `src/app/robots.ts`、`src/app/sitemap.ts`、`next.config.ts` |

公开接口只返回 `shop_products` 的公开列，不查 `shop_offers` / `shop_product_sources` 的原始字段；读取这两个表的唯一公开用途是拿 `source_store` / `url` 给清洗器做最后一道替换，替换完成后不返回。

### 10.2 巡检命令

本地或生产（只读 GET，不写库、不打印密钥）：

```bash
# 先在本地启动：npm run dev
node scripts/audit-supplier-leaks.mjs http://127.0.0.1:3000

# 生产只跑公开页面；不要带任何凭据
node scripts/audit-supplier-leaks.mjs https://cokeai.cc.cd
```

脚本会抓 `/shop`、`/help`、sitemap 里的商品/教程页，检查供应商域名、`supplier_cost`、`source_title`、`source_store`、`shop_offers`、`货源`、`供货商`、`上游供应商`，并顺带确认 robots.txt 的 Disallow 和 sitemap 不含 `/admin`、`/api`、`/dashboard`。发现泄露退出码为 1。

请求默认间隔 600ms，低于小店 120 次/分钟的限流；遇到 429 会按 `Retry-After` 退避重试。重试后仍有页面读不到时，脚本输出 `INCOMPLETE` 并以 1 退出——只有全部发现的页面都被检查过才会报 `OK`。需要更慢时设 `AUDIT_DELAY_MS=1000`。

补充人工检查（可选）：

```bash
# 后台未登录应为 307/302，普通用户应为 307 到 /dashboard，不能是 200
curl -s -o /dev/null -w '%{http_code}\n' https://cokeai.cc.cd/admin
curl -s -o /dev/null -w '%{http_code}\n' https://cokeai.cc.cd/dashboard

# 响应头应带 noindex 和 no-store
curl -sI https://cokeai.cc.cd/admin | grep -iE 'x-robots-tag|cache-control'
curl -sI https://cokeai.cc.cd/api/health | grep -iE 'x-robots-tag|cache-control'

# 内部接口没有 secret 必须 401，且不能回显错误细节
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://cokeai.cc.cd/api/internal/shop/sync
```

### 10.3 发现泄露后的处置

1. **先止血**：如果是商品文案泄露，在后台把对应商品暂停（`status=paused`），不要直接删；如果是帮助教程泄露，在后台把文章下架（`visible=false`）。暂停/下架立即影响前台。
2. **定位出口**：用审计脚本输出的路径和匹配词判断来自商品文案、图片 alt、帮助中心还是 sitemap/API。不要只看页面文本，也要看 `href`、`src`、`alt`、JSON-LD 和 meta description。
3. **修数据而不是只改页面**：商品文案在 `shop_products`，帮助正文在 `help_articles`。通过后台编辑或重新同步修正，避免“页面隐藏但接口仍返回”。
4. **补规则**：如果是新的供应商域名/店铺名，加到 `src/lib/shop/sanitize.ts` 的替换逻辑（域名自动匹配；店铺名由 `loadProductIdentities` 从 `shop_product_sources` 取），并补一条审计脚本匹配。
5. **复跑**：本地 `node scripts/audit-supplier-leaks.mjs`，再跑 `npm run typecheck`。生产发布后对生产域名复跑一次。
6. **留记录**：在运维记录写清泄露路径、匹配内容（脱敏）、影响时间、止血动作、修复提交。不要把供应商域名、原始标题、拿货价贴到公开仓库或聊天。
7. **不要做的事**：不要为了“看起来干净”直接 `DELETE` 商品或教程（会丢订单关联）；不要关闭后台鉴权或把 `/api/internal/*` 暴露到公网；不要用前端 CSS 隐藏来替代服务端清洗。
