# Sub2API 生产运维手册

本文覆盖 CokeAI 与 Sub2API 同机部署时的架构、首次上线、合规确认、模型定价、
Cloudflare Tunnel 切换、SSE 验证、备份恢复、升级与回滚。

> 合规提示：Sub2API 首次进入管理端时要求管理员完成一次**部署与运营合规承诺**。
> 这是法律层面的确认，必须由真人管理员阅读文档后手动完成。本项目所有脚本都
> **不会**代替管理员自动确认；检测到未确认时会打印操作指引并以非零状态退出。

---

## 1. 拓扑

```text
Cloudflare DNS / Tunnel (cokeai.cc.cd)
        │
        ▼
cloudflared (compose service, no host port)
        │  http://edge:8080
        ▼
edge (Caddy, 127.0.0.1:8080 on host for debugging only)
        ├── /v1/*, /v1beta/* ─────────────► sub2api:8080
        │                                      ├── sub2api-postgres (internal)
        │                                      └── sub2api-redis    (internal)
        │
        └── 其它路径 ─────────────────────► app:3000 (Next.js)
                                               ├── postgres:5432
                                               └── redis:6379

n8n.cokeai.cc.cd ──► n8n:5678 (保持现状，建议 Zero Trust Access)
```

关键点：

- 公网只经过 Cloudflare Tunnel，宿主机不开放 3000/8080/18080 到公网。
- `edge` 只把 `/v1/*` 和 `/v1beta/*` 交给 Sub2API；控制台、后台、支付回调、
  `/api/health` 仍然进入 Next.js。
- Sub2API 管理端不经过公网 edge，只能通过 SSH 隧道访问
  `http://127.0.0.1:18080/`。
- `SUB2API_INTERNAL_URL=http://127.0.0.1:18080` 供宿主机脚本使用；
  app 容器内由 compose 覆盖为 `SUB2API_CONTAINER_URL=http://sub2api:8080`。

相关文件：

| 文件 | 用途 |
|---|---|
| `ops/edge/Caddyfile` | 路径路由、SSE 不压缩、256MB 请求体、真实客户端 IP |
| `ops/sub2api/compose.yaml` | Sub2API + 独立 PostgreSQL/Redis，仅绑定 `127.0.0.1:18080` |
| `docker-compose.yml` | 新增 `edge`，cloudflared 指向 `edge:8080` |
| `scripts/verify-sub2api-config.mjs` | 网关配置核验（登录、分组、定价、账号倍率、合规门禁） |
| `scripts/smoke-production.mjs` | 生产冒烟（健康、401 JSON、模型、流式、撤 Key、后台不可达） |
| `scripts/rollback-prepare.mjs` | 回滚前把 Sub2API 余额/有效期写入本地用户表 |
| `ops/generate-env.sh` | 生成 CokeAI 与 Sub2API 的随机密钥 |

---

## 2. 首次部署

### 2.1 服务器与配置

```bash
sudo bash ops/bootstrap-vps.sh
cd /opt/cokeai
bash ops/generate-env.sh
chmod 600 .env
```

`generate-env.sh` 会生成并写入：

- CokeAI：`POSTGRES_PASSWORD`、`APP_ENCRYPTION_KEY`、`INTERNAL_API_SECRET`、
  `N8N_ENCRYPTION_KEY`、`ADMIN_PASSWORD`
- Sub2API：`SUB2API_ADMIN_PASSWORD`、`SUB2API_DB_PASSWORD`、
  `SUB2API_REDIS_PASSWORD`、`SUB2API_JWT_SECRET`、
  `SUB2API_TOTP_ENCRYPTION_KEY`

两个管理员密码只显示一次，请立刻保存。

编辑 `.env`，至少确认：

```dotenv
APP_URL=https://cokeai.cc.cd
CLOUDFLARE_TUNNEL_TOKEN=...
SUB2API_IMAGE=weishaw/sub2api@sha256:<digest>   # 生产必须固定版本或 digest
SUB2API_ADMIN_EMAIL=admin@your-domain.tld
SUB2API_GROUP_ID=1                              # 首次建组后回填真实 ID
SUB2API_INTERNAL_URL=http://127.0.0.1:18080
SUB2API_CONTAINER_URL=http://sub2api:8080
GATEWAY_UPSTREAM=sub2api:8080
APP_UPSTREAM=app:3000
COKEAI_NETWORK=cokeai_net
```

