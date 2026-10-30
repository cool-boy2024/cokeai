# CokeAI

AI API 充值、Key 与用量控制台。域名：`cokeai.cc.cd`。

> 只接入具有商业使用/转售授权、且允许面向目标地区提供服务的 API 上游。
> 上线前仍需完成运营主体、支付、税务、隐私与上游合同审核。

## 架构

```text
Cloudflare Tunnel (cokeai.cc.cd)
        │
        ▼
edge (Caddy, :8080)
  ├── /v1/*, /v1beta/* ──► Sub2API :8080   # 鉴权、计费、上游池
  └── 其它路径 ──────────► Next.js :3000   # 登录、充值、控制台、后台
```

- **Sub2API 是网关与余额的唯一权威**：Key 校验、模型路由、Token 计费、用量都在
  Sub2API 完成。
- **CokeAI 是店面与运营层**：注册登录、充值订单、支付回调、Key 双写、实时成本定价、
  运营后台。
- Sub2API 管理端只绑定 `127.0.0.1:18080`，通过 SSH 隧道访问；公网只经 Cloudflare
  Tunnel 到 `edge:8080`。
- 旧 Next.js `/v1` 代码保留作紧急回滚通道，正常流量不经过它。

## 功能

- 用户：注册登录、充值、创建/撤销 `sk-coke-...` Key、查看余额与用量。
- 网关：OpenAI 兼容 `/v1`、SSE 流式、Gemini 原生 `/v1beta`（由 Sub2API 提供）。
- 计费：1 元 = 1 额度；余额以 Sub2API 为准，本地保留展示镜像。
- 定价：手工成本（支持账号级覆盖）→ 实时 USD/CNY → 加价倍率；
  每小时同步到 Sub2API 分组价与模型白名单；缺成本、毛利过低、单次涨幅过大自动暂停。
- 支付：支付宝（易支付聚合）、USDT TRC20（HD 每单独立地址）、Stripe（可选）、
  人工到账兜底。
- 充值幂等：订单与 `gateway_balance_ops` 同事务；Sub2API `Idempotency-Key` +
  余额历史 notes 双重校验；失败自动重试。
- 运营后台：订单、用户、充值包、成本/定价、网关健康、加额度队列。
- 自动化：n8n 6 个工作流（对账、健康、低余额、网关维护、每小时定价、小店货源同步）。

## 本地开发

需要 Node.js 22、PostgreSQL、Redis、Docker；Sub2API 可本地部署。

```bash
npm install
npm run db:setup
npm run dev
```

常用脚本：

```bash
npm run typecheck        # TypeScript
npm run build            # Next.js 生产构建
npm run pricing:sync     # 推送一次定价到 Sub2API
npm run verify:sub2api   # 校验 Sub2API 分组/定价/账号倍率/合规状态
npm run smoke:prod       # 生产公网冒烟（需要 SMOKE_API_KEY）
npm run rollback:prepare # 回滚前把 Sub2API 余额写回本地用户表
```

## 生产部署

完整步骤见 [`docs/SUB2API_OPERATIONS.md`](docs/SUB2API_OPERATIONS.md)。

```bash
sudo bash ops/bootstrap-vps.sh
cd /opt/cokeai
bash ops/generate-env.sh
# 编辑 .env：Cloudflare token、Sub2API 镜像 digest、分组 ID、支付参数
docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml \
  --profile tunnel up -d --build
```

首次启动后：

1. SSH 隧道访问 `http://127.0.0.1:18080`，由管理员本人完成 Sub2API 合规确认。
2. 在 Sub2API 创建分组、上游账号，所有账号倍率设为 `1.0`。
3. 回填 `SUB2API_GROUP_ID`，运行 `npm run verify:sub2api`。
4. 在 Cloudflare Tunnel 把 `cokeai.cc.cd` origin 改为 `http://edge:8080`。
5. 导入并激活 n8n 工作流：`bash ops/activate-n8n-workflows.sh`。
6. 用测试 Key 跑 `npm run smoke:prod`。

## 安全与边界

- Sub2API 保存用户 Key 用于网关校验；CokeAI 本地保存哈希用于回滚与审计，两者双写。
- 上游凭据只存在 Sub2API；CokeAI 不保存上游 Key。
- 支付回调验签、金额核对、事件去重；充值失败保留 pending/failed 状态并重试。
- 不自动代替管理员接受 Sub2API 的合规承诺。
- 不承诺“不保存提示词/输出”；实际留存取决于 Sub2API 与上游配置。
- 生产必须固定 Sub2API 镜像版本或 digest，并备份两个 PostgreSQL 数据库。

## 目录

| 路径 | 用途 |
|---|---|
| `src/` | Next.js 应用、API、支付、定价、Sub2API 集成 |
| `db/schema.sql` | CokeAI 数据库结构（含 002 迁移） |
| `ops/edge/` | Caddy 边缘路由 |
| `ops/sub2api/` | Sub2API + 独立 PostgreSQL/Redis compose overlay |
| `docs/SUB2API_OPERATIONS.md` | 生产运维、合规、备份、回滚 |
| `docs/HANDOFF.md` | 交接说明：线上状态、待办、红线、发布与回滚 |
| `docs/PRESENTATION.md` | 16 页项目全景（配套 `docs/presentation/` 的 PPTX 与 HTML） |
| `n8n/workflows/` | 5 个自动化工作流 |
| `scripts/` | 迁移、验证、冒烟、回滚、开发辅助 |
