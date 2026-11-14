# 交接说明

最后核对：2026-11-14（`cc7a485` 发布后，服务器 + 仓库实测）。之后线上可能已经变化，动手前请按本文的“验证”一节重新核对。

这份文档写给接手的伙伴，以及帮伙伴读项目的 AI。目标是让你在不碰生产的前提下，先搞清楚现在是什么状态、哪些不能动、下一步该做什么。

## 先给伙伴的 5 条建议

1. **先只读，不要急着发布。** 仓库、后台、生产都处于可用状态；最危险的操作是未经核对就发商品、开支付、改订单逻辑。
2. **读到任何密钥、密码、助记词，都不要转述给任何人。** 服务器 `.env`、`.admin-reset.txt`、`.aiclient2api-credentials.txt` 都是 0600，里面有生产凭据；本仓库和聊天里也不应该有。
3. **商品文案可以抄货源，但不能暴露货源。** 店名、域名、外链、客服联系方式、“货源”字样都必须换成 CokeAI 自己的说法。
4. **支付、订单状态机、USDT 扫描、数据库结构，没有明确要求和回滚方案就不要改。** 现在只有 USDT 通道是代码就绪但关闭的状态。
5. **每个结论都要用命令验证。** 页面 200 不等于功能正常；后台按钮能点不等于任务成功。CI 的 `build` / `e2e` / `compose-smoke` 三项必须全绿。

## 项目一句话

CokeAI（https://cokeai.cc.cd）现在对外是一家**数字商品小店**：Muse 成品号、Codex 单次接码、ChatGPT/Claude 卡密与代充。原有的 AI API 中转业务**暂时不在公开页面销售**，但后端、`/v1` 网关和后台模型管理仍在，随时可以用一个开关恢复展示。

## 当前线上状态（2026-11-14）

| 项 | 状态 |
|---|---|
| 生产应用代码 | `cc7a485`（2026-11-14 发布，含 #81/#82/#83：CI 构建发布、货源巡检节奏与 `INCOMPLETE` 语义、防护状态只在后台显示、安全入口移到侧栏首屏） |
| 生产目录 | `/home/deploy/cokeai`，SSH：`ssh -i ~/.ssh/cokeai_deploy deploy@47.83.178.22` |
| 容器 | app、postgres、redis、backup、sub2api、sub2api-postgres、sub2api-redis、edge、cloudflared、n8n、aiclient2api；app 启动后 healthy |
| 自动备份 | `backup` 容器每天导出 `cokeai`/`n8n` 到 `/home/deploy/cokeai/backups`（目录 0700、文件 0600，保留 14 天） |
| 公开 API 销售 | 关闭（`src/lib/public-features.ts` 的 `PUBLIC_API_SALES_ENABLED=false`） |
| `/pricing`、`/docs` | 307 跳 `/shop`；导航、页脚、sitemap、metadata 已是小店口径 |
| 首页 | 保留 HeroOrbit 品牌环绕、TaglineReveal 逐词点亮、ShopRing 环形商品舞台；文案是“订阅、账号、接码”。**这是运营明确要求保留的门面，不要重排** |
| USDT 支付 | 代码就绪，生产 `USDT_ENABLED=false`，顾客看不到二维码/倒计时；到账异常可在后台 `/admin/shop/deposits` 查看，已确认但订单关闭的存款会标为 `manual` 并告警 |
| 易支付备用通道 | `SHOP_EASYPAY_ENABLED=false`，未配置服务商凭据 |
| AI 上架 | 后台货源页可单条/批量“AI 上架”，任务入队后后台执行，完成后自动打开审核页；n8n 每 2 分钟兜底。`SHOP_IMPORT_AI_*` 未配置，当前走规则提取 |
| 商品 | active 14 个、archived 1 个（旧 Muse 商品）、草稿约 50 个 |
| 订单 | 只有 2 笔过期测试单，无真实成交 |
| 回滚镜像 | CI 的 Deploy 工作流每次部署前自动把当前 `cokeai-app:local` 打成 `cokeai-app:pre-<时间戳>`，只保留最近两个；本次发布前的生产快照已加语义标签 `cokeai-app:pre-hide-security-status`（与时间戳标签并存，磁盘紧张时可能被清理）。更早的 `pre-audit-fixes`、`pre-hero-copy`、`pre-publicpause`、`pre-muse-tiers` 视磁盘情况在 |