不要把 `SUB2API_IMAGE` 留在 `:latest`。升级时只改这个变量，保留上一版的值用于回滚。

### 2.2 启动顺序

```bash
# 建议在仓库根目录设置一个 shell 变量，避免每次输两条 -f
COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"

# 构建并启动（tunnel profile 会带上 cloudflared）
$COMPOSE --profile tunnel up -d --build

$COMPOSE ps
$COMPOSE logs -f sub2api
$COMPOSE logs -f edge
```

首次启动时：

1. `postgres` 自动执行 CokeAI 迁移与种子。
2. `sub2api-postgres` 初始化数据库。
3. `sub2api` 执行 `AUTO_SETUP` 迁移并创建首个管理员。
4. `edge` 等 app 健康后启动。

本地确认 edge（不经过 Cloudflare）：

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/health
```

### 2.3 切换 Cloudflare Tunnel origin

在 **Cloudflare Zero Trust → Networks → Tunnels → 对应 tunnel → Public Hostname**：

| 域名 | Service（origin） |
|---|---|
| `cokeai.cc.cd` | `http://edge:8080`（原来是 `http://app:3000`） |
| `n8n.cokeai.cc.cd`（可选） | `http://n8n:5678`（保持不变） |

注意：

- `edge:8080` 是 **容器内端口**，不是宿主机的 `127.0.0.1:8080`。
- 不要给 `127.0.0.1:18080` 添加任何 Public Hostname。
- SSL/TLS 建议 **Full (strict)**。
- Cloudflare WAF 不要对以下路径启用浏览器挑战/Managed Challenge：
  `/v1/*`、`/v1beta/*`、`/api/health`、`/api/webhooks/stripe`。
- 如果切换后发现 `/v1/*` 502，先确认 `$COMPOSE ps` 中 `sub2api` 健康，
  再确认 edge 与 sub2api 在同一个 `cokeai_net` 网络。

切换后用公网域名验证：

```bash
curl -fsS https://cokeai.cc.cd/api/health
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://cokeai.cc.cd/v1/models
# 期望 401 且 content-type 为 application/json
```

---

## 3. 一次性管理员合规确认（必须人工完成）

Sub2API 在管理员完成合规承诺前，会把除合规接口外的所有 `/api/v1/admin/*`
请求拦截为 HTTP 423，错误码 `ADMIN_COMPLIANCE_ACK_REQUIRED`。

- 当前版本：`v2026.06.10`（版本升级后需要重新确认）。
- 文档：
  - `docs/legal/admin-compliance.zh.md`
  - https://github.com/Wei-Shaw/sub2api/blob/main/docs/legal/admin-compliance.zh.md
  - https://github.com/Wei-Shaw/sub2api/blob/main/docs/legal/admin-compliance.en.md
- 确认接口：`POST /api/v1/admin/compliance/accept`
- 请求体：`{"phrase":"<界面给出的确认语句>","language":"zh"}`

推荐操作：

```bash
# 在本地电脑建立 SSH 隧道
ssh -L 18080:127.0.0.1:18080 <user>@<vps>
# 浏览器打开
# http://127.0.0.1:18080/
```

登录 Sub2API 管理端 → 阅读合规文档 → 在弹窗中手动确认。

如果出于审计需要必须用 curl，也必须由**真人**阅读后执行：

```bash
# 密码不要写进 shell history；用 read -s
read -rsp "Sub2API admin password: " S2P_PASS; echo

TOKEN=$(curl -fsS http://127.0.0.1:18080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SUB2API_ADMIN_EMAIL\",\"password\":\"$S2P_PASS\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.access_token')
unset S2P_PASS

# 先查看状态和确认语句
curl -fsS http://127.0.0.1:18080/api/v1/admin/compliance \
  -H "Authorization: Bearer $TOKEN"

# 只有在阅读并同意后，才由管理员本人执行：
curl -fsS -X POST http://127.0.0.1:18080/api/v1/admin/compliance/accept \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phrase":"我已阅读、理解并同意 Sub2API 部署与运营合规承诺","language":"zh"}'

unset TOKEN
```

`scripts/verify-sub2api-config.mjs` 和 `scripts/rollback-prepare.mjs` 检测到未确认时，
会打印文档地址、版本、接口和确认语句，然后退出；不会自动提交。

