# CokeAI 项目介绍（交接版）

一份给接手伙伴看的项目全景。可演示版本：

- `docs/presentation/CokeAI-项目介绍.pptx`：PowerPoint / WPS / Keynote 直接打开
- `docs/presentation/index.html`：浏览器打开，方向键翻页，可打印成 PDF
- 详细状态与操作细节见 `docs/HANDOFF.md`

---

## 1. 封面

一家数字商品小店，和它背后的整套系统。

- 站点：https://cokeai.cc.cd
- 生产代码：`9d40457`（2026-10-30）
- 在售商品：14 个

## 2. 一分钟看懂

顾客在站内挑商品、下单、付款；我们向上游拿货，人工核验后交付。API 中转业务暂停公开销售，但系统仍然在。

- 在售 14 个：6 档 Muse、4 个订阅、Codex 接码、1 个测试商品、Gemini（暂停）
- 待审草稿约 50 个：不公开，必须人工审核并勾选合规后才能发布
- 真实成交 0 笔：只有 2 笔过期测试单；USDT 代码就绪但未开启

## 3. 商业模式：一件代发

上游货源 → 挑货与定价 → 顾客下单 → 人工采购 → 交付与售后。

- 毛利 = 售价 − 拿货价 − 支付/链上成本，没有统一加价率
- 最后一步“去上游付款拿货”仍是人工：上游是带滑块验证的 SPA、没有授权 API
- 不绕过验证、不自动下单

## 4. 顾客旅程

首页 → 小店列表 → 商品详情 → 两步购买 → 订单页。

- 先点“购买”才出现支付方式；填邮箱、数量 1–5、人机验证
- 发货、质保、退款口径全部来自商品字段
- 教程留在站内播放；重要提醒放在“重点注意事项”

## 5. 系统架构

Cloudflare → Cloudflare Tunnel → Next.js `app:3000`；数据在 PostgreSQL / Redis；Sub2API 是 API 网关与余额权威；n8n 跑定时任务。

- 生产 Tunnel 现在指向 `app:3000`，不是 `edge:8080`
- 公网 `/v1` 走的是 Next 旧网关，Sub2API 暂不在公网链路
- 切换入口需要改 Cloudflare 面板并评估兼容性，不要顺手改
- 10 个容器：app / postgres / redis / sub2api(+pg+redis) / edge / cloudflared / n8n / aiclient2api

## 6. 代码地图