active 的 14 个商品：

- 订阅：`chatgpt-plus-1m-code` ¥169（现货）、`chatgpt-pro-5x-1m` ¥849（现货）、`claude-pro-1m-code` ¥199（缺货）、`claude-max-5x-1m` ¥1099（库存紧张）、`gemini-pro-1y` ¥49（暂停，无货源）、`grok-super-1m` ¥269（缺货）
- Muse 六档：`muse-10b-1h` ¥15、`muse-10b-7d` ¥20、`muse-10b-30d` ¥25、`muse-310b-1h` ¥25、`muse-310b-7d` ¥60、`muse-310b-30d` ¥88
- 接码：`codex-sms-single` ¥5（现货）
- 测试：`usdt-e2e-test` ¥7（**应归档，不要在真实顾客面前保留**）

## 待办（按优先级）

1. **审核 50 个 AI 草稿**：`/admin/shop/products` 里状态为 `draft` 的商品都是草稿，不公开。审核时至少确认：商品名、售价、拿货成本/毛利、发货时效、质保、注意事项、退款口径。发布前必须勾选合规确认；这一步只能由运营在后台点，AI 不代点。
2. **归档 `usdt-e2e-test`**：它是支付联调用的测试商品，现在仍 active/in_stock，会出现在公开小店。确认没有未完成测试后设为 archived/paused。
3. **清理测试订单/存款**：`CK20261027ACEC06A1`（个人支付宝 ¥0.01，已过期）和 `CK202610288F42480C`（USDT ¥169，已过期）都是测试数据；USDT 存款表有 1 笔过期记录。删除前先确认没有对账价值，倾向“标注/归档”而不是直接删。
4. **复核 Muse/Codex 毛利**：六档 Muse 售价是按货源公开零售价照抄的，Codex ¥5 对拿货 ¥2.10；如果实际拿货价不同，毛利要重算。
5. **USDT 上线前**：确认运营钱包能直接看到派生地址、助记词已离线备份，再开 `USDT_ENABLED=true`；然后走一笔真实小额订单，验证“下单 → 转账 → 扫描确认 → 采购 → 交付”。
6. **恢复 API 销售（何时由运营决定）**：只改 `PUBLIC_API_SALES_ENABLED=true`，页面、导航、sitemap、metadata 会一起恢复；模型目录本身一直没删。模型要能真正调用，还需要 Sub2API 侧有可用上游（当前只有 DeepSeek 真实 Key）。
7. **伙伴权限**：GitHub 已向 `wjlwww` 发 write 邀请，若还未接受，先接受再开分支；CODEOWNERS 已包含两人。

## 绝对不能碰

- 不读取、不打印、不提交：`.env`、`.admin-reset.txt`、`.aiclient2api-credentials.txt`、SSH 私钥、Cloudflare Tunnel token、Sub2API 管理员密码、USDT 助记词/私钥/xprv、供货商账号、易支付 PID/KEY。
- **不要再运行 `docker compose config`**：它会打印生产环境变量，曾经把密钥刷到终端里。
- 不替管理员接受 Sub2API 合规确认；Sub2API 后台只走 SSH 隧道 `127.0.0.1:18080`。
- 不绕过 OpenAI 等上游的地区限制、不做指纹/出口伪装。
- 不绕过供货商的反爬/滑块验证，不自动替供货商下单。
- 未经明确要求，不改支付回调、订单状态机、USDT 扫描、数据库结构、定价公式；不擅自开关支付渠道。
- 不在公开页面写虚假评价、客户 Logo、增长数据或无法兑现的承诺。
- 不改生产服务器或 Cloudflare Tunnel 配置；不提交 `.next/`、截图、`.local-data/`、`.taste-skill/`。

## 供货商信息脱敏（重点）

规则：**商品规则可以原文抄，身份不能露。** 具体做法有三层，改文案时不要绕过：