如果自动化管理员账号启用了 TOTP 2FA，登录会返回 `requires_2fa`，两个脚本会停止。
请使用一个专门的无 2FA 运维管理员，或改为人工执行检查。

---

## 4. 上游账号与分组

### 4.1 创建分组

在 Sub2API 管理端创建 CokeAI 使用的分组，例如 `cokeai`：

- `rate_multiplier` = `1.0`
- 状态 = `active`
- 平台与上游账号一致（如 `openai` / `anthropic` / `gemini`）
- 把分组 ID 回填到 `.env` 的 `SUB2API_GROUP_ID`

分组倍率必须是 1.0。CokeAI 的定价引擎会按人民币零售价写入分组
`model_pricing`；如果分组或账号再乘一次倍率，会导致重复加价。

### 4.2 添加账号

在 Sub2API 管理端添加上游账号：

1. 选择平台与账号类型（正式 API Key 或经书面授权的 OAuth）。
2. 填入 Base URL、API Key / 凭证、代理（如需）。
3. 将账号分配到 CokeAI 分组。
4. 账号 `rate_multiplier` 必须是 `1.0`；**所有**分组内账号都要一致。
5. 设置并发、优先级，先启用一个账号做小流量验证。
6. 用真实请求检查：首字节时间、错误率、限流、余额扣减。

不要使用个人订阅账号、共享账号、代充或规避地区限制的账号作为上游。
只接入具有商业使用/转售授权、且允许面向目标地区提供服务的 API。

### 4.3 核验

```bash
node scripts/verify-sub2api-config.mjs
```

脚本会检查：

- `/health`
- 管理员登录与合规状态
- 分组存在、`active`、`rate_multiplier=1.0`
- 分组 `model_pricing` 非空且价格合法
- 模型白名单（若启用）中的每个模型都有定价
- 分组内所有账号 `rate_multiplier=1.0`
- 模型广场开关（关闭时告警）
- `SUB2API_INTERNAL_URL` 是回环/私网地址
- `APP_URL/api/v1/admin/*` 不能从公网返回 200/401/403

---

## 5. 模型定价推送

CokeAI 的定价引擎会：

1. 汇总上游成本价；
2. 按 `PRICING_MARKUP_BPS`、`PRICING_MIN_MARGIN_BPS`、
   `PRICING_MAX_INCREASE_BPS` 计算人民币零售价；
3. `PUT /api/v1/admin/groups/$SUB2API_GROUP_ID`，写入：
   - `rate_multiplier: 1`
   - `model_pricing[]`
   - `model_allowlist { enabled, models }`
   - 分组 `status`（有可用模型时为 active）

价格在 Sub2API 中存储为 **人民币 credit 单位**；Sub2API 管理界面可能把它标为
USD，这是上游 UI 的标签问题，不要据此再乘汇率。

手动执行：

```bash
node scripts/pricing-sync.mjs --force
# 或
curl -fsS -X POST http://127.0.0.1:3000/api/internal/pricing/sync \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"force":true}'
```

### 5.1 n8n 定时任务

仓库内置 5 个工作流：

| 文件 | 频率 | 作用 |
|---|---|---|
| `01-daily-reconciliation.json` | 每天 | 收入、网关用量、加额度队列、模型价格对账 |
| `02-health-alert.json` | 每 15 分钟 | 数据库/Redis/Sub2API/分组倍率/模型数告警 |
| `03-user-attention.json` | 每天 | 低余额、超时订单、失败队列提醒 |
| `04-gateway-maintenance.json` | 每 5 分钟 | 重试加额度、Key 同步、余额镜像、USDT 扫描 |
| `05-pricing-sync.json` | 每小时 | 汇率 + 成本 → 人民币售价，推送 Sub2API |

首次导入后 n8n 会保持工作流为 **Inactive**。必须执行一次：

```bash
bash ops/activate-n8n-workflows.sh
```

如果当前 n8n 版本不支持 `--all`，在 n8n 界面逐个打开并激活。n8n 容器需要
`INTERNAL_API_SECRET` 与 `ALERT_WEBHOOK_URL` 环境变量；未设置告警 Webhook 时，
告警工作流会安全退出，不会发消息。

推送后重新运行：

```bash
node scripts/verify-sub2api-config.mjs
```

