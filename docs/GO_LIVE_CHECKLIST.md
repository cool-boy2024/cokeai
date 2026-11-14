# CokeAI 生产上线清单

按顺序做，每一步都有验收。不要把密码、私钥、助记词、EASYPAY_KEY 发到聊天里；
直接写进服务器 `.env` 或 GitHub Secrets。

---

## 1. VPS 与部署权限

### 1.1 准备部署用户和 SSH Key

在你自己的电脑上：

```bash
ssh-keygen -t ed25519 -C "cokeai-deploy" -f ~/.ssh/cokeai_deploy -N ""
ssh-copy-id -i ~/.ssh/cokeai_deploy.pub deploy@<VPS_IP>
```

服务器建议用非 root 的 `deploy` 用户，并加入 docker 组。验证：

```bash
ssh -i ~/.ssh/cokeai_deploy deploy@<VPS_IP> 'docker --version && docker compose version'
```

### 1.2 初始化服务器

在本地仓库根目录执行：

```bash
ssh -i ~/.ssh/cokeai_deploy deploy@<VPS_IP> 'sudo bash -s' < ops/bootstrap-vps.sh
```

如果 SSH 不是 22 端口：

```bash
SSH_PORT=2222 ssh -i ~/.ssh/cokeai_deploy deploy@<VPS_IP> 'sudo SSH_PORT=2222 bash -s' < ops/bootstrap-vps.sh
```

### 1.3 第一次把代码放到服务器

GitHub Actions 首次运行前，服务器上必须先有代码和 `.env`：

```bash
rsync -az --delete \
  --exclude=.git --exclude=.env --exclude=.env.* \
  --exclude=node_modules --exclude=.next \
  -e "ssh -i ~/.ssh/cokeai_deploy" \
  ./ deploy@<VPS_IP>:/home/deploy/cokeai/

ssh -i ~/.ssh/cokeai_deploy deploy@<VPS_IP> \
  'cd /home/deploy/cokeai && bash ops/generate-env.sh'
```

把 `generate-env.sh` 输出的两个管理员密码保存到密码管理器。

### 1.4 配置 GitHub Actions

仓库 **Settings → Secrets and variables → Actions**：

Secrets：

| 名称 | 值 |
|---|---|
| `VPS_HOST` | VPS IP 或域名 |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | `~/.ssh/cokeai_deploy` 私钥全文 |
| `VPS_PORT` | SSH 端口，缺省 22 |
| `VPS_APP_DIR` | `/home/deploy/cokeai` |

Variables：

| 名称 | 值 |
|---|---|
| `VPS_ENABLED` | `true` |

验收：在 GitHub Actions 手动运行 **Deploy**，能完成 rsync、compose config、启动和健康检查。

---

## 2. Cloudflare Tunnel

### 2.1 创建或复用 Tunnel

Cloudflare Zero Trust → Networks → Tunnels：

- 新建 Tunnel（Docker 方式），复制 token。
- 服务器 `.env`：`CLOUDFLARE_TUNNEL_TOKEN=<token>`。
- 如果你不使用 Cloudflare，忽略本步，公网入口需要另做。

### 2.2 Public Hostname

| 域名 | Service |
|---|---|
| `cokeai.cc.cd` | `http://edge:8080` |

注意是 **容器内地址** `edge:8080`，不是 `127.0.0.1:8080`。

不要给 `127.0.0.1:18080` 添加 Public Hostname。

### 2.3 WAF

Security → WAF → Custom rules，至少放行/跳过：

- `/v1/*`
- `/v1beta/*`
- `/api/health`
- `/api/webhooks/easypay`
- `/api/webhooks/stripe`（如果启用 Stripe）

这些路径不能出现浏览器挑战、缓存或强制缓冲。

验收：

```bash
curl -i https://cokeai.cc.cd/api/health
curl -i https://cokeai.cc.cd/v1/models
```

第二条应为 JSON 401，而不是 HTML。

---

## 3. Sub2API 合规确认与基础配置

### 3.1 建 SSH 隧道

在你电脑上：

```bash
ssh -L 18080:127.0.0.1:18080 -i ~/.ssh/cokeai_deploy deploy@<VPS_IP>
```

浏览器打开 `http://127.0.0.1:18080`。

登录邮箱/密码在服务器 `/home/deploy/cokeai/.env`：

```bash
ssh deploy@<VPS_IP> "grep '^SUB2API_ADMIN_' /home/deploy/cokeai/.env"
```