1. 生成时：`src/lib/shop/import.ts` 先清洗货源原文再交给模型/规则提取。
2. 读写时：`src/lib/shop/sanitize.ts` 替换店名、货源域名、外部链接、微信/QQ/Telegram/邮箱、“货源/供货商/上游供应商”。公开目录 `src/lib/shop/catalog.ts` 在读取时再兜底一次；后台看到的是原始数据。
3. 存量：`npx tsx scripts/shop-scrub-copy.ts` 默认 dry-run，`--apply` 事务写入。改完抽查任意商品页，确认没有外部域名和“货源”字样。

允许保留的官方站点：openai.com、chatgpt.com、claude.ai、anthropic.com、google.com、gemini.google.com、grok.com、x.ai、apple.com、microsoft.com、muse.ai，以及 cokeai.cc.cd 自己。其他域名一律替换。

## 发布流程（当前实际做法）

`main` 只接受 PR，CI 必须过 `build`、`e2e`、`compose-smoke`，用 Squash and merge，然后本地 `git switch main && git pull --ff-only`。

**合并 PR 不等于发布。** 生产发布由仓库管理员手动触发 GitHub Actions 的 `Deploy` 工作流（`workflow_dispatch`，工作流里按 actor 限制；协作伙伴可以合并代码，但不能触发部署）：

```bash
gh workflow run deploy.yml --ref main   # 等价于 npm run deploy:prod
gh run list --workflow deploy.yml --limit 1
gh run watch <run-id>
```

工作流全部在 CI 里完成：

1. 在 GitHub runner 上 `docker build`，`docker save` 成 tar.gz；
2. rsync 代码和镜像 tar 到服务器；
3. 服务器只 `docker load` 新镜像，把旧 `cokeai-app:local` 存成 `cokeai-app:pre-<时间戳>`，再 `docker compose up -d --no-build app`；
4. 容器内 `/api/health` 健康检查，失败自动回滚到 `pre-*`；成功后再从外部验一次 `https://cokeai.cc.cd/api/health`；
5. 只保留最近两个 `cokeai-app:pre-*` 镜像。

**不要在服务器上运行 `docker compose build` / `up -d --build`。** 这台机器只有 2 vCPU / 3.6 GB 内存，Next.js 构建会把 Docker 内置 DNS 和 cloudflared 一起拖死：2026-11-14 10:45–10:57 CST 就是这样出现约 10 分钟的 Cloudflare 502（`lookup app on 127.0.0.11:53: i/o timeout`），同期 SSH 在 banner exchange 阶段超时。构建放到 runner 后，服务器只做 `docker load` + 重启，几秒完成。

回滚（保留）：

```bash
ssh -i ~/.ssh/cokeai_deploy deploy@47.83.178.22 \
  'cd /home/deploy/cokeai && docker tag cokeai-app:pre-<时间戳> cokeai-app:local && docker compose up -d --no-build app'
```

可用快照：`docker images cokeai-app`。自动保留最近两个 `pre-*`；语义标签（如 `pre-hide-security-status`）和时间戳标签一样受保留策略影响，更早的若还在也可 `docker tag` 恢复，被清理后只能重发旧代码。

可用性监控：`.github/workflows/uptime.yml` 每小时从 GitHub 外部探测 `/api/health` 与 `/shop`，连续失败会开一个带 `uptime-watch` 标记的 issue（GitHub 会发邮件），恢复后自动评论并关闭。它和站点不在同一台机器，主机整体失联时仍然有效。小时级偏慢；若需要分钟级告警，在 Cloudflare 面板给 `cokeai.cc.cd` 配 Health Check + 通知渠道。

数据库备份容器会每天向 `/home/deploy/cokeai/backups/`（0700 目录、0600 文件）写入 `cokeai-*.sql.gz` 与 `n8n-*.sql.gz`，默认保留 14 天；`docker compose logs backup` 可查看执行结果。旧路径 `/home/deploy/backups/` 的历史备份仍在，可手动迁移。涉及商品/订单的发布，先做 `shop_products`、`shop_product_sources` 的 SQL 备份。

## 验证清单

```bash
npm run typecheck
npm run build
npm run test:shop        # 改了小店逻辑才需要
```