如果 `model_pricing` 为空，Sub2API 会拒绝无法定价的请求（或按配置告警放行），
用户侧可能表现为 4xx/5xx。先看 `pricing_sync_runs` 表和脚本输出。

### 5.2 易支付（支付宝）

在 `.env` 填写商户参数，重建 app：

```dotenv
EASYPAY_ENABLED=true
EASYPAY_GATEWAY=https://your-easypay-gateway.example.com
EASYPAY_PID=your-pid
EASYPAY_KEY=your-md5-key
EASYPAY_SIGN_TYPE=MD5
# sorted（默认）或 concat，以通道文档为准
EASYPAY_SIGN_MODE=sorted
EASYPAY_ALIPAY_TYPE=alipay
```

- 异步通知地址固定为 `https://cokeai.cc.cd/api/webhooks/easypay`，需要在易支付
  后台配置/白名单放行。
- 回调验签、金额（按分比较）、订单状态、事件去重都在应用内完成。
- 测试：创建一笔 ¥9.90 订单并真实支付，确认：
  - `orders.status = paid`
  - `gateway_balance_ops.status = applied`
  - `payment_events.status = processed`
  - 用户 Sub2API 余额增加 ¥10
- 易支付是第三方通道，存在冻结/跑路/结算周期风险；保留人工到账兜底。
- 不处理 KYC/发票不代表没有合规风险，上线前确认收款主体与税务。

### 5.3 USDT TRC20

1. 在**离线机器**生成 HD 钱包：

```bash
node scripts/generate-trc20-wallet.mjs
```

   助记词只离线保存，绝不提交、上传或放进 `.env`。服务器只填 account xpub：

```dotenv
USDT_ENABLED=true
USDT_TRC20_XPUB=xpub...
USDT_TRC20_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
USDT_TRONGRID_API_KEY=...
USDT_CONFIRMATIONS=19
USDT_QUOTE_MINUTES=10
USDT_CNY_RATE=7.25
USDT_CNY_RATE_BUFFER_BPS=100
USDT_UNDERPAY_TOLERANCE_BPS=50
USDT_LATE_GRACE_HOURS=24
```

2. 每个订单派生独立地址 `m/44'/195'/0'/0/{index}`；服务器只有 xpub，无法花费。
3. 扫描由 n8n `04-gateway-maintenance` 每 5 分钟调用
   `POST /api/internal/payments/usdt/scan`；也可手动触发：

```bash
curl -fsS -X POST http://127.0.0.1:3000/api/internal/payments/usdt/scan \
  -H "x-internal-secret: $INTERNAL_API_SECRET"
```

4. 规则：
   - 只认 TRC20 USDT 合约；
   - 少付在绝对/比例容差内按订单金额入账，超过容差保持 `partial`；
   - 多付按订单金额入账，多余部分人工处理；
   - 支付窗口默认 10 分钟，超时且无链上到账的订单自动取消；截止前已确认的转账仍会入账，截止后到账转人工核对；
   - 19 个区块确认后入账；
   - 订单已取消/已支付时不自动入账，标记 `manual`。
5. 资金留在派生地址，MVP 不做自动归集；归集需要单独准备 TRX gas，并离线签署。
6. 用一笔小额真实 USDT 支付验证 `usdt_deposits` 与订单状态；不要用主钱包直接测。

---

## 6. CORS 与可信代理

### 6.1 CORS

生产流量的浏览器来源是 `https://cokeai.cc.cd`，edge 与 Sub2API 同源，
因此默认不需要跨域：

```yaml
cors:
  allowed_origins: []
  allow_credentials: true
```

只有当 Sub2API 管理端或支付页被单独暴露到另一个域名时，才在挂载的
`config.yaml` 中填写**精确 origin**：

```yaml
cors:
  allowed_origins:
    - "https://admin.example.com"
  allow_credentials: true
```

不要使用 `"*"` 搭配 `allow_credentials: true`。

### 6.2 真实客户端 IP

Caddy 配置：

- `trusted_proxies static private_ranges`
- `trusted_proxies_strict`
- `client_ip_headers CF-Connecting-IP X-Forwarded-For`
- 向上游写 `X-Real-IP`、`X-Forwarded-For` 为 `{client_ip}`
- `X-Forwarded-Proto` 保留 Cloudflare 传入的值
- `Host` 保留原始域名

Sub2API 配置：

