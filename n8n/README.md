# CokeAI n8n 自动化

n8n 以 Docker 容器运行，数据保存在同一个 PostgreSQL 实例的 `n8n` 数据库中。
默认只绑定 `127.0.0.1:5678`，不直接暴露公网。

## 工作流

| 文件 | 频率 | 用途 |
|---|---|---|
| `workflows/01-daily-reconciliation.json` | 每天 00:15 | 解锁到期佣金、推送 24 小时收入/用量/毛利对账 |
| `workflows/02-health-alert.json` | 每 15 分钟 | 检查数据库、Redis、可用模型，异常时告警 |
| `workflows/03-user-attention.json` | 每天 09:05 | 汇总即将到期、低余额、超时未处理订单 |

三个工作流导入后默认**未启用**。先手动执行一次，确认数据正确，再到 n8n 中启用。

## 1. 启动

在服务器项目目录：

```bash
docker compose up -d postgres redis app n8n
docker compose ps
```

首次启动会自动创建 `cokeai` 和 `n8n` 两个数据库。若 PostgreSQL 数据卷是旧的、
里面还没有 `n8n` 数据库，请执行：

```bash
docker compose exec postgres \
  psql -U cokeai -d cokeai -c "CREATE DATABASE n8n;"
docker compose restart n8n
```

## 2. 访问 n8n

默认不公开 n8n。用 SSH 隧道访问：

```bash
ssh -L 5678:127.0.0.1:5678 <user>@<server>
```

然后本机浏览器打开 `http://localhost:5678`。首次访问时创建 n8n 所有者账号，
务必使用强密码并开启两步验证。

如果确实需要公开访问，建议使用独立子域名 `n8n.cokeai.cc.cd`，
通过 Cloudflare Tunnel 指向 `http://n8n:5678`，并在 Cloudflare Zero Trust
中为该域名增加 Access 策略（邮箱 OTP 或 SSO）。不要把 5678 端口直接暴露到公网。

## 3. 配置告警 Webhook

在服务器 `.env` 中填写 `ALERT_WEBHOOK_URL`，支持接收 `{ "text": "...", "content": "..." }`
的 Webhook（Slack Incoming Webhook、Discord Webhook 或自建转发器）：

```dotenv
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
```

保存后重建 n8n：

```bash
docker compose up -d --force-recreate n8n
```

如果不填 `ALERT_WEBHOOK_URL`，工作流仍会正常拉取数据，但不会发送消息。

## 4. 导入工作流

在 n8n 中依次进入 **Workflows → Import from File**，导入 `n8n/workflows/` 下的三个 JSON 文件。

也可以使用命令行导入：

```bash
docker compose exec -u node n8n \
  n8n import:workflow --separate --input=/workflows
```

重复执行命令可能产生重复工作流，推荐用界面导入，或在重复导入后删除旧副本。

导入后：

1. 打开每个工作流，点击 **Execute workflow** 手动测试。
2. 检查最后一次执行结果是否成功。
3. 打开右上角 **Active** 开关。
4. 在 **Executions** 中定期查看失败记录。

## 5. 环境变量

n8n 与 app 共用以下内部配置：

- `INTERNAL_API_SECRET`：访问 `/api/internal/*` 的请求头 `x-internal-secret`。
- `N8N_ENCRYPTION_KEY`：n8n 凭据加密密钥，**必须长期保持不变**。
- `ALERT_WEBHOOK_URL`：运营告警出口。
- `N8N_HOST` / `N8N_PROTOCOL`：用于生成 n8n 链接和 Webhook URL。

不要让 n8n 访问公共互联网上的未知 Webhook。不要把内部 API secret 写进工作流文本；
当前工作流通过 `$env` 读取，容器已经设置
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`。

## 6. 备份

n8n 工作流、凭据、执行历史都存放在 PostgreSQL 的 `n8n` 数据库。
备份命令示例：

```bash
docker compose exec -T postgres \
  pg_dump -U cokeai -d n8n -Fc > n8n-$(date +%F).dump
```

还原：

```bash
cat n8n-2026-10-25.dump | \
  docker compose exec -T postgres pg_restore -U cokeai -d n8n --clean --if-exists
```