生产回源（服务器上执行，绕开本地网络问题）：

```bash
curl -s -o /dev/null -w "home %{http_code}\n" -H "Host: cokeai.cc.cd" http://127.0.0.1:3000/
curl -s -o /dev/null -w "shop %{http_code}\n" -H "Host: cokeai.cc.cd" http://127.0.0.1:3000/shop
curl -s -o /dev/null -w "health %{http_code}\n" http://127.0.0.1:3000/api/health
```

- `/pricing`、`/docs` 应为 307（API 销售关闭期间）。
- 首页不应出现“按量计费 / 创建 Key / 模型与价格 / 充值包 / 接入教程”。
- 商品页不应出现外部域名、`货源`、供货商店名。
- 货源巡检：`node scripts/audit-supplier-leaks.mjs https://cokeai.cc.cd`（只读）。默认每页 600ms，遇 429 按 `Retry-After` 退避；有页面读不到时输出 `INCOMPLETE` 并以 1 退出，只有全部发现的页面都检查过才报 `OK`。2026-11-14 对生产跑通：66 个公开页面全部检查，无泄露。细则见 `docs/SECURITY.md` 第 10.2 节。
- 界面改动要在 1440 和 390 两个宽度检查无横向滚动；小店保持两步购买（先“购买”，再出现支付方式）。
- 本机直连 Cloudflare 经常很慢甚至超时，是本地到边缘的网络问题，不代表生产故障；以服务器回源为准。

## 已知坑与边界

- **Cloudflare Tunnel 源站仍指向 `app:3000`，不是 `edge:8080`。** 所以公网 `/v1` 目前走的是 Next.js 旧网关，Sub2API 不在公网链路上。切换需要改 Cloudflare 面板并评估 Key/计费兼容性，未做，不要顺手改。
- **中国大陆访问慢**：瓶颈在大陆 → Cloudflare 边缘（偶发 `colo=GRU`）。应用侧只有几十毫秒。国内 CDN 需备案，不可用。
- **Sub2API 账号 `id=1` 曾被改成可调度**：它接的是 AIClient2API，而 Codex OAuth 因 OpenAI 地区限制从未接通，所以必须保持 `schedulable=false`。发现被改回 true，要恢复并刷新调度缓存（写 `scheduler_outbox` 的 `account_changed`）。
- **OpenAI OAuth 走不通**：生产出口是香港，`auth.openai.com` 直接 403 `unsupported_country_region_territory`。不做地区绕过；合规路径只有官方 API Key 或书面授权的 OAuth。
- **AI 上架是异步的**：点按钮后立即跳转，后台 `after()` 抓取并生成；`ImportJobWatcher` 轮询状态并在草稿就绪后自动打开商品页。queued 超过 30 分钟会被回收，失败会带原因跳回。不要把它当成同步按钮来测。
- **n8n 工作流**：`shop-offer-autolist` 每 2 分钟调 `/api/internal/shop/import-jobs/run`（secret 保护）。改 webhook 时保持 `responseMode: onReceived`。
- **wzyp / zyanai 是 Vue SPA**：纯 HTTP 抓不到商品页，需要浏览器抓取（`scripts/shop-draft-from-pages.ts`）或人工复制。不要绕过它们的滑块验证。
- **Next.js 16** 与训练数据不同，写代码前先读 `node_modules/next/dist/docs/`。
- **本地开发**：Postgres/Redis 端口只在 `.local-data/compose.local.yml` 里临时暴露；本地是空库，不要导入生产数据。曾经占用 3011 端口跑 dev。

## 安全（2026-11-14）

- 响应头已补 `Strict-Transport-Security`、`X-Content-Type-Options`、`X-Frame-Options`、
  `Referrer-Policy`、`Permissions-Policy`；CSP 已从 Report-Only 切为强制
  `Content-Security-Policy`，违规上报到 `/api/csp-report`（只记录脱敏后的主机+路径，
  每分钟最多 20 条）。站内跳转只允许同源路径；帮助中心同步正文经过 HTML 清洗。