```dotenv
SERVER_TRUSTED_PROXIES=172.16.0.0/12,10.0.0.0/8,192.168.0.0/16
SECURITY_FORWARDED_CLIENT_IP_HEADERS=CF-Connecting-IP
```

说明：

- `security.trust_forwarded_ip_for_api_key_acl=true`（上游默认）时，Sub2API 会优先
  读取 `CF-Connecting-IP`。该模式只有在源站不可直连时才安全；本方案中
  18080 只绑定 `127.0.0.1`，源站由 UFW/Cloudflare Tunnel 隔离。
- 如果改为 `false`，则 `server.trusted_proxies` 是唯一依据。必须只填写
  直接连接 Sub2API 的私网网段，绝不能填写 `0.0.0.0/0`。
- 不要把 `CF-Connecting-IP` 直接透传给公网可达的 Sub2API；否则客户端可以伪造。
- 如需挂载 `ops/sub2api/config.yaml`，保持只读挂载，并在变更后重启 Sub2API。

---

## 7. SSE 检查

流式请求必须满足：

- `Content-Type: text/event-stream`
- 没有 `Content-Encoding: gzip/br/zstd`
- 首个 `data:` 帧及时到达，不被整体缓冲
- edge 不设置响应写超时
- `text/event-stream` 不在 Caddy `encode` 的类型列表中

手工检查：

```bash
curl -sS -N https://cokeai.cc.cd/v1/chat/completions \
  -H "Authorization: Bearer $SMOKE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"<model-id>","stream":true,"max_tokens":64,"messages":[{"role":"user","content":"Count from 1 to 3."}]}'
```

观察：

- 终端应逐帧输出 `data: {...}`，而不是等很久后一次性出现。
- 不应出现 `Content-Encoding: gzip`。
- 最后通常有 `data: [DONE]`（不同上游可能略有差异）。

脚本检查（同时验证非流式、撤销 Key、后台不可达）：

```bash
node scripts/smoke-production.mjs
```

若出现首字节延迟或整段缓冲，依次排查：

1. `ops/edge/Caddyfile` 的 `encode` 是否误加了 `text/*`。
2. 是否设置了 `flush_interval -1`（本项目刻意不设置）。
3. 是否在 Caddy 或 Cloudflare 增加了响应超时/缓冲。
4. 上游本身是否支持流式。

---

## 8. 备份与恢复

### 8.1 备份

```bash
# CokeAI 主库
docker compose exec -T postgres pg_dump -U cokeai -d cokeai -Fc \
  > cokeai-$(date +%F).dump

# n8n（如使用）
docker compose exec -T postgres pg_dump -U cokeai -d n8n -Fc \
  > n8n-$(date +%F).dump

# Sub2API 独立数据库（默认方案 A）
COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"
$COMPOSE exec -T sub2api-postgres pg_dump -U sub2api -d sub2api -Fc \
  > sub2api-$(date +%F).dump

# Sub2API Redis 是缓存/调度数据，可选备份
$COMPOSE exec -T sub2api-redis redis-cli --no-auth-warning BGSAVE
```

同时加密备份：

- `.env`（含全部密钥）
- `ops/`、`docker-compose.yml`、`ops/edge/Caddyfile`
- 如挂载了 `ops/sub2api/config.yaml`，一并备份
- Cloudflare Tunnel 的配置记录（token 已保存在 `.env`）

不要把 `.env`、数据库 dump、Sub2API 管理端截图提交到 Git 或公开云盘。

### 8.2 恢复

1. 停止入口与写入方：

```bash
COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"
$COMPOSE stop edge cloudflared app sub2api
```

2. 恢复 CokeAI 主库：

```bash
$COMPOSE exec -T postgres pg_restore -U cokeai -d cokeai --clean --if-exists \
  < cokeai-YYYY-MM-DD.dump
```

3. 恢复 Sub2API 库：

```bash
$COMPOSE exec -T sub2api-postgres pg_restore -U sub2api -d sub2api --clean --if-exists \
  < sub2api-YYYY-MM-DD.dump
```

4. 启动并核验：

```bash
$COMPOSE --profile tunnel up -d
node scripts/verify-sub2api-config.mjs
node scripts/smoke-production.mjs
```

注意：

- `pg_dump`/`pg_restore` 的主版本要与容器一致（默认 CokeAI `postgres:16`，
  Sub2API 独立库 `postgres:18`）。
