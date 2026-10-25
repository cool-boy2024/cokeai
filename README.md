# CokeAI

面向开发者与小团队的 AI API 接入、预算控制与用量账单平台。
域名：`cokeai.cc.cd`。

> 本项目只接入具有商业使用/转售授权、且允许面向目标地区提供服务的 API 上游。
> 不实现个人订阅账号拆分、共享、代充或地区限制规避。上线前仍需完成运营主体、
> 支付、税务、隐私与上游合同审核。

## 已实现

- OpenAI 兼容网关：`POST /v1/chat/completions`、`GET /v1/models`
- SSE 流式输出、工具调用等常用参数转发
- API Key 只存哈希，撤销即时生效
- 每次请求预授权、按实际 Token 结算、失败退款
- 请求级硬预算、每分钟速率、用户并发上限
- 人民币余额、套餐、有效期、订单和退款观察期
- Stripe Checkout（可选）与人工到账确认
- 推荐码、单层奖励、7 天观察期、佣金锁定与人工结算
- 用户控制台：概览、Key、用量账单、套餐、推荐、密码
- 运营后台：订单、用户、余额调账审计、模型/上游、套餐
- 上游 API Key 使用 AES-256-GCM 加密存储
- 默认不保存提示词和模型输出正文
- Docker Compose：App + PostgreSQL + Redis + n8n
- Cloudflare Tunnel 入口，不暴露源站端口
- n8n 三个可导入工作流
- GitHub Actions：类型检查、Next 构建、Docker 构建、可选 SSH 部署

## 架构

```text
Cloudflare DNS / Tunnel
        │
        ├── cokeai.cc.cd ──── Next.js app :3000
        │                         ├── PostgreSQL :5432
        │                         └── Redis :6379
        │
        └── n8n.cokeai.cc.cd ─ n8n :5678（默认不公开，仅本机端口）
```

- 支付真实性由应用后端校验，不交给 n8n。
- 余额、订单、佣金都在 PostgreSQL 事务中处理。
- Redis 只承担速率限制与并发计数；Redis 不可用时自动降级，不影响硬预算。
- n8n 通过 `x-internal-secret` 调用内部报表接口，不接触用户密码或 API Key。

## 快速开始（服务器）

建议 Ubuntu 24.04、2 vCPU / 2GB RAM 起。`2GB` 建议启用 swap，`bootstrap-vps.sh` 会自动处理。

### 1. 初始化服务器

```bash
sudo bash ops/bootstrap-vps.sh
```

脚本会安装 Docker、配置日志轮转、开启 UFW（默认只放行 SSH）并创建 `/opt/cokeai`。
使用非 22 端口时：

```bash
SSH_PORT=2222 sudo bash ops/bootstrap-vps.sh
```

### 2. 准备配置

把仓库放到服务器后：

```bash
cd /opt/cokeai
bash ops/generate-env.sh
```

脚本会生成随机数据库密码、加密密钥、内部 API secret、n8n 加密密钥和管理员密码，
并创建权限 `600` 的 `.env`。**管理员密码只显示一次**。

然后编辑 `.env`：

- `ADMIN_EMAIL`：管理员邮箱（建议你自己的真实邮箱）。
- `APP_URL`：默认 `https://cokeai.cc.cd`。
- `CLOUDFLARE_TUNNEL_TOKEN`：Cloudflare Tunnel token。
- `ALERT_WEBHOOK_URL`：n8n 告警出口（可选）。
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`：启用在线支付时填写。
- `SUPPORT_EMAIL`：客服邮箱。

### 3. Cloudflare Tunnel

域名已经使用 Cloudflare 名称服务器。进入 **Cloudflare Zero Trust → Networks → Tunnels**：

1. 创建一个 `cloudflared` tunnel。
2. 添加 Public Hostname：
   - `cokeai.cc.cd` → `http://app:3000`
   - 可选：`n8n.cokeai.cc.cd` → `http://n8n:5678`
