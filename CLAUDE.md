# CLAUDE.md

给 Claude Code 等 AI 助手的仓库说明。人类协作流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，生产运维见 [docs/SUB2API_OPERATIONS.md](docs/SUB2API_OPERATIONS.md)。

本仓库是私有仓库，只有仓库所有者和受邀协作者可以访问。这里不放任何真实密钥。

## 项目是什么

CokeAI（生产域名 `cokeai.cc.cd`）是面向中文用户的 AI API 中转站，外加一个数字商品小店。仓库同时包含前台、控制台、运营后台、支付和定价逻辑。

```text
Cloudflare Tunnel (cokeai.cc.cd)
        │
        ▼
edge (Caddy, :8080)
  ├── /v1/*, /v1beta/* ──► Sub2API :8080   鉴权、模型路由、Token 计费、余额
  └── 其它路径 ──────────► Next.js :3000   登录、充值、控制台、后台、小店
```

- **Sub2API 是网关和余额的唯一权威**。不要在本仓库里重复实现 Key 校验、模型路由或计费。
- **本仓库是店面与运营层**：注册登录、充值订单、支付回调、Key 双写、定价、后台、小店。
- 旧 Next.js `/v1` 代码只作紧急回滚通道，正常流量不经过它。

## 技术栈

- Node.js 22、Next.js 16 App Router、React 19、TypeScript
- PostgreSQL 16、Redis 7
- 原生 CSS，不引入 Tailwind。样式层按顺序导入：`globals.css` → `v2.css` → `public.css` → `taste.css`
- 字体 Geist / Geist Mono（npm 自托管）；公共页图标用 Phosphor，后台沿用 Lucide
- Docker Compose 部署，镜像入口先跑迁移和 seed，再启动 `server.js`

Next.js 16 与训练数据里的版本有差异。写代码前先读 `node_modules/next/dist/docs/` 里对应的指南；`AGENTS.md` 是 `next dev` 自动生成的，不要手工改。

## 目录

| 路径 | 用途 |
|---|---|
| `src/app/` | 页面与路由：首页、`shop/`、`pricing/`、`docs/`、`dashboard/`、`admin/`、`v1/`（回滚通道） |
| `src/lib/` | 数据库、鉴权、定价、支付、Sub2API 客户端、小店逻辑 |
| `src/components/` | 公共组件；小店组件在 `shop/` |
| `db/schema.sql` | 数据库结构与迁移 |
| `scripts/` | 迁移、seed、同步、测试、冒烟、回滚 |
| `ops/` | Caddy 边缘、Sub2API overlay、VPS 初始化 |
| `n8n/workflows/` | 自动化工作流 |
| `docs/` | 运维、上线检查、小店进度 |

## 本地启动

需要 Node.js 22、Docker Desktop、Git。

```bash
npm install
cp .env.example .env
```

在 `.env` 里至少填好这些本地值：

- `ADMIN_PASSWORD`：至少 10 位
- `APP_ENCRYPTION_KEY`：至少 24 位随机字符串
- `INTERNAL_API_SECRET`：随机字符串
- `POSTGRES_PASSWORD`：URL 安全的随机密码

生成随机值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

仓库默认不把 Postgres 和 Redis 端口暴露到宿主机。本地开发把 override 放在已忽略的 `.local-data/` 里：

```yaml
# .local-data/compose.local.yml
services:
  postgres:
    ports: ["127.0.0.1:5432:5432"]
  redis:
    ports: ["127.0.0.1:6379:6379"]
```

```bash
docker compose -f docker-compose.yml -f .local-data/compose.local.yml up -d postgres redis
```

再在 `.env` 里补两行（密码换成自己的）：

```text
DATABASE_URL=postgres://cokeai:你的POSTGRES_PASSWORD@127.0.0.1:5432/cokeai
REDIS_URL=redis://127.0.0.1:6379
```

```bash
npm run db:setup        # 迁移 + 基本数据（含管理员）
npm run shop:sync       # 可选：拉供货源，生成小店商品需要
npm run shop:seed       # 可选：生成本地小店商品
npm run dev             # http://localhost:3000
```

本地是空数据库，不要往这里导入生产数据。没有启动 Sub2API 时，`/v1` 真实调用和真实支付不可用；商城页面、商品、后台界面仍可开发。

## 常用命令

```bash
npm run dev              # 开发服务器
npm run build            # 生产构建
npm run typecheck        # TypeScript 检查
npm run db:migrate       # 只跑迁移
npm run db:seed          # 只跑 seed
npm run shop:sync        # 同步供货源
npm run shop:seed        # 根据供货源生成商品
npm run test:shop        # 小店逻辑测试（需要本地数据库）
npm run test:shop:sync   # 供货同步测试
npm run smoke:prod       # 生产冒烟（需要 SMOKE_API_KEY，所有者执行）
```

## 改动规则

1. **`main` 只接受 PR**。不要在 `main` 上提交，不要 force push。
2. 从最新 `main` 开分支，前缀用 `feat/`、`fix/`、`chore/`、`docs/`、`hotfix/`。
3. 提交信息用 `type(scope): 说明`，例如 `fix(shop): keep refund note visible on mobile`。
4. 推分支、开 PR，目标 `main`；CI 必须通过 `build`、`e2e`、`compose-smoke`。
5. 由另一位维护者审核后用 Squash and merge 合并。不要合并自己的 PR。
6. 合并后双方执行 `git switch main && git pull --ff-only`。

当前是 GitHub Free 私有仓库，无法强制分支保护，以上规则靠自觉执行。详见 `CONTRIBUTING.md`。

## 不能碰的东西

以下内容不要读取、打印、提交或贴进聊天：

- `.env`、真实密钥、生产数据库导出、用户数据
- 服务器密码、SSH 私钥、Cloudflare Tunnel token
- USDT 助记词、私钥、xprv
- 供应商账号、易支付 PID/KEY

也不要：

- 修改生产服务器、Cloudflare Tunnel 配置或 GitHub Secrets
- 代替管理员接受 Sub2API 合规确认，或绕过上游地区限制
- 未经明确要求就改支付回调、订单状态机、USDT 扫描、数据库结构或定价公式
- 擅自开启/关闭支付渠道；小店目前默认只展示 USDT，易支付备用通道未配置
- 提交 `.next/`、截图产物、`.taste-skill/`、`.local-data/` 等生成文件
- 在公开页面写虚假评价、客户 Logo、增长数据或无法兑现的承诺

必须改数据库、支付或部署相关代码时，先在 PR 里写清原因、影响范围和回滚方式。

## 改动后的验证

```bash
npm run typecheck
npm run build
```

界面改动还要：

- 在 1440 和 390 两个宽度检查，确认没有横向滚动
- 小店保持两步购买：商品页先只显示「购买」，点击后才出现支付方式
- 不提交真实订单，不触碰生产支付

改了数据库或订单逻辑，额外跑 `npm run test:shop`，并在 PR 里说明迁移与回滚步骤。

## 文档

- `CONTRIBUTING.md`：两人协作、分支、PR、审核规则
- `docs/SUB2API_OPERATIONS.md`：生产部署、合规、备份、回滚
- `docs/SHOP_PROGRESS.md`：小店当前进度与待办
- `docs/GO_LIVE_CHECKLIST.md`：上线检查