- 如果使用共享 PostgreSQL（方案 B），把 Sub2API dump 恢复到同一个实例即可。
- 恢复后 Redis 缓存会变冷；限流/调度计数会重建，属正常现象。
- 定期做恢复演练；只备份不恢复等于没有备份。

---

## 9. 升级

```bash
# 1. 备份（见上一节）
# 2. 记录当前镜像
grep '^SUB2API_IMAGE=' .env

# 3. 修改 .env 中的 SUB2API_IMAGE 到新 tag/digest
# 4. 拉取并重启单个服务
COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"
$COMPOSE pull sub2api
$COMPOSE up -d sub2api

# 5. 等待健康
$COMPOSE ps
$COMPOSE logs --tail=200 sub2api
curl -fsS http://127.0.0.1:18080/health

# 6. 配置与端到端验证
node scripts/verify-sub2api-config.mjs
node scripts/smoke-production.mjs
```

升级注意：

- `AUTO_SETUP=true` 会在启动时执行数据库迁移。升级前必须备份。
- 新版本可能要求重新做管理员合规确认（版本号变化时）。
- 如果新版本迁移不可逆，回滚镜像不一定够，必须恢复数据库备份。
- 不要对 `:latest` 做无人值守升级。
- Caddy/Postgres/Redis 镜像同理，固定 tag 后再升级。

---

## 10. 回滚到旧网关

适用场景：Sub2API 故障、上游不可用、定价异常，需要让 CokeAI 自带的
`app:3000` 网关重新接管 `/v1/*`。

### 10.1 先准备本地余额与有效期

旧网关的准入条件是：

```sql
status = 'active'
AND plan_expires_at > now()
AND balance_micros >= 预留金额
```

`rollback-prepare.mjs` 会为每个 `gateway_identities.state='active'` 的用户：

- 读取 Sub2API 余额；
- 写入 `users.balance_micros = round(balance * 1e6)`；
- 把 `plan_expires_at` 至少延长到 `now() + 90 days`（不会缩短更晚的到期时间）。

先 dry-run：

```bash
COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"

# 生产数据库未暴露到宿主机，推荐在 app 容器内执行
$COMPOSE exec -T app node scripts/rollback-prepare.mjs --dry-run
```

确认输出无误后执行：

```bash
$COMPOSE exec -T app node scripts/rollback-prepare.mjs
```

如果必须在宿主机执行，需要 `DATABASE_URL` 指向一个宿主机可达的数据库地址
（临时 SSH 隧道或只在维护窗口映射端口），并确保 `node_modules/pg` 可用。

### 10.2 切换 edge

临时把网关上游指回 Next.js：

```bash
GATEWAY_UPSTREAM=app:3000 \
  docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml up -d edge
```

或编辑 `.env`：

```dotenv
GATEWAY_UPSTREAM=app:3000
```

然后 `... up -d edge`。Caddy 会立即把 `/v1/*` 和 `/v1beta/*` 转发到 `app:3000`。

### 10.3 验证旧网关

```bash
curl -fsS https://cokeai.cc.cd/api/health
node scripts/smoke-production.mjs
```

注意：`smoke-production.mjs` 的撤销 Key 检查依赖
`SMOKE_REVOKED_API_KEY`；未设置时只检查未知 Key，会给出告警。

### 10.4 回滚后的数据一致性

- Sub2API 停止写入前，可能已有请求扣费；本地余额是回滚时刻的快照。
- 回滚期间不要同时让 Sub2API 和旧网关服务同一批用户，否则会双重计费。
- 建议先冻结充值/订单发放，完成对账后再恢复。
- **不要删除** Sub2API 的 PostgreSQL/Redis 卷；修复后还要用它恢复数据。
- 修复后重新切回：

```bash
GATEWAY_UPSTREAM=sub2api:8080 \
  docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml up -d edge
```

切回前重新运行 `verify-sub2api-config.mjs`，并再次同步余额/定价。

---

## 11. 安全清单