- `src/app`：page.tsx 首页；shop/* 小店、详情、结算、订单；dashboard/*；admin/*；api/*
- `src/lib/shop`：sync 拉货源；catalog 公开目录与兜底脱敏；import AI 上架；orders/payments/usdt；sanitize
- `db` · `scripts`：schema、shop:sync / shop:publish / shop:content、shop-scrub-copy、test:shop*
- `ops` · `n8n` · Dockerfile：服务编排、Caddy、Sub2API 编排、自动化工作流
- 阅读顺序：`CLAUDE.md` → `docs/HANDOFF.md` → 相关源码

## 7. 商品与货源

一条货源怎么变成一件在售商品：

- 货源：公开聚合 feed 每小时同步，记录店铺、价格、库存、原链接
- 去重：同一链接可能有多个标题/价格，用“链接 + 标题”哈希做唯一键
- 归类：自动识别账号 / 卡密 / 代充 / 接码
- 建草稿：文案可抄规则，货源身份必须脱敏
- 审核发布：运营改价、核对毛利、勾选合规，才变 active

状态：`draft` 不公开 → `active` 公开 → `archived` 下架；库存 `in_stock` / `low_stock` / `out_of_stock` / `paused`。

## 8. AI 上架流水线

点击“AI 上架” → 入队 → 后台抓取 → 生成草稿 → 自动打开审核页。

- 单条或批量最多 20 条；点击约 0.4 秒跳转，不阻塞页面
- 只抓公网地址、限 512KB、逐跳校验；先清洗货源身份
- 有 AI 配置用模型，没有就用规则提取；注意事项逐行摘录原文
- 失败带原因跳回；排队超 30 分钟自动回收；草稿永远不公开

## 9. 运营后台

- 小店 `/admin/shop`：概览、货源、采购队列、商品、订单
- 原 API 业务：用户 / 订单 / 充值包 / 价格、模型 / 网关、支付审核、公告
- 对外隐藏只是展示层开关，数据、接口、后台都没删
- Sub2API 后台只能经 SSH 隧道 `127.0.0.1:18080`

## 10. 支付与订单

| 通道 | 状态 | 说明 |
|---|---|---|
| USDT TRC20 | `USDT_ENABLED=false` | 二维码、10 分钟时限、链上扫描、自动取消已实现 |
| 易支付（备用） | `SHOP_EASYPAY_ENABLED=false` | 等持牌服务商凭据与结算条款 |
| 个人支付宝 | 已停用 | 历史数据保留 |

订单：待支付 → 已支付 → 处理中 → 已交付；未开始处理可退款，已交付不支持。

当前数据：2 笔过期测试单（支付宝 ¥0.01、USDT ¥169）、1 笔过期 USDT 存款；`usdt-e2e-test` 应归档。

## 11. 安全与合规

1. 凭据只在服务器：不读不打印不提交 `.env`、私钥、token、密码、助记词；**不要再运行 `docker compose config`**
2. 可抄规则，不露货源：店名、域名、外链、联系方式、“货源”字样全部替换
3. 不绕过平台限制：不做地区绕过、不绕反爬/滑块、不代点 Sub2API 合规
4. 不说过头话：不写虚假评价、Logo、增长数据；质保与时效只用可兑现口径

## 12. 发布与回滚

分支 → PR → CI（build / e2e / compose-smoke）→ Squash merge → rsync → build → up -d → 回源验证。

回滚：`docker tag cokeai-app:pre-xxx cokeai-app:local && docker compose up -d app`。

发布前后验证：typecheck/build、1440/390 无横向滚动、两步购买仍在、生产回源 200、商品页无外部域名与“货源”。

## 13. 当前状态快照（2026-10-30）

- 应用 `9d40457`，app healthy
- 商品 14 active、1 archived、约 50 草稿
- 订单 2 笔过期测试，无真实成交
- 公开 API 关闭；支付 USDT 关、易支付关、个人支付宝停用
- AI 上架当前走规则提取；n8n 每 2 分钟兜底
- 回滚镜像 `cokeai-app:pre-hero-copy`

## 14. 待办优先级

- **P0** 审核约 50 个 AI 草稿，逐条核对价格、毛利、质保、注意事项
- **P0** 归档 `usdt-e2e-test`；清理/标注 2 笔过期测试单与 1 笔存款
- **P1** 复核 Muse 六档与 Codex 的拿货价/毛利
- **P1** 确认钱包可见、助记词离线备份后，再开 USDT 并走真实小额单
- **P2** 由运营决定何时恢复 API 销售（改一个 flag）
- **P2** 接受 GitHub 邀请、配好 CODEOWNERS 双人审核

## 15. 怎么接手

第一周：读 `CLAUDE.md` → `docs/HANDOFF.md` → 本地起服务走一遍 → 只读看生产 → 挑 3 个草稿做审核演练（不发布）。

给 AI 的硬要求：先只读排查再提方案；生产改动先说回滚；结论必须有命令输出为证；不把凭据写进文件或提交；改 UI 前确认是不是运营要求保留的门面。

冲突时：代码与线上实测 > HANDOFF 快照 > 历史文档。

## 16. 速查

名词：货源 / offer、草稿 / draft、采购队列、Sub2API、`PUBLIC_API_SALES_ENABLED`、`USDT_ENABLED`。

常用命令：

```bash
npm run dev / typecheck / build
npm run shop:sync / shop:content / shop:publish / test:shop
npx tsx scripts/shop-scrub-copy.ts          # dry-run
npx tsx scripts/shop-scrub-copy.ts --apply  # 写入
```

生产 SSH：`ssh -i ~/.ssh/cokeai_deploy deploy@47.83.178.22`。