不要把密码贴到聊天。

### 3.2 人工确认合规

阅读 Sub2API 的合规文档，由你本人点击确认。代码不会代你同意。

如果自动化管理员启用了 TOTP，`verify`/回滚脚本会停止；请为服务账号关闭 2FA，
并只通过 SSH 隧道访问管理端。

### 3.3 建分组

在 Sub2API 管理端创建分组：

- 名称：`cokeai`
- 平台：`composite`
- `rate_multiplier=1.0`
- 状态：active

把分组 ID 写入服务器 `.env`：

```dotenv
SUB2API_GROUP_ID=<分组ID>
```

然后重启 app：

```bash
cd /home/deploy/cokeai
docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml up -d app
```

验收：

```bash
docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml \
  exec -T app node scripts/verify-sub2api-config.mjs
```

---

## 4. 上游账号

在 Sub2API 管理端逐个添加，先只加一个平台做通，再加其余。

每个账号：

1. 选择平台和账号类型（API Key 用 `apikey`）。
2. 填 Base URL、Key、代理（如有）。
3. 加入 `cokeai` 分组。
4. `rate_multiplier` 必须是 `1.0`。
5. 设置并发/RPM。
6. 在渠道/模型里配置可售模型，确保 `/v1/models` 能看到。

常用上游（以官方文档为准）：

| 平台 | Base URL 示例 |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Anthropic | `https://api.anthropic.com` |
| Gemini | Google AI Studio / Vertex 对应地址 |
| DeepSeek | `https://api.deepseek.com/v1` |
| Kimi / Moonshot | `https://api.moonshot.cn/v1` |
| GLM / 智谱 | `https://open.bigmodel.cn/api/paas/v4` |
| MiniMax | `https://api.minimax.chat/v1` |

先在某个模型上跑通：

1. CokeAI 控制台创建测试 Key。
2. 用该 Key 调 `https://cokeai.cc.cd/v1/models`。
3. 调一次非流式和一次流式 chat。
4. 在 CokeAI `/admin/pricing` 录入该模型的真实成本，点“立即同步”。
5. 再跑一次，确认余额扣减和用量记录。

---

## 5. 支付宝（易支付）

从易支付商户后台获取：

```dotenv
EASYPAY_ENABLED=true
EASYPAY_GATEWAY=https://your-gateway.example.com
EASYPAY_PID=your-pid
EASYPAY_KEY=your-key
EASYPAY_SIGN_TYPE=MD5
EASYPAY_SIGN_MODE=sorted      # 通道文档要求固定拼接时改成 concat
EASYPAY_ALIPAY_TYPE=alipay
```

在通道后台配置：

- 异步通知：`https://cokeai.cc.cd/api/webhooks/easypay`
- 域名/回调白名单：`cokeai.cc.cd`

重启 app，然后用最小充值包真实支付一笔，检查：

```sql
SELECT status FROM orders ORDER BY created_at DESC LIMIT 1;
SELECT status, reference FROM gateway_balance_ops ORDER BY created_at DESC LIMIT 1;
SELECT status, error FROM payment_events ORDER BY created_at DESC LIMIT 1;
```

订单应为 `paid`，额度应为 `applied`，事件应为 `processed`。

如果回调 400，先看签名模式和金额；日志：

```bash
docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml logs app | grep -i easypay
```

---

## 6. USDT TRC20

### 6.1 离线生成钱包

在本地 Mac（仓库根目录）：

```bash
node scripts/generate-trc20-wallet.mjs
```

- 助记词抄到纸上/离线密码管理器，**不要截图、不要上传、不要发聊天、不要进 `.env`**。
- 只把输出的 `account xpub` 填到服务器：

```dotenv
USDT_ENABLED=true
USDT_TRC20_XPUB=xpub...
USDT_TRONGRID_API_KEY=<在 trongrid.io 申请>
USDT_CONFIRMATIONS=19
USDT_QUOTE_MINUTES=10
```

### 6.2 扫描与验收

激活 n8n 工作流，或手动扫描：

```bash
docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml \
  exec -T app sh -c 'wget -qO- --header="x-internal-secret: $INTERNAL_API_SECRET" \
  --post-data="" http://127.0.0.1:3000/api/internal/payments/usdt/scan'
```

用小额真实 USDT（例如 1–2 USDT）付一笔：