- [ ] `SUB2API_PORT` 只绑定 `127.0.0.1`，公网无法直连 18080。
- [ ] `edge` 只绑定 `127.0.0.1:8080`；公网入口只有 Cloudflare Tunnel。
- [ ] UFW 只放行 SSH（和必要的运维端口）。
- [ ] `.env` 权限 `600`，不在 Git、日志、截图中出现。
- [ ] Sub2API 镜像固定 tag/digest，并记录来源。
- [ ] 管理员合规确认由真人完成；保留审计记录。
- [ ] 管理端只通过 SSH 隧道访问，建议额外加 Zero Trust Access。
- [ ] Cloudflare WAF 对 `/v1/*`、`/v1beta/*` 不做浏览器挑战。
- [ ] `SERVER_TRUSTED_PROXIES` 只含私网网段；禁止 `0.0.0.0/0`。
- [ ] CORS origin 精确匹配，不使用 `*` + credentials。
- [ ] 数据库/Redis 不映射宿主机端口；Sub2API DB/Redis 在 internal 网络。
- [ ] 备份加密保存，定期做恢复演练。
- [ ] 监控 401/429/5xx、余额不足、上游错误率、磁盘与内存。
- [ ] 只接入有书面授权的正式 API 上游，不使用个人订阅账号。
- [ ] 脚本不打印密码、JWT、API Key；日志中也不应出现。

---

## 12. 资源建议（2GB vs 4GB）

同机运行 Next.js、PostgreSQL、Redis、n8n、Sub2API、独立 PostgreSQL/Redis、
Caddy，内存压力主要来自两个 PostgreSQL 和 Next.js。

### 2GB 主机（最低可用）

- 2 vCPU / 2GB RAM + **2GB swap**（`bootstrap-vps.sh` 在小于 2GB 时自动创建）。
- 优先使用 **方案 B：共享 CokeAI PostgreSQL/Redis**，可省下约 300–500MB。
- 或保留独立 DB，但给容器加 `mem_limit`：
  - `app`：512m
  - `postgres`：384–512m
  - `sub2api`：512m–1g
  - `sub2api-postgres`：384–512m
  - `sub2api-redis`：128–192m
  - `redis`：128m
  - `n8n`：256m
  - `edge`：64m
- 关闭 n8n 或把它移到另一台机器，能显著降低 OOM 风险。
- 监控：`free -h`、`docker stats`、`dmesg | grep -i oom`。
- 不保证高并发 SSE；适合小规模验证与早期用户。

### 4GB 主机（推荐生产）

- 2 vCPU / 4GB RAM，独立 Sub2API PostgreSQL/Redis（默认方案 A）。
- 为 app 预留 512MB–1GB，Sub2API 1–1.5GB，两个 PG 各 512MB，其余留给缓存与突发。
- 更适合长连接 SSE、定价同步、n8n 定时任务与备份同时运行。
- 建议 40GB+ SSD；镜像、日志、数据库 dump 都会占空间。
- 仍然建议 swap（1–2GB）作为 OOM 缓冲，但不要依赖 swap 承载常态负载。

### 共享数据库（方案 B）操作

1. 在 `ops/sub2api/compose.yaml` 中删除 `sub2api-postgres`、`sub2api-redis`
   服务，以及 `sub2api` 的对应 `depends_on`。
2. `.env`：

```dotenv
SUB2API_DB_HOST=postgres
SUB2API_DB_PORT=5432
SUB2API_DB_USER=sub2api
SUB2API_DB_NAME=sub2api
SUB2API_REDIS_HOST=redis
SUB2API_REDIS_PASSWORD=
```

3. 在 CokeAI Postgres 中创建独立角色/数据库（不要在应用库里复用 `cokeai` 角色）：

```bash
docker compose exec -T postgres psql -U cokeai -d cokeai <<'SQL'
CREATE ROLE sub2api LOGIN PASSWORD 'replace-with-strong-password';
CREATE DATABASE sub2api OWNER sub2api;
SQL
```

4. 如果共享 Redis，Sub2API 的 key 前缀与 CokeAI 不同，但仍建议使用独立
   `REDIS_DB` 或独立实例；共享实例时注意 `maxmemory` 淘汰策略可能误删限流键。
5. 共享数据库会共享故障域与备份窗口，恢复时两边一起受影响；2GB 省内存的代价
   是隔离性下降。生产优先 4GB + 独立实例。

---

## 13. 常见问题

### `/v1/models` 返回 HTML 401

说明请求没有进入 Sub2API，而是被 Next.js 或 Cloudflare 处理。检查：

```bash
curl -sS -D - -o /dev/null https://cokeai.cc.cd/v1/models
```

