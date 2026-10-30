# 边缘限流预案（默认不启用）

**默认不启用。** 默认配置下：

- `CADDY_IMAGE=caddy:2-alpine`，使用官方镜像；
- `EDGE_LIMITS_FILE=./ops/edge/limits.caddy`，该文件只有注释；
- `ops/edge/Caddyfile` 里的 `import /etc/caddy/limits.caddy` 引入空片段；
- Cloudflare Tunnel 仍指向 `app:3000`，公网流量不经过 edge。

因此启用限流片段本身不会改变任何线上行为；真正的开关是“自定义镜像 + 限流片段 +
Tunnel 切到 `edge:8080`”。切 Tunnel 是生产变更，须单独审批，并准备好回滚。

管理员后台 `/admin/security` 的“启动应急防护”按钮只做两件事：把应用层限速减半、
把本页的三步命令发到告警通道。它**不会**构建镜像、改 compose 或改 Tunnel，边缘启用
永远按下面的步骤人工执行。

## 文件

| 文件 | 作用 |
|---|---|
| `Caddyfile` | 生产边缘路由；只多了 `import /etc/caddy/limits.caddy` |
| `limits.caddy` | 默认片段，仅注释，官方镜像也能启动 |
| `limits.rate-limit.caddy` | caddy-ratelimit 限流片段（zone 定义），启用时挂载 |
| `Dockerfile` | 用 `caddy:2-builder` + xcaddy 编入 `github.com/mholt/caddy-ratelimit`，再复制到 `caddy:2-alpine` |
| `compose.build.yml` | 可选 overlay：只覆盖 edge 的 build/image，产出 `cokeai-caddy:ratelimit` |

## 启用三步

### 1. 构建自定义镜像

先留够磁盘（构建镜像和日志需要空间），再固定版本：把 `ops/edge/Dockerfile` 里的
`--with github.com/mholt/caddy-ratelimit` 加上明确的 tag 或 commit（`@vX.Y.Z`）。

```bash
# 方式一：直接构建（在仓库根目录执行）
docker build -f ops/edge/Dockerfile -t cokeai-caddy:ratelimit .

# 方式二：通过 overlay 构建
docker compose -f docker-compose.yml -f ops/edge/compose.build.yml build edge

# 构建环境访问不了 proxy.golang.org 时（本项目网络如此），换 Go 模块代理：
docker build --build-arg GOPROXY=https://goproxy.cn,direct \
  -f ops/edge/Dockerfile -t cokeai-caddy:ratelimit .
# 或： GOPROXY=https://goproxy.cn,direct \
#       docker compose -f docker-compose.yml -f ops/edge/compose.build.yml build edge
```

仍然不要改默认的 `CADDY_IMAGE`；自定义镜像只在显式选择时使用。

### 2. 本地 / 回源验证（不切 Tunnel）

离线校验 Caddyfile（不启动生产）：

```bash
# 默认配置：官方镜像即可通过（import 的是空片段）
docker run --rm \
  -v "$PWD/ops/edge/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$PWD/ops/edge/limits.caddy:/etc/caddy/limits.caddy:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# 限流配置：必须用自定义镜像，否则 rate_limit 指令不存在
docker run --rm \
  -v "$PWD/ops/edge/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$PWD/ops/edge/limits.rate-limit.caddy:/etc/caddy/limits.caddy:ro" \
  cokeai-caddy:ratelimit caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

行为冒烟（本机临时容器，`/healthz` 是本地 respond，不需要上游）：

```bash
docker run -d --rm --name cokeai-edge-limit-test -p 127.0.0.1:18081:8080 \
  -v "$PWD/ops/edge/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$PWD/ops/edge/limits.rate-limit.caddy:/etc/caddy/limits.caddy:ro" \
  cokeai-caddy:ratelimit

# 连发 260 次，应看到前 240 次 200、之后出现 429（带 Retry-After）
for i in $(seq 1 260); do
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18081/healthz
done | sort | uniq -c

docker rm -f cokeai-edge-limit-test
```

回源验证（服务器上、不经过公网）：访问 `127.0.0.1:8080/healthz`、首页、`/shop`、
`/login`、`/api/health`、`/v1/models` 和一次 SSE 流式请求，确认状态码、页面和流式
输出正常；对敏感路径小流量连发，确认只有超限后返回 429。同时观察 edge 的 CPU、
内存和日志。

### 3. 切 Cloudflare Tunnel

确认前两步通过后，才在 Cloudflare Zero Trust 把 `cokeai.cc.cd` 的 origin 从
`http://app:3000` 改为 `http://edge:8080`。切换后立即复验首页、`/shop`、`/login`、
`/api/health`、`/v1/models` 和 SSE，并观察 5xx、延迟、429 比例至少一个窗口。

## 回滚

1. Cloudflare Tunnel 的 origin 改回 `http://app:3000`（一条配置，立即恢复公网）；
2. 恢复官方镜像与空片段：`CADDY_IMAGE=caddy:2-alpine`、
   `EDGE_LIMITS_FILE=./ops/edge/limits.caddy`，重建 edge：

   ```bash
   docker compose up -d edge
   ```

   或不再传入 `ops/edge/compose.build.yml`。

回滚后复验首页、`/shop`、`/login`、`/v1`、`/api/health`。攻击处置过程中不要临时改
Tunnel，走本节的计划变更流程。

## 注意

- 限流按 `{client_ip}` 计数，依赖 `Caddyfile` 全局的 `trusted_proxies` +
  `client_ip_headers CF-Connecting-IP`；只有 cloudflared 从私有网段连入时才可信。
- SSE `/v1` 是长连接：每个请求计 1 次事件，但重连风暴和并发扇出会放大突发。正常
  用户被 429 时，先提高 `per_ip_sustained` 的 `events`（或放宽 `window`）。
- 应用层限流仍然保留；边缘限流是前置减负，不替代登录、下单和 API 频控。