- 只走 TRC20；
- 地址和金额必须完全一致；
- 等待 19 个区块；
- 查看 `usdt_deposits`、订单状态和用户余额。

MVP 不自动归集；后续归集需要单独准备 TRX gas 和离线签名流程。

---

## 7. 固定 Sub2API 镜像

在 **VPS** 上执行（不要用本地 Mac 的 digest，架构可能不同）：

```bash
docker pull weishaw/sub2api:latest
docker inspect --format '{{index .RepoDigests 0}}' weishaw/sub2api:latest
```

把输出写入服务器 `.env`：

```dotenv
SUB2API_IMAGE=weishaw/sub2api@sha256:...
```

```bash
cd /home/deploy/cokeai
docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml up -d sub2api
```

保留旧 digest 用于回滚。升级时只改这个变量，并重新跑验证和冒烟。

---

## 8. 小店上线

### 8.1 数据库与开关

```bash
cd /home/deploy/cokeai
COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"
$COMPOSE exec -T app node scripts/migrate.mjs
```

服务器 `.env` 追加：

```dotenv
SHOP_ENABLED=true
SHOP_SUPPORT_EMAIL=support@cokeai.cc.cd
SHOP_MIN_MARGIN_BPS=1500
SHOP_MAX_COST_INCREASE_BPS=2500
SHOP_ORDER_EXPIRE_MINUTES=30
SHOP_CUSTOMER_INPUT_RETENTION_DAYS=7
```

不要在生产执行 `npm run shop:seed`。它写入的是本地演示商品；生产商品必须从
`/admin/shop/sources` 选货 → 建草稿 → 补齐文案 → 勾选合规确认 → 上架。

### 8.2 收款设置

后台 `/admin/payments` 可以配置：

- 个人支付宝收款码 + 收款人（客户扫码付款，运营在账单核对后确认到账）
- USDT TRC20 的账户 xpub + TronGrid API Key（只需公钥，不要私钥/助记词）

如果用 EasyPay，仍按第 5 节配置 `EASYPAY_*`，并在 Cloudflare WAF 跳过列表加：

- `/api/webhooks/easypay/shop`

否则商城支付宝回调可能被浏览器挑战拦截。

### 8.3 n8n 第 6 个工作流

```bash
$COMPOSE exec -T n8n n8n import:workflow --separate --input=/workflows
bash ops/activate-n8n-workflows.sh
```

确认 `CokeAI｜小店货源同步（每小时）` 已启用；`04-gateway-maintenance` 里新增的
`扫描小店 USDT`、`关闭过期小店订单` 已串联。

### 8.4 首次同步与选品

1. 后台 `/admin/shop/sources` 点“立即同步”，看到 250 个 offer。
2. 选 3–5 个干净货源，点“建草稿”。
3. 改写公开文案，设置售价（毛利 ≥ 15%）、发货时效、质保、售后说明。
4. 勾选合规确认后上架。
5. 打开 `/shop`，确认没有出现供货商店名、原始标题、成本或供货商链接。

### 8.5 真实小额演练

按顺序各走一单：

1. 人工到账：下单 → 后台确认到账 → 回填采购 → 上传卡密 → 用户查看。
2. 支付宝：真实小额（例如 0.01–1 元测试商品）→ 回调 `processed` → 订单 `paid`。
3. USDT：真实 1–2 USDT → 地址/金额一致 → 19 个确认 → 订单 `paid`。
4. 缺货 → `refund_pending` → 人工退款 → `refunded`。
5. 检查公开页面源码不包含 `source_title`、供货商域名、`supplier_cost`。

### 8.6 回滚

`SHOP_ENABLED=false` 后重启 app：商城导航隐藏、`/shop` 返回 404，
`shop_*` 表和数据保留。支付回调独立，不影响原充值链路。

---

## 最终验收

```bash
cd /home/deploy/cokeai
COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"

$COMPOSE exec -T app node scripts/verify-sub2api-config.mjs
$COMPOSE exec -T app node scripts/smoke-production.mjs

$COMPOSE ps
$COMPOSE exec -T app wget -qO- http://127.0.0.1:3000/api/health
$COMPOSE exec -T edge wget -qO- http://127.0.0.1:8080/healthz
```

最后用真实用户路径走一遍：

注册 → 充值 → 创建 Key → 调 `/v1`（非流式 + 流式）→ 看余额和用量 → 撤销 Key 后 401。