看 `content-type` 与 `server` 头，并确认 Cloudflare Public Hostname 指向
`http://edge:8080`、Caddyfile 的 `/v1/*` 规则已加载。

### `/v1/*` 返回 502

```bash
$COMPOSE ps
$COMPOSE logs --tail=100 edge sub2api
```

常见原因：sub2api 未健康、网络未合并、`GATEWAY_UPSTREAM` 写成了
`127.0.0.1:18080`（容器内应使用 `sub2api:8080`）。

### 管理端一直 423

合规未确认。按第 3 节由真人完成，不要用脚本自动提交。

### 流式很慢或一次性输出

按第 7 节排查压缩/缓冲/超时。

### 用户余额与 Sub2API 不一致

Sub2API 是运行时的计费源；CokeAI 本地余额通过充值 Outbox/同步任务更新。
回滚前必须运行 `rollback-prepare.mjs` 做快照。不要手工只改一边。

---

## 14. AIClient2API OpenAI 上游（Codex OAuth）

`ops/aiclient2api/compose.yaml` 在 CokeAI 私有网络中运行
[AIClient2API](https://github.com/justlovemaki/AIClient-2-API)，把 OpenAI Codex
OAuth 账号转成 OpenAI 兼容接口，再由 Sub2API 作为 `openai` 平台上游调用。

```text
Sub2API :8080
  └── http://aiclient2api:3000/v1  (OpenAI-compatible)
        └── openai-codex-oauth -> auth.openai.com / ChatGPT Codex
```

### 部署

```bash
COMPOSE="docker compose -f docker-compose.yml \
  -f ops/sub2api/compose.yaml \
  -f ops/aiclient2api/compose.yaml"
$COMPOSE up -d aiclient2api
$COMPOSE ps aiclient2api
curl -sS http://127.0.0.1:13000/api/health
```

镜像按 linux/amd64 digest 固定；升级前先看上游 release，再改 digest 并重建。
运行数据在 `./aiclient2api-data/`，已 gitignore；不要提交其中的
`config.json`、`pwd`、`token-store.json` 或 `configs/codex/*.json`。

本机通过 SSH 隧道访问控制台和 OAuth 回调：

```bash
ssh -i ~/.ssh/cokeai_deploy -N \
  -L 127.0.0.1:13000:127.0.0.1:13000 \
  -L 127.0.0.1:1455:127.0.0.1:1455 \
  deploy@47.83.178.22
```

打开 `http://127.0.0.1:13000`，在 Provider Pools / Configuration 里选择
Codex 并完成 OpenAI 登录。OAuth 回调固定为
`http://localhost:1455/auth/callback`，所以隧道必须保持。

### 接入 Sub2API

在 Sub2API 后台新增账号：

- 平台：`OpenAI`
- 类型：`API Key`
- Base URL：`http://aiclient2api:3000/v1`
- API Key：`aiclient2api-data/configs/config.json` 里的 `REQUIRED_API_KEY`
- 分组：`cokeai`
- 模型映射：把 Sub2API 的模型名映射到 AIClient2API 支持的 Codex 模型，
  例如 `gpt-5.4 -> gpt-5.5`、`gpt-5.6 -> gpt-5.6-sol`

先保持账号 `schedulable=false`，在 Sub2API 账号页点“测试”确认能通过
`aiclient2api:3000` 返回正常响应，再开启调度。测试或实际请求报
`No healthy provider found in pool for openai-codex-oauth` 表示 OAuth 凭据
尚未完成或已过期，不是网络问题。

### 边界

- 这台生产 VPS 在香港。OpenAI 对不支持地区的 OAuth 会返回
  `unsupported_country_region_territory`；不要改代理、指纹或出口来绕过。
  2026-10-29 实测：本机网络与生产出口访问 Codex 授权页均返回 HTTP 403，
  HTML 含 `unsupported_country_region_territory`。因此当前环境无法完成
  Codex OAuth。需要官方 API Key，或把服务部署在受支持地区并由账号持有人
  完成授权。
- 把订阅额度转成公开 API 出售通常违反 OpenAI 条款，也可能触发账号风控。
  只建议自用/内部验证；不要直接挂到 CokeAI 对外付费渠道。
- 不要在日志、文档、聊天或截图里输出 `REQUIRED_API_KEY`、控制台密码、
  Codex `access_token` / `refresh_token`。