- **定时任务失败不再静默**：同步类 n8n 工作流不再用 `neverError` 吞掉 HTTP 错误；
  新增 `n8n/workflows/11-workflow-error-alert.json`，在 n8n 设置里选为 Error Workflow
  后，任何工作流失败都会推到 `ALERT_WEBHOOK_URL`。`/api/internal/health` 同时检查
  货源同步新鲜度：aibijia 超过 6 小时、zyanai 超过 24 小时没有成功同步即降级，
  由现有 15 分钟健康告警推送。生产 n8n 需重新导入工作流并手动设置 Error Workflow。
- 当前真正生效的只有应用层防护：`src/proxy.ts` 的扫描拦截，登录/注册/小店/API/Server Action 按 IP 限流；事件写 Redis，管理员页 `/admin/security`；n8n 每 5 分钟拉取摘要，应用把告警发到后台配置的通道。
- **防护状态与拦截计数只对管理员展示**：完整计数、告警和应急开关都在 `/admin/security`；公开页面（包括页脚）不再出现“应用层防护已开启/今日拦截”等状态。后台侧栏的“安全”入口已移到“概览”之后，首屏可见。
- **Cloudflare Tunnel 仍指向 `app:3000`**，边缘 Caddy 限流不在公网链路上；CrowdSec、Anubis、WAF 均未启用。`ops/edge/` 的限流预案默认关闭，启用前必须单独审批并验证回滚。
- 告警阈值默认 60 次 / 15 分钟（`SECURITY_ATTACK_THRESHOLD`），冷却 30 分钟（`SECURITY_ALERT_COOLDOWN_MINUTES`）。管理员页可“测试告警”“把当前摘要发到告警通道”，也可临时收紧限流（`sec:strict`，默认 60 分钟自动恢复）。
- **一键应急防护**在 `/admin/security` 右上角：点击后应用层限速立即减半（`sec:defense` + `sec:strict`，24 小时自动恢复），并向告警通道发送边缘切换三步命令；不会自动改 Tunnel 或重建容器。关闭同理，恢复限流并提示把 Tunnel 改回 `app:3000`。
- **伙伴只需要在后台填信息**：安全 → 告警设置（`/admin/security/alerts`）选择企业微信机器人、飞书机器人、自定义 Webhook 或邮箱 SMTP，填自己的 Webhook 或邮箱授权码，点“保存并发送测试”即可。地址和密码加密存数据库，不回显；不需要改 `.env`、代码或 n8n。步骤见 `docs/SECURITY.md` 第 5.1 节。
- 处置顺序固定：先确认告警 → 看 `/admin/security` → 判断类型 → 采取动作 → 通知/记录 → 恢复。完整手册、各类型建议与红线见 `docs/SECURITY.md`。

## 给伙伴 AI 的工作方式建议

- 开始任务前按顺序读：`CLAUDE.md` → 本文 → `docs/SHOP_PROGRESS.md` → 相关源码。本文是快照，冲突时以代码和线上实测为准。
- 先只读排查，再提方案；涉及生产、支付、数据库的改动先说明影响范围和回滚方式，等伙伴明确同意再动手。
- 不要合并自己开的 PR（除非伙伴明确授权）；不要 force push `main`。
- 不要声称“已修复/已上线”而没有命令输出为证；失败就如实贴错误。
- 不要把聊天里出现的任何凭据写进文件、提交或日志。
- 改文案时保持“可抄规则、不露货源”；改 UI 时先确认是不是运营要求保留的门面（Hero、Tagline、ShopRing）。
- 对不确定的业务口径（质保、退款、发货时效），以商品数据库字段和运营确认为准，不要自行编造。

## 相关文档

- `docs/PRESENTATION.md`：16 页项目全景；`docs/presentation/` 里有同名 PPTX 和 HTML 演示版
- `docs/SECURITY.md`：安全防护分层、攻击处置、告警配置、边缘限流启用与回滚
- `CLAUDE.md`：技术栈、命令、禁区、验证要求
- `CONTRIBUTING.md`：两人协作、分支、PR、审核规则
- `docs/SUB2API_OPERATIONS.md`：生产部署、合规、备份、回滚
- `docs/SHOP_PROGRESS.md`：小店进度与历史决策
- `docs/GO_LIVE_CHECKLIST.md`：上线检查