3. 把 tunnel token 填入 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN`。
4. 建议为 `n8n.cokeai.cc.cd` 增加 Zero Trust Access 策略。
5. SSL/TLS 模式选择 **Full (strict)** 或保持 Tunnel 默认安全配置。

Cloudflare WAF 不要对以下路径启用浏览器挑战/Managed Challenge，否则 API 客户端和支付回调会被拦截：

- `/v1/*`
- `/api/webhooks/stripe`
- `/api/health`

### 4. 启动

```bash
docker compose --profile tunnel up -d --build
docker compose ps
docker compose logs -f app
```

应用启动时会自动执行幂等数据库迁移和种子数据。首次启动会创建管理员账户。
访问 `/admin` 登录。

> `ADMIN_EMAIL` / `ADMIN_PASSWORD` 只在管理员不存在时用于首次创建；
> 后续修改 `.env` 不会覆盖已有密码。登录后可在用户控制台设置页修改密码。

### 5. 配置上游与模型

进入 `/admin/models`：

1. 选择上游，填入官方或经书面授权的 OpenAI 兼容 API Base URL 与 API Key。
2. 勾选启用上游。
3. 编辑模型：填写上游模型 ID、美元成本价/百万 Token、加价比例、最低套餐。
4. 启用模型。
5. 在 `/admin/plans` 检查套餐售价、额度和有效期。
6. 用真实调用验证 `usage`、余额扣减、失败退款与流式结算。

上游授权核对清单：

- 是否允许你面向目标地区、目标客户转售或再分发？
- 是否允许通过 API 网关转发？是否有白标/代理条款？
- 价格、计费单位、缓存折扣、上下文长度是否以书面为准？
- 数据处理、日志、跨境传输、内容审核责任如何约定？
- 供应商终止、调价、限流时的通知和过渡安排？

不要使用 ChatGPT Plus/Pro 等个人会员账号充当 API 上游。

### 6. Stripe（可选）

1. 在 Stripe 创建 Webhook endpoint：
   `https://cokeai.cc.cd/api/webhooks/stripe`
2. 订阅事件：
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.expired`
3. 填写 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`，并按账户支持情况设置
   `STRIPE_CURRENCY`（默认 `cny`，某些 Stripe 账户不支持 CNY）。
4. 重启 app。
5. 用 Stripe 测试模式完成一笔测试订单，确认额度只发放一次、重复 webhook 幂等。

未配置 Stripe 时，人工支付仍可用：用户创建订单，管理员在 `/admin/orders` 确认到账后原子发放。

### 7. n8n

访问方式和导入步骤见 [`n8n/README.md`](n8n/README.md)。
默认 n8n 只绑定 `127.0.0.1:5678`，建议通过 SSH 隧道访问。

```bash
ssh -L 5678:127.0.0.1:5678 <user>@<server>
```

### 8. GitHub Actions 部署

仓库内置：

- `.github/workflows/ci.yml`：每次 push 做类型检查、构建、校验 n8n JSON 和 Docker 镜像。
- `.github/workflows/deploy.yml`：手动部署到 VPS。

启用部署需要：

1. 仓库 Variable：`VPS_ENABLED=true`
2. 仓库 Secrets：
   - `VPS_HOST`
   - `VPS_USER`
   - `VPS_SSH_KEY`
   - `VPS_PORT`（可选，默认 22）
   - `VPS_APP_DIR`（可选，默认 `/opt/cokeai`）
3. 服务器上已有 `.env`。
4. 使用有 sudo/docker 权限的部署用户，或者把用户加入 `docker` 组。

部署工作流通过 rsync 同步代码，再在服务器上执行 `docker compose up -d --build`。
部署后执行 `/api/health` 冒烟检查。

## 本地运行（仅开发）

```bash
cp .env.example .env
# 启动 PostgreSQL / Redis
docker compose up -d postgres redis
npm ci
npm run db:setup
npm run dev
```

本地访问 `http://localhost:3000`。不要把本地 `.env` 提交到仓库。

## 计费规则

- 金额统一以 `micros`（1/1,000,000 元）存储为整数。
- 模型成本以「美元 / 百万 Token」录入，按 `USD_CNY_RATE` 换算。
- 零售价 = 上游成本 × `markup_bps / 10000`。
- 请求进入时按估算输入 Token + 最大输出 Token 计算预留额，并加 10% 缓冲。
- 上游完成后按真实 usage 结算，退回差额。
- 失败时全额释放预留；客户端中断流式请求时按已产生内容保守结算。
- 余额、订单、佣金变更都在数据库事务执行。

## 分销规则

- 单层推荐，不做多级返佣。
- 默认按实付订单金额的 10% 计算（`REFERRAL_COMMISSION_BPS=1000`）。
- 默认 7 天退款观察期（`REFERRAL_HOLD_DAYS=7`）。
- 佣金先 `pending`，n8n 每日调用内部接口将其转为 `available`。
- 管理员线下结算后，在运营后台标记 `paid`。
- 订单退款/拒付时，应在后续版本中接入自动 `reversed`；当前需人工处理。

## API

### 创建 Key

控制台 `/dashboard/keys`，Key 只显示一次。

### 调用

```bash
curl https://cokeai.cc.cd/v1/chat/completions \
  -H "Authorization: Bearer $COKEAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role":"user","content":"Hello"}],
    "stream": true
  }'
```

### 内部接口（仅 n8n/运维）

| 路径 | 方法 | 用途 |
|---|---|---|
| `/api/internal/health` | GET | DB、Redis、模型就绪度 |
| `/api/internal/reports/daily` | GET | 24 小时经营对账 |
| `/api/internal/reports/attention` | GET | 到期、低余额、超时订单 |
| `/api/internal/commissions/mature` | POST | 解锁过观察期佣金 |

请求头：`x-internal-secret: $INTERNAL_API_SECRET`。

## 备份与恢复

```bash
# PostgreSQL
docker compose exec -T postgres pg_dump -U cokeai -d cokeai -Fc > cokeai-$(date +%F).dump

# n8n
docker compose exec -T postgres pg_dump -U cokeai -d n8n -Fc > n8n-$(date +%F).dump

# .env 与代码目录也应单独加密备份
```

恢复前先停止 app/n8n，并核对数据库版本。

## 安全说明

- 应用容器以非 root 用户运行。
- 只把 app/n8n 绑定到 `127.0.0.1`；公网入口由 Cloudflare Tunnel 提供。
- PostgreSQL/Redis 不映射宿主机端口。
- 密码使用 bcrypt；平台 API Key 使用 SHA-256；上游 Key 使用 AES-GCM。
- 管理后台有独立权限检查，但建议额外配置 Cloudflare Access。
- 登录/注册有 Redis 速率限制；API 有速率与并发限制。
- 不保存请求正文；但上游供应商仍会接收你的请求内容。
- 定期更新基础镜像与 npm 依赖，并检查 GitHub Actions 告警。

## 已知限制

- 尚未接入邮件服务，因此没有邮箱验证、找回密码和自动用户通知。
- 退款只支持人工处理，尚未对接 Stripe Refund API 自动冲回余额/佣金。
- 仅支持 OpenAI Chat Completions；Embeddings、Images、Anthropic 原生协议未实现。
- 单实例部署，尚未做多副本会话/限流一致性压测。
- 流式客户端中断时按估算 Token 计费，极端情况下与真实 usage 有少量差异。
- 未做发票、税务、实名认证。
- 条款与隐私文本是工程起点，正式上线前必须由执业律师按实际运营主体审核。
- 供应商采购/售后自动化仅接受正式 API 和书面授权，不实现网页爬取或模拟点击。

## 目录

```text
src/app/api/v1/chat/completions   OpenAI 兼容网关
src/app/dashboard                 用户控制台
src/app/admin                     运营后台
src/app/actions                   登录、Key、订单、后台操作
src/lib                           数据库、计费、上游、限流、加密
db/schema.sql                     PostgreSQL 结构
n8n/workflows                     可导入工作流
ops                               服务器初始化和密钥生成
.github/workflows                 CI 与部署
```

## 下一步建议

1. 确定并书面确认上游 API 的授权范围。
2. 先购买一台云主机，完成域名 Tunnel 与首笔人工支付测试。
3. 用 10–20 个真实用户验证调用成本、失败率与客服负担。
4. 单位经济成立后再启用在线支付和推荐奖励。
5. 接入邮件服务（注册验证、找回密码、余额/到期通知）。
6. 再考虑供应商 API 自动采购与工单协作。
