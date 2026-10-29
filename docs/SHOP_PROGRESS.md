# 小店实施进度

更新时间：2026-10-29

## 已完成

### 1. Scrapling 与供货商数据

- [x] Scrapling 0.5 全功能安装（`tools/supplier-scraper/.venv`）
  - `scrapling[all]`：Fetcher / StealthyFetcher / Spider / MCP / shell
  - patchright chromium 已安装（StealthyFetcher 可用）
  - camoufox 可选，下载慢，不影响主链路
- [x] 抓取器 `tools/supplier-scraper/scraper.py`
  - 拉取 aibijia meta + products JSON，校验 SHA-256 与 offer_count
  - 标准化 250 个 offer，稳定 key = `sha256(url + 0x1f + title)`
  - 输出 `offers.jsonl` / `summary.json` / `candidates.json` / `html-check.json`
  - HTML 与 JSON 交叉校验通过（250 = 250）
- [x] 数据结论（2026-10-27）
  - 4 类目 / 250 offers / 182 有货：chatgpt 187、gemini 33、claude-code 22、grok 8
  - 226 个唯一 URL 承载 250 个 offer，去重必须带标题
  - 已选 6 个可售商品，毛利率 19.6%–38.8%

### 2. 商城数据层与同步

- [x] `db/schema.sql` 追加 `003_shop`：
  `shop_suppliers / shop_sync_runs / shop_offers / shop_offer_price_history /
  shop_products / shop_product_sources / shop_orders / shop_order_items /
  shop_order_events / shop_payment_events / shop_usdt_deposits / shop_refunds`
- [x] `src/lib/shop/sync.ts`
  - 拉取公开 JSON、SHA-256 校验、ETag 条件请求
  - offer upsert、价格/库存历史、连续缺失 3 次转 `missing`
  - 映射商品成本/库存回写、毛利熔断（<15%）、成本单次涨幅熔断（>25%）
- [x] `npm run shop:sync` 实测成功：250 offers，第二次 304 增量
- [x] 6 个种子商品 `npm run shop:seed`
  - ChatGPT Plus 月度卡密 ¥169
  - Claude Pro 月度卡密 ¥199
  - ChatGPT Pro 5x 月度代充 ¥849
  - Claude Max 5x 月度代充 ¥1,099
  - Gemini Pro 年度代充 ¥49
  - Grok Super 月度代充 ¥269

### 3. 用户侧

- [x] `/shop` 分类、商品卡、库存徽标、移动端
- [x] `/shop/[slug]` 详情、统一文案、购买卡、登录跳转
- [x] `/shop/checkout/[orderNo]` 支付宝 / USDT / 人工到账
- [x] `/shop/orders/[orderNo]` 时间线、加密交付查看、输入脱敏
- [x] `/dashboard/shop` 我的订单
- [x] `/shop/terms` 数字商品购买须知（发货、质保、退款、账号凭据）
- [x] 首页小店预览 + “小店上新”区块；页脚/导航入口

### 4. 支付与履约

- [x] EasyPay 商城独立回调 `/api/webhooks/easypay/shop`
  - 验签、金额分比对、provider 校验、事件幂等
  - 实测：正常回调 paid、重复回调 1 条事件、金额不符不履约
- [x] USDT 商城存款 `/api/internal/shop/usdt/scan`
  - 复用全局派生序号，地址唯一
  - 实测：两笔订单地址不同、刷新地址稳定、扫描器可运行
  - 本地 TronGrid 免费额度会 429；已加 3 次退避重试 + 200ms 间隔，
    生产建议使用有效/付费 TronGrid key，单批默认 20 个地址
- [x] 人工到账、采购、交付、缺货、退款状态机
- [x] 交付内容/客户输入 AES-256-GCM 加密；交付后 7 天清除
- [x] 过期订单清理 `/api/internal/shop/orders/expire`
- [x] `npm run test:shop` 覆盖：价格篡改、幂等支付、加密、越权查看、缺货退款、过期、输入清除

### 5. 运营后台

- [x] `/admin/shop` 今日收入、待采购、待交付、同步状态
- [x] `/admin/shop/queue` 采购队列：一键复制采购单 + 打开供货商链接
- [x] `/admin/shop/orders` 列表、状态筛选、毛利
- [x] `/admin/shop/orders/[id]` 确认到账、复制采购信息、回填采购、上传交付、缺货、退款、日志
- [x] `/admin/shop/products` 列表、毛利/文案/熔断状态
- [x] `/admin/shop/products/[id]` 文案编辑、价格/时效/质保、来源、解除熔断；
      上架必须勾选合规确认，否则保存为草稿
- [x] `/admin/shop/sources` 同步状态、店铺统计、最近 150 条 offer、映射/毛利；
      未映射 offer 可一键“建草稿”
- [x] 下单频率限制：每用户 10 次 / 10 分钟
- [x] 支付通道初始化失败自动取消未支付订单

### 6. 自动化

- [x] n8n `06-shop-sync.json` 每小时 :12 同步
- [x] `04-gateway-maintenance.json` 每 5 分钟追加：小店 USDT 扫描、过期订单清理
- [x] CI n8n 工作流数量 5 → 6
- [x] `.env.example` 增加 `SHOP_*`

### 7. 已验证

```bash
npm run typecheck      # 通过
npm run build          # 通过
npm run test:shop         # 通过
npm run test:shop:sync    # 通过（feed 解析、去重 key、状态映射）
npm run test:shop:pay     # 通过（真实签名，模拟回调）
npm run test:shop:manual  # 通过（个人支付宝落单、收款码快照、回执核销）
npm run test:shop:usdt    # 本地无 TronGrid key，自动跳过；生产配置后再跑
```

UI 实测：浏览 → 登录 → 下单（人工）→ 后台确认到账 → 采购 → 交付卡密 →
用户在订单页查看；移动端 390px 截图检查。

### 当前本地状态（2026-10-27）

- 本地 dev 服务：`http://localhost:3000`
- 数据库已应用 `003_shop` + `003_personal_payments`，保留 6 个演示商品
- 测试用户、测试订单、测试收款设置已清理（含个人支付宝测试数据）
- 本地 `USDT_TRONGRID_API_KEY` 为空，`test:shop:usdt` 会自动跳过

### 生产上线状态（2026-10-27）

- 生产目录：`/home/deploy/cokeai`，活动栈为 `cokeai-*`（Cloudflare Tunnel 仍复用 `/opt/cokeai`）
- 上线前备份：
  - `/home/deploy/backups/cokeai-pre-shop-20261027-093116.sql.gz`
  - `/home/deploy/backups/cokeai-pre-shop-20261027-093116.env`
  - 旧镜像 tag：`cokeai-app:pre-shop`
- 已同步最新代码并重新构建 `cokeai-app:local`，容器 healthy
  - 上架前镜像保留为 `cokeai-app:pre-ackfix`
- 已应用迁移：`001`、`002`、`003_personal_payments`、`003_shop`
- 已导入并发布 6 个 n8n 工作流；`04` 含小店 USDT 扫描/过期清理，`06` 每小时 :12 同步
- 已手动触发首次同步：250 个 offer、181 个有货
- 公开路由：`https://cokeai.cc.cd/shop` 200、`/shop/terms` 200
- `/admin/payments` 已存在（未登录 307 到登录页）
- **生产小店已上架 6 个商品（2026-10-27）**：
  - 运营已在对话中确认合规；数据库记录 `compliance_ack_at` + `compliance_ack_by`（管理员账号）
  - 售价/成本/毛利：
    ChatGPT Plus 月度卡密 ¥169/¥132/21.9%；Claude Pro 月度卡密 ¥199/¥155.44/21.9%；
    ChatGPT Pro 5x 月度代充 ¥849/¥682.45/19.6%；Claude Max 5x 月度代充 ¥1099/¥875/20.4%；
    Gemini Pro 年度代充 ¥49/¥30/38.8%（供货缺货，公开显示“补货中”）；
    Grok Super 月度代充 ¥269/¥211/21.6%
  - 公开页验证：6 个详情页全部 200；列表显示 6 个商品；
    现货/库存紧张/补货中状态正确；页面不含供货商、成本、毛利、原始标题
  - 新增 `npm run shop:draft`（只建草稿，不自动上架）；生产用打包后的
    `shop-seed-runtime.mjs --draft --confirm-production` 导入，不依赖生产镜像里的 tsx
  - 后台保存商品时 `compliance_ack_by` 会记录操作管理员
- **生产支付通道（2026-10-27 14:02 CST 启用，19:10 CST 停用）**：
  个人支付宝曾上传并启用（`payment_settings.alipay_manual enabled=true`，二维码加密存储）；
  2026-10-27 19:10 CST 运营决定小店不再走个人收付款，个人支付宝已停用，商城改走 USDT TRC20
- 新增个人支付宝收款链路：`payment_settings`、`manual_alipay_payments`、
  `payment_receipts`、后台审核页 `/admin/payments/review/[orderId]`
- 若启用 EasyPay，Cloudflare WAF 仍需放行 `/api/webhooks/easypay/shop`
- 2026-10-27 12:12 再次部署：收银台人工到账文案改为“联系客服获取收款方式”，
  避免没有收款目标时误导；生产 app healthy
- 2026-10-27 管理员凭据核查：生产仅有 `admin@cokeai.cc.cd`（role=admin，active）；
  当前密码未知，未读取生产 `.env` 的 `ADMIN_PASSWORD`。重置方案：服务器端生成随机密码，
  只写入 `/home/deploy/cokeai/.admin-reset.txt`（0600），由运营自行读取后删除；
  登录后可在 `/dashboard/settings` 改密（需当前密码，改后其他设备退出）
- 2026-10-27 05:46 UTC 上下文维护核查：生产 app healthy，自上次维护后无新变更，
  待办仍是“管理员密码 + 支付宝收款码”两项
- 2026-10-27 13:12 CST 每小时同步正常：最近 6 次均为 `success`，offers 247/250
  （3 条连续缺失转 `missing`），映射商品 6 个；后台小店/订单/商品/货源/收款页
  与公开 `/shop` 全部 200
- 2026-10-27 13:55 CST 管理员密码已在服务器端重置：随机生成新密码，仅写入
  `/home/deploy/cokeai/.admin-reset.txt`（0600，25 字节）；旧 hash 备份到
  `/home/deploy/cokeai/.admin-reset-backup.txt`（0600，可回滚）；旧会话已全部撤销；
  bcrypt 比对校验通过（`role=admin, status=active`）。密码未进入对话，运营读取后删除两个文件
- 2026-10-27 14:21 CST 建 ¥0.01 生产测试商品 `alipay-e2e-test`
  （id `63aba780-229f-49cd-855c-c8f3282687b8`，active/in_stock，无供货来源）；
  公开列表与详情页 200；用于真实小额支付宝全链路测试，当前等待运营扫码付款。
  **测试完成后必须删除该商品和相关测试订单**
- 2026-10-27 16:39 CST 上下文维护核查：app healthy；14/15/16 点同步均 `success`
  （offers 恢复至 248/250）；测试商品仍 active/in_stock，尚无测试订单，
  仍未扫码付款；除此之外无新变更
- 2026-10-27 17:39 CST 上下文维护核查：app healthy；17 点同步 `success`
  （offers 247/250）；测试商品状态未变，仍无测试订单、未扫码；无其他变更
- 2026-10-27 19:10 CST 支付方向调整：运营决定小店不再走个人收付款，改走加密货币（USDT TRC20）。
  已停用个人支付宝（`payment_settings.alipay_manual enabled=false`，二维码数据保留但不展示），
  删除 ¥0.01 测试商品 `alipay-e2e-test`；核查时生产/本地无已支付订单或付款申报
  （19:02 另有一笔个人支付宝测试订单，详见 19:45 核查）。
  代码已改为小店 USDT-only（个人支付宝/人工到账不再提供给商城），已重新构建并发布，
  app healthy；当前 `USDT_ENABLED=false`、`USDT_TRC20_XPUB`/`USDT_TRONGRID_API_KEY` 为空，
  前台显示“加密货币收款配置中，暂不可下单”。待运营在 `/admin/payments` 配置
  xpub + TronGrid API Key + 首地址后启用
- 2026-10-27 19:12 CST USDT 收款已启用：生产 `payment_settings.usdt_trc20 enabled=true`
  （xpub 取自本地已配置钱包，首地址 `TRbEz6ixzMudHiuJS1Y7HHzZzBYbn7stxL`，加密入库）；
  TronGrid 暂未配置 API Key，代码已支持低频无 key 查询（无 key 时扫描间隔 1.2s），
  生产容器实测 TronGrid/CoinGecko 均可访问。`alipay_manual` 保持停用，商城为 USDT-only。
  付款前需运营在自己的钱包中确认首地址可见，确保对应助记词已离线备份
- 2026-10-27 19:15 CST 建 USDT 测试商品 `usdt-e2e-test`（¥7.30，约 1.1 USDT，
  active/in_stock，无供货来源）；公开页与登录后详情页均 200，结算页可选 “USDT TRC20”。
  **测试完成后必须删除该商品和相关测试订单**
- 2026-10-27 19:27 CST 恢复易支付作为商城备用通道：商城可选 `USDT TRC20` +
  `支付宝（易支付）`，个人支付宝二维码和人工到账仍关闭；新增可选风控上限
  `EASYPAY_SHOP_MAX_ORDER_CNY` / `EASYPAY_SHOP_DAILY_MAX_CNY`（默认 0 = 不限）。
  生产 `EASYPAY_ENABLED=false`，网关/PID/KEY 未配置，因此前台仍只显示 USDT；
  待运营确认持牌服务商、结算/冻结条款后填 `.env`，并放行 WAF 回调路径
- 2026-10-27 19:40 CST 商城购买流程改为两步：商品页只显示“购买”，点击后才显示
  “选择支付方式”；当前渠道仅 `USDT TRC20`。易支付备用代码保留，但由
  `SHOP_EASYPAY_ENABLED=false` 关闭，即使为充值配置了 EasyPay 也不会出现在商城。
  浏览器实测：初始无渠道选择，点击购买后出现 USDT 选项与“确认并去支付”
- 2026-10-27 19:45 CST 上下文维护核查：app healthy；19:12 同步 `success`（248 offers）；
  发现一笔 19:02 创建的个人支付宝测试订单 `CK20261027ACEC06A1`（¥0.01，
  `alipay_manual`），19:37 因超时变为 `expired`，无付款申报、无支付事件；
  对应商品 `alipay-e2e-test` 已于 19:05 删除，**该过期测试订单待清理**。
  `usdt-e2e-test` 仍 active/in_stock，尚无 USDT 订单；USDT 收款已启用但无 TronGrid key。
  两步购买流程已浏览器实测通过，除上述测试数据外无未保存变更
- 2026-10-27 20:39 CST 上下文维护核查：app healthy；20:12 同步 `success`（248 offers）；
  `usdt-e2e-test` 仍 active/in_stock，仍无 USDT 订单/存款；过期个人支付宝测试订单
  `CK20261027ACEC06A1` 仍在库待清理；支付通道状态未变（`alipay_manual` 关闭、
  `usdt_trc20` 启用），除同步外无新变更
- 2026-10-28 09:35 CST 上下文维护核查：app healthy；09:12 同步 `success`，但 offers
  降至 213（前值 248），`missing` 45；ChatGPT Plus、Claude Max、Grok 转为
  `out_of_stock`（公开显示补货中），Claude Pro 仍 `in_stock`，Gemini 仍 `paused`；
  6 个商品仍 active。`usdt-e2e-test` active/in_stock，仍无 USDT 订单/存款；
  过期个人支付宝测试订单 `CK20261027ACEC06A1` 仍在库待清理；支付通道未变。
  **已直接核对 aibijia feed：当前本身 213 条（chatgpt 168 / gemini 18 /
  claude-code 18 / grok 9），不是同步解析故障；供货源确实减少了 offer，
  补货中状态属正常映射结果，后续观察是否恢复**
- 2026-10-28 09:36 CST 复核：状态与 09:35 相同，无新变更；公共 `/api/health`
  首次请求超时，重试 200，容器内健康检查 200 且 `healthy`，判定为瞬时网络抖动
- 2026-10-28 12:26 CST 上下文维护核查：app healthy；11:12/12:12 同步 `success`，
  offers 214（较 09:12 的 213 略回升）；直连 aibijia feed 当前 215
  （chatgpt 169 / gemini 19 / claude-code 18 / grok 9），`missing` 仍 45；
  商品状态未变（ChatGPT Plus、Claude Max、Grok 补货中，Claude Pro 现货，Gemini paused）；
  `usdt-e2e-test` 仍 active/in_stock，无 USDT 订单/存款；过期支付宝测试订单
  `CK20261027ACEC06A1` 仍待清理；无其他变更
- 2026-10-28 12:39 CST 复核：状态与 12:26 相同，无新变更；公共 `/api/health`
  首次超时、第二次 200，仍为偶发网络抖动
- 2026-10-28 13:39 CST 上下文维护核查：app healthy；13:12 同步 `success`，
  offers 215（与 aibijia feed 当前 215 一致：chatgpt 169 / gemini 19 /
  claude-code 18 / grok 9）；商品状态未变（ChatGPT Plus、Claude Max、Grok
  补货中，Claude Pro 现货，Gemini paused）；无 USDT 订单/存款；
  过期支付宝测试订单 `CK20261027ACEC06A1` 仍待清理；无其他变更
- 2026-10-28 14:39 CST 复核：app healthy；14:12 同步 `success`，offers 215
  （与上一轮持平）；商品状态、订单/存款均未变；过期支付宝测试订单仍待清理；
  无其他变更
- 2026-10-28 CST 公共站点视觉升级已发布：Geist 自托管字体、`public.css` 设计层、
  浮动胶囊导航与全屏移动菜单、滚动揭示、首页/Bento/价格/CTA 重构、小店列表与详情、
  pricing/docs/auth/legal/404/error、OG 图、公共页图标迁移 Phosphor。后端、支付、
  订单、数据库和 `/v1` 未改。发布前备份镜像 `cokeai-app:pre-redesign`。
  验证：typecheck/build 通过；320–1440 无横向滚动；生产首页、`/shop`、`/pricing`、
  `/docs`、`/login`、`/shop/terms`、OG、`/api/health` 均 200；移动菜单可开、Escape 关闭且焦点返回；
  两步购买仍为“购买 → USDT TRC20 → 确认并去支付”。同轮修复：docs 移动端栅格选择器、
  移动端表格列、Dashboard `panel-grid` 溢出、滚动揭示阈值导致长列表初始隐藏。
  生产模型目录当前为空（Sub2API 上游未配置），首页显示“模型目录同步中”，属待办 #10。
- 2026-10-28 15:41 CST 上下文维护核查：App 在第三次发布后 `healthy`；15:12 同步
  `success`，offers 216（较 14:12 的 215 +1，mapped 6）；商品 `active` 7 个
  （in_stock 2 / low_stock 1 / out_of_stock 3 / paused 1）；`usdt-e2e-test`
  仍 active/in_stock；`shop_usdt_deposits` 为 0；24 小时内无新订单，唯一订单
  仍是已过期的支付宝测试单 `CK20261027ACEC06A1`（¥0.01，expired）；无其他变更
- 2026-10-28 15:56 CST 体验增强并二次发布：
  1. 首屏入场动效（hero 文案分段上浮、右栏小店预览延迟上浮、悬浮卡缓慢漂浮、
     状态点呼吸），全部由 `html.js` 启用，`prefers-reduced-motion` 下关闭；
  2. 纹理加强（Hero 细网格 + 颗粒、tagline 区颗粒、预览卡/CTA/商品封面颗粒加深）；
  3. 价格区从“推荐卡跨两行”改为三列等高，修复大卡下方大片空白；
  4. 教程内容集中到 `/docs`：Dashboard 概览移除“快速接入”代码卡与复制按钮，
     改为“接入教程”入口；首页 Bento 移除 `base_url` 代码片段，改为教程入口卡；
     `/docs` 标题改为“接入教程”，导航“文档”改为“教程”，Dashboard 侧栏/顶栏
     增加“接入教程”入口。后端、支付、订单、数据库和 `/v1` 未改。
  发布镜像备份 `cokeai-app:pre-motion`；typecheck/build 通过；生产首页、`/docs`、
     `/shop`、`/pricing`、`/api/health` 均 200；1440/390 无横向溢出；公共页已无代码块。
- 2026-10-28 16:20 CST 首次真正通过 `landing-page-design` Skill 审计并发布：
  安装 `~/.claude/skills/landing-page-design` 与
  `~/.claude/skills/redesign-existing-projects`，按 skill 的 Part A / Part B 审计
  首页、`/shop`、商品详情、`/pricing`、`/docs`、auth、legal。修复：
  1. tagline 从“整段点亮”改为逐词点亮（IntersectionObserver + 40ms 步进；
     `prefers-reduced-motion` 直接全亮）；
  2. 补上 landing page 缺失的结构：三步接入、8 条常见问题（并排列表，非手风琴）、
     FAQPage JSON-LD；
  3. 字体全部吸附到 Tailwind type scale（移除 10/11/13/15/38/56/64/88/104px），
     间距只保留 0/2/4/8/12/16/24/32/40/48/64/80/96，圆角只保留 Tailwind 档位；
  4. 价格卡统一 32px 内边距、固定标题/价格块高度，三列名称、价格、到账额度、
     CTA 全部同 Y 轴对齐；推荐标记改为绝对定位；
  5. 修复 `.public-main .legal` 与实际 `<main class="public-main legal">` 不匹配的
     选择器（法律页正文从 13px 恢复到 16px / 28px）；
  6. docs 侧栏 13→14px、表格头统一 12px、auth label 13→14px；
  7. 商品详情去掉右栏重复价格；发货时效范围改为“10 至 60 分钟”。
  验证：typecheck/build 通过；320/390/768/1024/1440 无横向溢出；tagline
  逐词点亮计数 0→1→3→5→7→9→10；reduced motion 全部直接显示；移动菜单
  Escape 关闭且焦点返回；两步购买仍为“购买 → USDT TRC20 → 确认并去支付”；
  生产 `/`、`/shop`、`/pricing`、`/docs`、`/login`、`/shop/terms`、`/api/health`、
  OG 均 200。镜像备份 `cokeai-app:pre-skill-pass`。后端、支付、订单、数据库、
  `/v1` 未改。
- 2026-10-28 16:39 CST 上下文维护核查：App `healthy`（本次 Skill 发布后约 23 分钟）；
  16:12 同步 `success`，offers 216（与 15:12 持平，mapped 6）；商品状态未变
  （active 7：in_stock 2 / low_stock 1 / out_of_stock 3 / paused 1）；
  `shop_usdt_deposits` 仍为 0；无新订单，唯一订单仍是过期测试单
  `CK20261027ACEC06A1`；无临时脚本、无本地 dev server；无其他变更
- 2026-10-28 17:39 CST 上下文维护复核：App `healthy`；17:12 同步 `success`，
  offers 216（mapped 6，与 16:12 持平）；商品状态未变（active 7：in_stock 2 /
  low_stock 1 / out_of_stock 3 / paused 1）；`shop_usdt_deposits` 为 0；
  无新订单，唯一订单仍是 `CK20261027ACEC06A1`（expired）；无临时文件、
  无本地 dev server；无其他变更
- 2026-10-28 18:02 CST GSAP 交互动效上线：
  1. 安装 `gsap@3.15`，新增 `src/components/motion/MotionLayer.tsx`，在根 layout
     挂载，只在公共页生效，Dashboard/Admin 不参与；
  2. 页面切换：点击站内公共链接时深色纸面 wipe 从底部升起，路由完成后滑出并
     淡入 `#main-content`；外部链接、同路径链接、`#` 锚点、带修饰键点击全部跳过，
     不拦截 Next 路由；
  3. 文字：Hero h1 拆成两行 CSS 遮罩，逐行从下方上浮（不依赖 JS，避免标题空白）；
     tagline 从 IntersectionObserver 改为 GSAP ScrollTrigger 逐词点亮
     （40ms 级联，仅一次），可访问名称保持不变；
  4. 滚动：顶部绿色阅读进度条；Hero 小店预览随滚动下移；bento 用量条进入视口时
     从左填充；产品封面随鼠标产生轻微视差；
  5. 交互：首屏 CTA、最终 CTA、小店充值按钮磁吸；移动菜单、卡片 hover、焦点环
     保持原样；
  6. 所有 GSAP 动画使用 `CustomEase` 生成的
     `cubic-bezier(0.22,1,0.36,1)` 基准曲线；`prefers-reduced-motion` 下不注册
     GSAP，wipe/进度条 CSS 直接隐藏，Hero 行动画关闭；
  7. 路由切换时 `gsap.context` / 事件监听全部清理，避免重复绑定。
  验证：typecheck/build 通过；生产 `/`、`/shop`、`/pricing`、`/docs`、`/login`、
  `/shop/terms`、`/api/health` 均 200；浏览器控制台无错误；桌面与 390 移动端
  Hero 逐行上浮、page wipe、tagline 级联、进度条均生效；320/390/1440 无横向溢出；
  浏览器后退后 wipe 归位；移动菜单跳转后自动关闭且 body 滚动恢复；
  Dashboard 无 wipe/进度条，布局未变。镜像备份 `cokeai-app:pre-gsap`。
  后端、支付、订单、数据库、`/v1` 未改。
- 2026-10-28 18:39 CST 上下文维护核查：GSAP 最终版已发布，App `healthy`
  （Up 16 分钟）；18:12 同步 `success`，offers 255（较 17:12 的 216 +39，
  mapped 6）；商品 active 7（in_stock 3 / low_stock 2 / out_of_stock 1 /
  paused 1，较 17:39 有回升）；`shop_usdt_deposits` 为 0；无新订单，唯一订单
  仍是过期测试单 `CK20261027ACEC06A1`；无临时文件、无本地 dev server；
  无其他变更
- 2026-10-28 19:35 CST 首屏品牌轨道（Hero Orbit）与纸感升级：
  1. 首页 Hero 改为居中品牌舞台，H1 为“CokeAI 小店 / 接上你需要的模型。”；
     新建 `public/hero-field.svg`（椭圆轨道线、点阵、绿色弧线）叠 grain、
     模糊光斑和全站纸点纹理；`public/brands/` 放入 OpenAI、Claude、Gemini、
     DeepSeek、Grok、Qwen、Mistral、Kimi、Ollama、Llama 十个品牌 SVG
     （MIT，附 LICENSE），围绕中心组成 10 卡椭圆轨道；
  2. `src/components/home/HeroOrbit.tsx` 用 GSAP ticker 做缓慢公转、深度缩放、
     透明度与轻微倾斜；鼠标移动时轨道与中心反向偏移；滚动时轨道向内收拢并
     快速淡出，不遮挡正文；`prefers-reduced-motion` 下静态排布，无 ticker；
  3. ≤960px 隐藏轨道，改为 6 个品牌胶囊；新增左下 USDT、右下商品数量两张
     浮动卡；Hero 最小高度改为 `100dvh - 88px`；短视口（≤820px 高）标题降到
     72px 并收紧间距；
  4. 公共页增加纸点纹理；商品卡、价格卡、bento、模型表格卡统一轻浮动阴影；
     Hero 文案改为“OpenAI 兼容接口，按量计费。注册、充值、创建 Key，就能用。”
     并固定两行断句；
  5. 删除旧的小店预览卡、`shop-preview` / `preview-float` CSS 及
     MotionLayer 里的预览视差。
  验证：typecheck/build 通过；本地 320/390/768/1024/1366/1440/1600 无横向溢出，
  轨道与文字无实际重叠；滚动收缩淡出、鼠标反向视差、减少动效静态版均通过；
  生产 `/`、`/shop`、`/pricing`、`/docs`、`/hero-field.svg`、
  `/brands/openai.svg`、`/api/health` 均 200，控制台无错误；生产 1440/390
  截图与本地一致。镜像备份 `cokeai-app:pre-orbit`。后端、支付、订单、数据库、
  `/v1` 未改。
- 2026-10-28 19:40 CST 上下文维护核查：Hero Orbit 版已发布，App `healthy`
  （Up 11 分钟）；19:12 同步 `success`，offers 255（与 18:12 持平，mapped 6）；
  active 商品 7（in_stock 3 / low_stock 2 / out_of_stock 1 / paused 1）；
  `shop_usdt_deposits` 为 0；无新订单，唯一订单仍是过期测试单
  `CK20261027ACEC06A1`；无临时文件、无本地 dev server；生产 `/`、`/shop`、
  `/api/health` 均 200；无其他变更
- 2026-10-28 20:39 CST 上下文维护核查：Hero Orbit 版稳定运行，App `healthy`
  （Up 约 1 小时）；20:12 同步 `success`，offers 255（与 18:12、19:12 持平，
  mapped 6）；active 商品 7（in_stock 3 / low_stock 2 / out_of_stock 1 /
  paused 1，未变）；`shop_usdt_deposits` 为 0；无新订单，唯一订单仍是过期
  测试单 `CK20261027ACEC06A1`；无临时文件、无本地 dev server；生产 `/`、
  `/shop`、`/api/health` 均 200；无其他变更
- 2026-10-28 21:01 CST 生产整机失联（Cloudflare Error 1033）：`cokeai.cc.cd`
  返回 530 / 1033（Ray ID `a51a21b28d999e1f`，13:01:52 UTC）。排查证据：
  本机 `ping 47.83.178.22` 100% 丢包，TCP 22/80/443 全超时，SSH
  `Operation timed out`；境外 check-host 节点（保加利亚、西班牙、印尼、伊朗）
  测 TCP 22 全部超时，另 5 个节点（印度、摩尔多瓦、洛杉矶、亚特兰大、纽约）
  ICMP 全部超时。结论：故障在 VPS 层（整机离线或被平台停止），不是
  cloudflared、应用或 Cloudflare 配置问题；最后一次正常核查为 20:39 CST，
  故障发生在 20:39–21:01 之间。21:43 CST 复查仍未恢复（530、SSH 过滤）。
  待运营在阿里云控制台确认实例状态（欠费/到期/被停止/宿主故障），恢复后需
  复核 `docker compose ps`、cloudflared 日志、`/`、`/shop`、`/api/health`；
  各服务均为 `restart: unless-stopped`，正常重启应自动拉起。数据在实例磁盘，
  停复机不丢；仅实例被释放才会丢。本故障期间未改动任何代码或配置
- 2026-10-28 22:39 CST 复查：仍未恢复——`/api/health` 请求在 Cloudflare
  边缘超时（HTTP 000），SSH 22 不可达，`ping 47.83.178.22` 100% 丢包；
  故障已持续约 1 小时 40 分钟。等待运营在阿里云控制台处理实例；期间无代码、
  配置或数据变更
- 2026-10-28 23:38 CST 生产恢复：实例已重启（`uptime` 48 分钟），SSH 可用，
  8 个容器全部 Up（app healthy），cloudflared 重新注册到 hkg01/hkg08/hkg11，
  连通性预检全部 PASS；磁盘 83%、内存 3.6G 正常。应用侧响应正常：容器内
  `/` 20–31ms、`/shop` 19ms、`/api/health` 3.5ms，从新加坡经 Cloudflare
  访问 100–310ms。但中国大陆 → Cloudflare 边缘明显异常：本机多次请求
  TTFB 1.5s / 4.4s / 6.1s / 11.6s，并有 15s 超时；`/cdn-cgi/trace` 一度返回
  `colo=GRU`，`cloudflare.com` 基线 TTFB 约 1.4–1.9s（`colo=LAX`）。结论：
  后台按钮“点了很久才跳转”是大陆到 Cloudflare 边缘链路问题，不是应用、
  数据库或云端点问题（云端点为毫秒级）
- 2026-10-28 23:00–23:45 CST 本地完成两项改动（尚未在生产构建）：
  1）首页“小店上新”改为参考图的环形商品舞台：新增
  `src/components/home/ShopRing.tsx`（6 个商品卡椭圆绕中轴慢转、深度缩放、
  悬停暂停并抬升、滚动联动旋转、指针 3D 倾斜、进入视口错峰展开、
  减少动效静态版），`page.tsx` 用居中标题 + 环形卡片替换原三卡网格，
  移动端 ≤1100px 回退为原商品网格；`public.css` 新增 `.shop-collection*` /
  `.shop-ring-*` 样式。本地验证 320/390/768/1024/1100/1280/1440 无横向溢出、
  悬停后角度稳定、reduced-motion 静态可见、控制台无错误。2）后台导航体感优化：
  新增 `NavProgress`（应用页路由顶部进度条）、`admin/loading.tsx` 与
  `dashboard/loading.tsx` 骨架屏、侧栏 active 圆点；`next.config.ts` 增加
  `experimental.staleTimes.dynamic=15` 与 `dynamicOnHover`，降低重复导航等待。
  `typecheck`、`build` 均通过；本地 `npm start` 冒烟无错误。发布流程执行到
  「备份镜像 `cokeai-app:pre-ring` + rsync 代码到生产」后被用户中断，
  `docker compose build app && up -d app` **未执行**，生产仍运行旧镜像；
  服务器源码目录已更新但未构建，**下次发布需先 build 再 up -d**。本地 dev /
  prod server 已停，临时脚本已清理
- 本次代码尚未 commit/push；GitHub Actions 未触发，是通过 SSH + rsync 直接发布的

## 自动化下单的真实边界

**能做到：**

- 每小时自动同步价格/库存/供货商链接
- 毛利不足或成本暴涨自动暂停商品
- 付款后自动生成采购单（商品、数量、客户填写、供货商链接）
- 一键复制采购信息、一键打开供货商页面
- 回填后自动交付给客户、自动生成订单时间线
- 缺货自动转退款、过期自动关闭、客户输入自动清除

**做不到（不是代码问题）：**

- `wzyp.cn` / `kapay.shop` 的店铺页是 SPA，带阿里云 ESA 滑块验证；
  没有公开下单 API，也没有给我们的账号授权。
- 直接调用它们的 `/shopApi/Pay/order` 属于绕过站点风控和未授权下单，**不做**。
- 自动付款需要供货商余额/API，不在当前能力范围内。

**因此人工只剩两步：** 在供货商页面付款、把卡密/账号回填到后台。
如果供货商以后提供正式 API 或商户账号，可在 `shop_product_sources` 之上增加
`auto_procurement` 连接器；schema 和状态机已经留好位置。

## 待办

- [x] 生产 VPS 迁移 `003_shop` / `003_personal_payments`
- [x] 导入并发布 6 个 n8n 工作流
- [x] 生产配置 `SHOP_*`、首次同步 250 offers
- [x] 生产导入 6 个精选商品草稿（未公开、未勾选合规）
- [x] 运营确认合规并上架 6 个商品（公开商品 6 个）
- [x] 重置管理员密码（服务器端随机生成，仅写入 `.admin-reset.txt`，含旧 hash 备份）
- [x] 配置个人支付宝收款码（2026-10-27 14:02 CST 上传并启用）
- [x] 放弃个人支付宝真实链路测试（2026-10-27 19:10 CST 运营决定改走加密货币；
      已停用个人支付宝、删除 ¥0.01 测试商品）
- [x] 配置 USDT TRC20 收款（2026-10-27 19:12 CST 生产启用；xpub + 首地址已配置，
      TronGrid API Key 暂未配置，使用低频无 key 查询）
- [ ] 真实小额 USDT 走一单（进行中：已建 `usdt-e2e-test` ¥7.30 测试商品，
      等待下单 → 转账 ≥1 USDT → 扫描确认 → 采购 → 交付 → 删除测试商品和订单）
- [ ] 清理过期个人支付宝测试订单 `CK20261027ACEC06A1`
      （19:37 已 `expired`，无付款申报/支付事件；商品已删除）
- [ ] 人工采购/交付/退款演练
- [ ] 接入易支付备用通道（代码已就绪但由 `SHOP_EASYPAY_ENABLED=false` 关闭；
      待持牌服务商网关/PID/KEY、签名模式、结算/冻结条款确认后填 `.env`，
      设 `SHOP_EASYPAY_ENABLED=true`，放行 WAF `/api/webhooks/easypay/shop`
      和 `/api/webhooks/easypay`）
- [ ] 税务、发票、数字商品条款文案由运营最终确认
- [ ] 供货商若提供正式 API，再接自动下单

## 关键文件

- 计划：`~/.claude/plans/gentle-rolling-wren.md`
- 抓取器：`tools/supplier-scraper/`
- 快照：`.local-data/supplier/aibijia/latest/`（已 gitignore）
- 数据层：`db/schema.sql` 末尾 `003_shop`
- 业务层：`src/lib/shop/`
- 用户页：`src/app/shop/`、`src/app/dashboard/shop/`
- 后台：`src/app/admin/shop/`
- 测试：`scripts/test-shop*.ts`

## 2026-10-28 23:48 CST 环形商品舞台 + 后台体感优化已发布

- 镜像：`cokeai-app:local` 由当前源码重建（构建已在此之前完成），
  `docker compose up -d app` 后 5 秒 `healthy`；回滚镜像 `cokeai-app:pre-ring`。
- 服务端自检：`/` 200（398ms 首查，含 `shop-ring-stage` 与小店上新标题）、
  `/shop` 200（54ms）、`/api/health` 200（9ms），近 3 分钟日志无 error/fail。
- 外网验证：`https://cokeai.cc.cd/` 返回 200 且 HTML 含环形舞台，但
  **正文 30 秒只收到 90KB 后被 curl 超时**；`/api/health` 20 秒连接超时。
  服务端 9ms，故瓶颈仍是「中国大陆 → Cloudflare 边缘」链路，而非应用/数据库；
  后台顶部进度条 + 骨架屏 + 15s 路由缓存只改善体感，不解决传输慢。
- 待评估加速：Cloudflare 优选 IP（当前偶发 `colo=GRU`）、香港/新加坡中转
  （CN2 GIA 反代）、或国内 CDN/EdgeOne（需备案，`.cc.cd` 不具备）。
- 后端、支付、订单、数据库、`/v1` 未改。

## 2026-10-29 00:07 CST 导航滚动 / 环形暂停 / 浮动导航修复

- **跳转后落在页面底部**：`globals.css` 的全局 `scroll-behavior: smooth` 会吞掉
  Next.js 路由切换时的滚动复位，导致新页面保留旧页面的 `scrollY`（页面较矮时
  看起来像“弹到底部”）。改为 `scroll-behavior: auto`；文档目录锚点改为瞬时跳转。
  本地实测：从首页 1600px 处点击 bento `/docs` 与导航 `/shop`，落地 `scrollY=0`。
- **环形商品不转**：原来暂停逻辑绑在整个 `.shop-collection` 上，桌面鼠标只要停在
  页面中部就永久 `hold=1`。改为仅在悬停/聚焦某张商品卡时暂停，指针离开卡片恢复；
  本地实测自由旋转 `true`、悬停卡片静止 `true`。
- **浮动导航跟随滚动**：`.site-header` 增加 `is-away` 状态，滚动超过 96px 向下时
  收起，向上滚动、鼠标到顶部 56px 内或键盘聚焦时重新出现；首屏保持可见。
  实测隐藏/触顶出现/移开再隐藏均通过。
- 生产已 rsync + `docker compose build app && up -d app`，5 秒 healthy；
  `/` 200（412ms，含环形）、`/shop` 200（69ms）、`/api/health` 200（29ms）。
  日志仅剩既有 `pricing-sync` 空模型白名单报错（待办 #10）。
  回滚镜像仍为 `cokeai-app:pre-ring`（本轮未另建备份）。
- 后端、支付、订单、数据库、`/v1` 未改。

## 2026-10-29 00:22 CST 价格透明化 + AI 在线客服

- **删除价格含糊话术**：移除首页、价格页的“价格随上游成本调整 / 以请求时为准 /
  以下单请求时为准”，页脚“价格以结算时为准”，小店营销区的“价格与库存以下单时
  页面为准”。改为“表内价格即结算价，按实际 Token 用量扣费”。法律条款页保留
  必要措辞未动。
- **价格表接真实价格**：`listCatalogModels()` 在实时定价表为空时回退到
  `models + upstreams`（仅 enabled 且已配置 Key 的模型），用与计费完全相同的
  `retailCnyPerMillion()` 计算展示价；没有缓存成本时显示“—”，不再显示 ¥0.00。
  当前生产只有 `deepseek-chat` 可售：输入 ¥2.42 / 输出 ¥3.63 每百万 Token。
  `gpt-4.1`、`gpt-4.1-mini` 因 OpenAI 上游未配置 Key 不展示，
  `deepseek-reasoner` 仍为 disabled。
- **降低毛利**：全部模型 `markup_bps` 由 18000 降为 12000（成本 ×1.2，毛利率约
  16.7%）；同步更新 `db/schema.sql` 默认值与 `PRICING_MARKUP_BPS` 代码默认值。
- **AI 在线客服**：aibijia.org 没有聊天组件，只有商品标题里提到“客服 QQ”，
  因此按常见客服浮窗自行实现。新增 `SupportWidget`（公共页右下角，Dashboard /
  Admin 不显示）与 `POST /api/support/chat`，复用现有 DeepSeek Chat 上游，注入
  实时模型价格与站点规则；限流 6 次/分钟、40 次/小时/IP，单条 600 字，失败回落
  到售后邮箱。桌面/390 无横向溢出，生产实测回复 708ms。
- 生产已 rsync + build + up -d，5 秒 healthy；`/pricing` 200（含 deepseek-chat
  价格行）、`/` 200（含客服按钮）、客服接口 200。后端、支付、订单、`/v1` 未改；
  数据库仅更新了 `models.markup_bps`。

## 2026-10-29 00:29 CST 模型目录升级到最新一代

- 实测生产 DeepSeek Key 的 `/models`：可用 `deepseek-flash`（V4.1 Flash，1M 上下文、
  支持图片）与 `deepseek-v4-pro`（V4 Pro，1M 上下文）。
- 生产已上线这两个模型，官方成本 $0.30/$1.20 与 $1.32/$3.96 每百万 Token，
  `markup_bps=12000`，页面价 ¥2.59/¥10.37 与 ¥11.40/¥34.21。
- `deepseek-chat`、`deepseek-reasoner` 已停用并从公开目录移除；旧 API Key 继续可用：
  `getGatewayModel()` 将旧 ID 透明映射到 `deepseek-flash` / `deepseek-v4-pro`。
- 客服默认模型改为 `deepseek-flash`；生产客服回复已按新目录列价。
- 最新一代 GPT / Gemini / Grok 已建档但保持 disabled，等上游 Key：
  `gpt-5.6`、`gpt-5.6-terra`、`gpt-5.6-luna`（openai，无 Key）、
  `gemini-3.8-flash`、`gemini-3.1-pro`（新增 gemini upstream，无 Key）、
  `grok-4.6`（新增 xai upstream，无 Key）。官方成本与 1.2 倍加价已录入。
- 当前 Sub2API 只有两个 mock-openai 账号，生产环境也没有 OpenAI / Anthropic /
  Google / xAI / OpenRouter 等 Key，所以 GPT 等暂时无法真实调用。Claude 还需要
  OpenAI 兼容中转（Anthropic 原生协议不兼容现有网关）。
- 验证：`/pricing` 与 `/` 均包含 deepseek-flash、deepseek-v4-pro，不再出现
  deepseek-chat；客服接口 200 且回答列出两个新模型。

## 2026-10-29 定价改为官方价 + 拿货价，新增客户公告栏

- **售价公式**：官方价取模型目录，拿货价取 `pricing_costs` 成本表。先按官方价
  让利 `PRICING_OFFICIAL_DISCOUNT_BPS`（默认 10%），再取下限
  `拿货价 / (1 - PRICING_MIN_MARGIN_BPS)`（默认 15% 毛利），两者取高。
  官方价缺失时回退到拿货价 × `PRICING_MARKUP_BPS`。
- **公开页与计费一致**：`computeRetailPrice()` 同时用于模型目录、`/v1/models`
  和实际扣费；`getGatewayModel()` 会带上按官方价与拿货价算出的
  `retail_input_cny_per_mtok` / `retail_output_cny_per_mtok`。
- **后台**：定价页说明改为“官方价 + 拿货价”，成本表只填真实拿货价，官方价由
  模型目录提供。
- **公告栏**：新增 `announcements` 表、`/announcements` 公开页、公共页顶部公告条
  （可关闭，关闭状态按公告版本记在浏览器）和 `/admin/announcements` 管理页，
  支持公告/更新/注意三种类型、置顶、开始/结束时间、打开/关闭和删除。
- 本地 `npm run typecheck`、`npm run build` 通过；尚未部署生产。

## 2026-10-29 USDT 支付二维码、10 分钟时限与自动取消

- **二维码**：充值与小店 USDT 结算页都显示 TRC20 收款地址二维码；二维码只含
  地址，金额在页面单独展示并提示手动输入，避免钱包 URI 兼容问题。
- **复制地址**：两处收款地址均提供一键复制按钮。
- **10 分钟支付窗口**：`USDT_QUOTE_MINUTES` 默认 10 且代码硬性上限 10 分钟；
  小店 USDT 订单的 `expires_at` 与报价同时到期，不再保留 24 小时支付窗口。
- **自动取消**：倒计时结束后客户端调用 `/api/dashboard/usdt-expire` 或
  `/api/shop/usdt-expire`；服务端先做最后一次链上确认，确认无到账才取消。
  n8n 每 5 分钟的扫描与过期任务作为页面关闭后的兜底。
- **安全边界**：已到账、确认中、部分付款、人工处理的订单不会被自动取消；
  扫描明确标记 `expired` 后才由定时任务清理，TronGrid 故障时保持待支付。
- 本地 `npm run typecheck`、`npm run build` 通过。

## 2026-10-29 01:35 CST USDT 支付上线与生产运维现状

### 合并与部署

- PR #3 `feat: add USDT QR, 10-minute payment deadline and auto-cancel` 已
  squash 合入 `main`（`1c6aafe`），并用 `rsync` + `docker compose build app`
  发布到生产；容器 5 秒内 `healthy`，镜像内已确认包含新的过期取消代码。
- 生产 `.env` 的 `USDT_QUOTE_MINUTES` 由 `30` 改为 `10`；代码另有 10 分钟硬上限，
  旧环境变量无法再把窗口拉长。
- **当前生产 `USDT_ENABLED=false`**，所以顾客端暂时看不到二维码、倒计时和复制
  地址。要真正启用，需要配置 xpub、打开开关，再跑一笔小额真实转账验证。

### 生产运维

- 生产 SSH 私钥是 `~/.ssh/cokeai_deploy`，不在 ssh-agent、也不在
  `~/.ssh/config`。必须显式使用：
  `ssh -i ~/.ssh/cokeai_deploy deploy@47.83.178.22`。默认身份会
  `Permission denied (publickey)`。
- Sub2API 容器健康，管理端 `http://127.0.0.1:18080/` 返回 200；公网打不开是
  设计如此，只能通过 SSH 隧道访问：
  `ssh -i ~/.ssh/cokeai_deploy -L 18080:127.0.0.1:18080 deploy@47.83.178.22`。
- 线上共 9 个容器：app、edge、postgres、redis、sub2api 及其独立 postgres/redis
  共 7 个带健康检查且为 `healthy`；cloudflared、n8n 没有 healthcheck，状态为
  `Up`。
- 2026-10-29 03:39 CST 复核：9 个容器仍在运行，公网 `/api/health` 返回 200，
  `USDT_ENABLED=false`、`USDT_QUOTE_MINUTES=10` 未变。

### 待确认：Cloudflare Tunnel 源站

- `docker-compose.yml` 注释要求公网源站指向 `http://edge:8080`，但线上实际仍
  指向 `http://app:3000`：
  - 公网 `/healthz` 返回 Next.js 404；服务器上 `edge:8080/healthz` 返回 200。
  - 公网 `/v1/models` 返回 CokeAI 自己的错误；`edge:8080/v1/models` 返回
    Sub2API 的 `API_KEY_REQUIRED`。
- 结论：Sub2API 目前不在公网请求链路上，`/v1` 仍由 Next.js 内置网关处理。
  切换前需要确认现有用户 Key 已同步到 Sub2API、计费不会中断，改动只在
  Cloudflare 面板，不在代码里。

### cloudflared 传输协议

- PR #4 将 cloudflared 固定为 `--protocol http2`（`docker-compose.yml`），
  避免小内存 VPS 上 QUIC 丢包导致的秒级卡顿。
- 从中国大陆经代理访问时仍会出现数秒到数十秒延迟，属于本地到 Cloudflare 边缘
  的链路问题；服务器侧公网自测 0.09–0.25s，应用和数据库不是瓶颈。

## 2026-10-29 08:39 CST 管理员账户与后台入口

### 账户

- 站点管理员是 `admin@cokeai.cc.cd`（`users.role='admin'`，状态 active），在
  `/login` 登录后进入 `/admin`。
- Sub2API 后台使用同一邮箱（`SUB2API_ADMIN_EMAIL`），但密码与站点密码相互独立。
- 两个密码分别在服务器 `.env` 的 `ADMIN_PASSWORD` 与 `SUB2API_ADMIN_PASSWORD`；
  不写入仓库，也不发送到聊天。

### 修改密码

- `scripts/seed.mjs` 只在用户不存在时创建管理员，直接改 `.env` 不会更新已有账号。
- 重置站点管理员密码：在服务器上读取新密码（不回显），在 app 容器内用 bcryptjs
  重算哈希并更新 `users.password_hash`。已验证容器内存在 `bcryptjs` 与 `pg`：

  ```bash
  cd /home/deploy/cokeai
  read -rsp "新密码（至少 10 位）: " NEWPASS; echo
  docker compose exec -T -e NEWPASS app node -e '
  const bcrypt = require("bcryptjs");
  const { Client } = require("pg");
  (async () => {
    if (!process.env.NEWPASS || process.env.NEWPASS.length < 10) {
      console.error("密码至少 10 位"); process.exit(1);
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const hash = await bcrypt.hash(process.env.NEWPASS, 12);
    const res = await client.query(
      "UPDATE users SET password_hash = $1 WHERE email = $2 AND role = $3 RETURNING email",
      [hash, process.env.ADMIN_EMAIL, "admin"]
    );
    console.log(res.rowCount ? "已更新: " + res.rows[0].email : "未找到管理员账户");
    await client.end();
  })().catch((e) => { console.error(e.message); process.exit(1); });
  '
  unset NEWPASS
  ```

- 重置 Sub2API 管理员密码：登录后台修改；`.env` 同样不会覆盖已存在管理员。
- 新增管理员：先确认对方已注册，再执行
  `UPDATE users SET role = 'admin' WHERE email = '...';`

### 入口

- 站点：https://cokeai.cc.cd/login
- Sub2API：仅监听 `127.0.0.1:18080`。先建隧道
  `ssh -i ~/.ssh/cokeai_deploy -L 18080:127.0.0.1:18080 deploy@47.83.178.22`，
  再访问 `http://127.0.0.1:18080/`。

## 2026-10-29 09:39 CST Sub2API 登录验证与网页版转 API 受阻

### 登录入口已核实

- 本机 18080 上已有隧道进程
  (`ssh -i ~/.ssh/cokeai_deploy -L 18080:127.0.0.1:18080 deploy@47.83.178.22`)，
  仍在运行，无需重建；进程退出后按同一命令重开。
- `http://127.0.0.1:18080/health` 返回 `{"status":"ok"}`，`/` 与 `/login`
  均 200，页面标题 `Sub2API - AI API Gateway`。
- `SUB2API_ADMIN_EMAIL=admin@cokeai.cc.cd`；`SUB2API_ADMIN_PASSWORD` 已设置
  （32 位），口令内容不读出、不写入仓库，需要时由运营在自己的终端查看。
- 后台管理接口在合规确认前返回 `423 ADMIN_COMPLIANCE_ACK_REQUIRED`，该确认只能
  由运营在界面上自行完成，不由自动化代点。

### 网页版 OpenAI 转 API（OAuth）当前不可用

- 症状：为账户创建 OAuth 授权链接后，浏览器打开
  `auth.openai.com/oauth/authorize?...` 返回
  `{"error":{"code":"unsupported_country_region_territory","type":"request_forbidden"}}`。
- 该错误由 OpenAI 授权端点直接返回，Sub2API 不产生这个错误码；同一时段
  Sub2API 日志没有 OAuth 失败记录。
- 生产出口实测：`47.83.178.22` → 香港（`country=HK`，AS45102 阿里云）。
  香港不在 OpenAI 支持区域。
- 客户端侧另有「自动测试软件正在控制 Chrome」的自动化标记，属于独立的判定因素。
- 关键结论：即便浏览器这一步拿到授权码，Sub2API 刷新 token 与转发请求都走同一
  香港出口，会再次被同样的地区检查拦下。因此该账号类型在当前部署上不可用，
  不是配置或代码缺陷。
- 边界：不做地区限制绕过（更换出口节点伪装地区、浏览器指纹伪装等），也不建议把
  订阅额度当作出售 API 的货源；`docs/SUB2API_OPERATIONS.md` 已要求
  「正式 API Key 或经书面授权的 OAuth」。
- 可行路径：接入各服务商官方 API Key，Key 在服务商后台生成后直接录入服务器，
  不经过聊天。渠道仍待运营确定，对应任务 #10。

### 生产复核

- 09:39 CST：9 个容器全部在运行，其中 7 个带健康检查且 `healthy`
  （cloudflared、n8n 无 healthcheck，状态 `Up`）；公网 `/api/health` 200；
  `USDT_ENABLED=false`、`USDT_QUOTE_MINUTES=10` 未变。

## 2026-10-29 10:39 CST taste-skill 安装与站点诊断

### 安装

- 仓库克隆到 `~/.claude/skills-src/taste-skill`，用仓库自带 `install.sh` 软链到
  `~/.claude/skills/design-taste-frontend`（install name 取自 SKILL.md 的 `name`）。
- 环境已核对：Node `v22.16.0`、本机 Chrome 均满足要求；`draw.mjs` 可运行。
- 更新方式 `cd ~/.claude/skills-src/taste-skill && git pull`；卸载用
  `./install.sh --uninstall`。
- 诊断产物目录 `.taste-skill/`（约 1.3MB 截图）已加入 `.gitignore`，不入库。

### 诊断结果（只读，未改任何代码）

- 首页 `https://cokeai.cc.cd`：**16 FAIL / 9 WARN**。
- `/pricing`：**11 FAIL / 5 WARN**。
- 单轮估算评分：设计 6 / 可用性 7 / 创意 7 / 内容 6（加权 40/30/20/10）≈ **6.5**。
- 截图与 `report.json` 在 `.taste-skill/before/` 与 `.taste-skill/before-pricing/`。
- 三个最影响分数的点：
  1. `name-only-title`：首屏 h1 只有店名与 slogan，没有一句 18px 以上的说明。
  2. 全站 0 张真实图片：无照片、无视频、无真实界面片段，全是 SVG 与绘制图形。
  3. 装饰层过厚：36 个静止阴影、22 条细线、19 个 1px 描边盒、12 个 eyebrow 标签、
     16 种字号、13 处毛玻璃；`/pricing` 把 Geist Mono 用在价格与模型名上。
- 注意：这套规则比 `landing-page-design` / `redesign-existing-projects` 更严
  （禁玻璃、禁静止阴影、禁细线、禁 01/02/03 序号），三方同时启用会互相打架。

### 定价口径（未执行，待运营决定）

- 已拒绝的方案：底层跑 DeepSeek、对客户宣称是 GPT 最新模型、按 GPT 价 75% 出售。
  理由：侵犯 OpenAI 商标；属于对客户的欺诈；且客户可从 `usage`、输出特征、
  知识截止等直接识别；同时该毛利结构只靠这层误认成立。
- DeepSeek 官方价（每百万 token，人民币）：`deepseek-flash` 缓存命中
  ¥0.02/¥0.04、输入未命中 ¥1/¥2、输出 ¥4/¥8（空闲/高峰各一半）；
  `deepseek-v4-pro` 缓存 ¥0.15/¥0.30、输入 ¥4.5/¥9、输出 ¥13.5/¥27。
  高峰为北京时间周一至周五 9:00–12:00、14:00–18:00，其余为空闲。
- 建议的诚实档位（沿用线上现价，约 25% 毛利）：快速 = DeepSeek V4.1 Flash
  ¥2.50/¥10.00；深度 = DeepSeek V4 Pro ¥11.20/¥33.50。
- 三个待选方案：(a) 如实标 DeepSeek；(b) 采购官方 GPT Key 后真卖 GPT；
  (c) 自有档位名 + 文档披露底层模型。运营尚未选择。
- 视觉是否按 taste-skill 完整重排，同样待定。

### 生产

- 本轮未发布、未改配置、未动数据库；仅新增 `.gitignore` 一条忽略规则。

## 2026-10-29 11:55 CST taste-skill 首页重做（product-performs）

### 回滚点

- 打标签 `rollback-pre-taste` 指向 `f33859c`（重做前 main），已推送到 GitHub：
  `git push git@github.com:cool-boy2024/cokeai.git refs/tags/rollback-pre-taste`。
- 本次工作在分支 `design/taste-rework`；不满意时 `git reset --hard rollback-pre-taste`
  即可回到旧首页。生产尚未发布。

### 方向与实现

- `draw.mjs` 掷出三个方向，选 `product-performs`（seed 1722170868）：
  页面本身就是产品在运行。方案给的 Jost 未采用——站点 95% 是中文，Jost 没有
  CJK 字形，继续用品牌自托管的 Geist Sans（拉丁/数字）+ PingFang SC（中文）。
  调色板照方案：炭黑 `#1c1c1c` / 面板 `#262626` / 墨白 `#f1f1ef` /
  鼠尾草 `#8fa68e`，一个强调色。
- 新增 `src/app/taste.css`（最后加载）：公共导航改成无边框无阴影平面栏；
  页脚改成 12 栏瓷片板；首页使用独立深色令牌，内页保持纸色。
- 首页 `src/app/page.tsx` 重写为七段：Hero（实时用量计费器）→ 接入地址
  （可改 Base URL，代码跟着变）→ 光纤实拍带 → 接入流程（四段滑块）→
  充值包（名称列表 + 单一大数字）→ 价目表（模型 + 商品两段列表）→
  常见问题（`<details name>` 手风琴）→ CTA（鼠尾草色场 + ¥0 挂牌）→ 瓷片页脚。
- 新增客户端组件：`CostMeter`、`EndpointDemo`、`StageSteps`、`PlanPicker`；
  删除旧首页专用组件 `HeroOrbit`、`ShopRing`、`HeroBrandStrip`、`TaglineReveal`、
  `brandMarks.ts`。
- 实数据：模型与价格走 `listCatalogModels()`（DeepSeek V4.1 Flash ¥2.54/¥10.16、
  DeepSeek V4 Pro ¥11.18/¥33.54 每百万 Token）；充值包走 `plans` 表（9.9/39/99）；
  商品走 `listPublicProducts()`。没有写死价格，也没有虚构客户或评价。

### 门禁与评审

- `inspect.mjs` 首页：改前 16 FAIL / 9 WARN（分数约 6.5），改后
  **0 FAIL / 4 WARN**（1440 / 768 / 390 三档）。
- 保留的 4 个 WARN 及理由：
  1. `size-count` 13 种字号：流体 `clamp()` 在三个断点展开所致，不是工具变量乱用。
  2. `no-footage`：没有与业务诚实的视频素材，不放循环氛围片。
  3. `font-not-dealt`：方案给的 Jost 无 CJK，中文页无法用；见上。
  4. `off-centre` 32px / 52px：差值来自计费器面板内右对齐数值（面板本身贴齐
     32px 页边距），不是页面整体偏移。
- 交互实测（CDP）：拖动 Token 滑块价格从 ¥1.02 变 ¥3.05；切换模型变 ¥12.86；
  选“专业包”价格变 99.00；改 Base URL 后 curl 示例同步变化；Python 标签切换；
  四段滑块切换话术；FAQ 手风琴展开；390px 下菜单可开、Escape 可关。
- 实拍照片（已在页脚署名）：
  - `public/media/fiber-light.jpg` — "Propagation of light through the core of an
    optical fiber"，AZToshkov，CC BY-SA 3.0，Wikimedia Commons。
  - `public/media/patch-panel.jpg` — "Fujikura optic fiber at Science Museum"，
    Syced，CC0，Wikimedia Commons。
- 评审（Awwwards 权重）：design 7.5 · usability 8.5 · creativity 7.5 · content 8.0
  → **7.85**。仍欠：首屏底部约五分之一留白（方案明确要求底部三分之一留白）；
  充值包标题到套餐名之间约 200px 空档；配线架照片在缩略尺寸下偏暗。

### 范围与后续

- 本轮只重做首页与公共导航/页脚；`/shop`、商品详情、`/pricing`、`/docs`、
  登录注册仍是旧的纸色样式。深色令牌只在首页作用域，内页不受影响。
- 若要整站统一，需要把 `public.css` 里的硬编码浅色（5 处 `#fff` 背景、
  14 处白色文字、渐变标题）逐页改掉，属于下一轮工作。
- 生产未发布、未改配置、未动数据库；本地只跑 `next build` + `next start -p 3010`。

### 合并与预览

- PR #10 三项 CI 全绿（build 2m15s、e2e 1m13s、compose-smoke 3m03s），
  squash 合并为 `bf7e6b6`；远端分支已删，本地 main 已同步，工作区干净。
- 本机预览用生产构建：`PORT=3010 npm run start` → http://localhost:3010。
- 回滚标签 `rollback-pre-taste` 仍指向 `f33859c`（annotated tag 已推 GitHub）。
- 待定两件事：① `/shop`、商品详情、`/pricing`、`/docs`、登录注册是否也转深色；
  ② 是否发布到生产。发布前先备份镜像 `cokeai-app:pre-taste`，回滚只需
  `docker tag cokeai-app:pre-taste cokeai-app:local && docker compose up -d app`。

## 2026-10-29 15:10 CST 商品重点注意事项、CLAUDE.md 与后台货源页整理

### 商品详情重点注意事项（PR #12，`4d7ea1b`，已合并，生产未发布）

- 新增 `src/lib/shop/notices.ts` 与 `src/components/shop/ProductNotices.tsx`，按
  `product_type` 生成 `代充 / 卡密 / 成品账号 / 通用` 四套模板；每套包含质保说明、
  下单或兑换前确认、处理期间要求、黄色警示块“以下情况不属于售后范围”，
  末尾追加该商品自己的 `customer_notice` / `refund_policy`。
- 商品页 `src/app/shop/[slug]/page.tsx` 插入区块；原底部重复的“购买须知 /
  售后说明”已并入，不再重复。
- 6 个商品页在 1440 / 390 验证：区块存在、无横向溢出、旧区块已移除。
- 未照搬 zyanai 的 20 元退费手续费；代充质保写成“非买家原因掉线优先补开，
  无法补开按剩余质保天数退款”，**待运营确认措辞**。
- 同轮修复首页导航“模型”无反应：`src/app/page.tsx` 恢复 `id="models"` 锚点。

### CLAUDE.md 与双人协作（PR #13，`1a296c5`）

- 根目录新增 `CLAUDE.md`：技术栈、目录、本地启动、常用命令、PR 规则、
  不可触碰项、验证要求、文档索引。仓库为私有，只有 owner 与受邀协作者可见。
- 与 `CONTRIBUTING.md` 一致：`main` 只接受 PR；免费私有仓库无法强制分支保护，
  靠双人自觉执行；Deploy 工作流仍只允许 owner 触发。
- 待办：伙伴的 GitHub 用户名尚未提供，**尚未发送 Maintain 邀请**；
  `.github/CODEOWNERS` 仍只有 `@cool-boy2024`。

### 后台货源页整理（PR #14 `f18f6d3`、PR #15 `3cde46e`）

- “店铺”表移到页面顶部并占满整行，“已映射”列不再被截断；“同步状态”移到店铺表
  之后，四项（数据源 / 上次同步 / 上次成功 / 条件请求）横向四列，≤980px 两列，
  ≤680px 单列。
- 英文枚举改中文：
  - 库存：`in_stock` 有货、`low_stock` 库存紧张、`out_of_stock` 缺货、
    `missing` 连续缺失；
  - 商品状态：`draft` 草稿、`active` 已上架、`paused` 已暂停、`archived` 已归档；
  - 同步状态：`partial` 部分成功、`failed` 失败；
  - `Offer` / `Offer 列表` → 货源条目 / 货源列表；未映射显示“未上架到小店”。
- 新增 `offerAvailabilityLabel` / `productStatusLabel` / `syncStatusLabel`
  （`src/lib/shop/copy.ts`）；库存徽标按状态着色。
- 验证：1440 / 390 无横向溢出，货源页与商品页中文标签正确。

### Scrapling 抓取复核（2026-10-29 14:41 CST）

- 运行 `tools/supplier-scraper/.venv/bin/python scraper.py --mode feed`：
  211 offers、143 available，SHA-256 与 offer_count 均匹配。
- 生产每小时同步仍由 Node 直接拉同一份公开 JSON（容器无 Python）；
  Scrapling 用于本地分析、选品和 HTML 交叉校验。
- 本地库 250 条 vs 当前 feed 211 条，差值为连续缺失记录，不自动删除。

### 2026-10-29 15:45 CST 生产发布 f79da63

- 发布前备份镜像：`docker tag cokeai-app:local cokeai-app:pre-taste`。
- 代码用 rsync 同步到 `deploy@47.83.178.22:/home/deploy/cokeai/`，排除
  `.git`、`.claude`、`.env*`、`node_modules`、`.next`、`.local-data`、
  `.taste-skill`、`tools`；服务器 `.env` 与 `.env.bak.pricing` 保留。
- `docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml build app`
  后 `up -d app`；app 启动即 healthy，日志显示迁移幂等、seed 就绪：
  `Database schema is up to date` / `Seed data is ready`。
- postgres、redis、sub2api、edge、cloudflared、n8n 均未重建，Sub2API 与 `/v1` 未动。
- 上线内容：首页 taste 深色版（首次发布）、商品介绍、重点注意事项、
  后台返回网站入口与中文标签。
- 公网检查：`/`、`/shop`、`/shop/chatgpt-pro-5x-1m`、`/pricing`、`/docs`、
  `/login` 均 200；`/nope-404` 404；`/opengraph-image` 200 `image/png`；
  `/v1/models` 401 JSON；Cloudflare `cf-cache-status: DYNAMIC`，
  新 CSS 含 `shop-facts`。
- 回滚：
  `docker tag cokeai-app:pre-taste cokeai-app:local && docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml up -d app`。

### 当前状态

- 首页已回滚到浅色旧版，且已发布生产；生产应用代码为 `9bd17d7`，
  main 另含后续文档提交。CI `build` / `e2e` / `compose-smoke` 全绿。
- 7 个真实商品 + 1 个测试商品，订单与余额未动；`USDT_ENABLED=false` 未变。
- 本地预览：`PORT=3010 npm run start` → http://127.0.0.1:3010（生产构建）。
- 待决定：`usdt-e2e-test` 是否归档；Gemini / Grok 新货源。
- GitHub 双人流程：`wjlwww` 已收到 write 邀请，等待接受；
  `.github/CODEOWNERS` 已包含两位维护者。
- 本机 `origin` 已改为 SSH `git@github.com:cool-boy2024/cokeai.git`；
  HTTPS fetch 会卡住，SSH push/fetch 正常。
- 既有待办不变：#16 USDT 真实小额走单、#18 过期支付宝测试单
  `CK20261027ACEC06A1`、#19 供货源同步观察、#33 USDT 支付启用。

### 2026-10-29 16:20 CST 商品介绍改为货源原文

- 商品详情页「商品介绍」改为直接渲染 `shop_products.description`，
  `white-space: pre-wrap` 保留货源页的换行与缩进；删除 `intro.ts` 里按
  商品类型生成的段落和「适合 / 需要你配合」模板。
- 新增 `scripts/shop-source-copy.ts`：按 slug 保存货源商品页
  「商品详情 / 宝贝详情」原文、来源 URL 与抓取日期；`shop-seed.ts`
  写入商品时优先使用这份原文，没有条目的商品继续用手写 description。
- 已采集三条：
  - `chatgpt-plus-1m-code` ← aibuji.com/item/51（Tokyo）
  - `claude-pro-1m-code` ← wzyp.cn/item/9q65u2（咕咕咕）
  - `claude-max-5x-1m` ← aibuji.com/item/127（Tokyo）
- 未采集：
  - `chatgpt-pro-5x-1m`：catfk.com/item/m30pw6，本机 Chrome 连接被重置；
    生产服务器 curl 可拿到 SPA 外壳，但服务器没有浏览器可渲染。
  - `gemini-pro-1y`：wzyp 商品页提示「商品未上架」。
  - `grok-super-1m`：aibuji 返回「该商品暂未上架」。
- 货源页为 Vue SPA，正文由前端渲染；连续请求后 wzyp 返回 403，
  正文只能低频人工复制，不做自动抓取。
- 后台商品编辑把「商品说明」标注为原样粘贴货源页，输入框加高到 12 行。
- 验证：`npm run typecheck`、`npm run build` 通过；1440 / 390 无横向溢出；
  三条原文长度 1273 / 1406 / 1732 字。
- PR #19（`feat/shop-source-copy`）已开，CI `build` / `e2e` / `compose-smoke` 全绿，
  尚未合并、未发布生产。
- 待确认：
  - 是否发布到生产。
  - 货源原文引用了图片（如「如下图」），目前只复制文字，图片未搬。
  - 结构化字段仍写「质保 7 天」，与部分货源表述不一致
    （chatgpt-plus 写「质保30天订阅」、claude-max 写「掉线按实际使用天数退款，
    封号不质保」）；改质保天数与退款口径属于运营决定。

### 2026-10-29 17:05 CST 货源文案全量同步、Muse 上架与质保口径

运营决定：Gemini、Grok 不下架，后续另找货源；其余商品按可查到的货源同步
说明、教程、注意事项和质保口径；新增 Muse；全部发布。

- 货源原文覆盖 7 个商品中的 5 个（`scripts/shop-source-copy.ts`）：
  - `chatgpt-plus-1m-code` ← aibuji.com/item/51（Tokyo）
  - `claude-pro-1m-code` ← wzyp.cn/item/9q65u2（咕咕咕）
  - `chatgpt-pro-5x-1m` ← wzyp.cn/item/l35pj1（启航AI，智利渠道）
    - 原货源 catfk.com/item/m30pw6 在本机被重置，改用同款智利渠道、
      现货、可渲染的条目；拿货价 ¥694.35，售价仍 ¥849，毛利 18.2%。
  - `claude-max-5x-1m` ← aibuji.com/item/127（Tokyo）
  - `muse-ai-310b-account` ← wzyp.cn/item/ho1whr（AI小店）
- ChatGPT Pro 5x 与 Claude Max 5x 的货源都是自助充值卡密（CDK / session），
  不再需要登录客户账号，因此 `product_type` 由 `topup` 改为 `giftcard`，
  删除「账号密码 / 两步验证」输入项，只交付卡密和教程；商品名改为
  「ChatGPT Pro 5x 月度卡密」「Claude Max 5x 月度卡密」，发货时效 10–60 分钟。
- 新增 Muse 商品：
  - slug `muse-ai-310b-account`，brand `muse`，成品账号，¥59 / 成本 ¥44.80 /
    毛利 24.1%；封面为墨色 `M` 字母标 + `Muse AI` 字样（自有字母标，
    不是官方 Logo 文件）。
  - 商品介绍按货源「商品详情」原文展示；登录方法、取码网站、
    风控提醒和 1 小时首登保障写入使用说明与重点注意事项。
  - 该货源没有进入聚合 feed（生产库标 `missing`），但 2026-10-29 直接打开
    货源页确认仍在售；因此库存由人工设为现货，货源记录在发布时标为停用，
    避免每小时同步把它改成「补货中」。feed 恢复后可重新启用货源。
- 质保口径改为按货源：
  - ChatGPT Plus：首登（质保开通），「订阅掉线与账号封禁不在质保范围」。
  - Claude Pro：无结构化天数，「掉订阅包赔；封号不质保」。
  - ChatGPT Pro 5x：30 天，「质保一个月订阅，掉订阅可按比例退款」。
  - Claude Max 5x：无结构化天数，「订阅掉线按实际使用天数计算退款，
    账号封禁不质保」。
  - Muse：首登，「登录保障仅持续 1 小时，一旦能够登录账号，保障即失效」。
  - Gemini、Grok：货源页已下架，暂保留原本文案与 7 天字段，待新货源后替换。
- 删除 `src/lib/shop/notices.ts` 的按类型生成模板；「重点注意事项」只渲染
  商品的 `customer_notice` 与 `refund_policy`，不再自动生成质保、24 小时兑换、
  1 分钟换绑等本站承诺。后台可编辑这两个字段。
- 数据库：
  - `shop_products` 新增 `warranty_note TEXT NOT NULL DEFAULT ''`，
    有值时优先于「质保 X 天」显示，卡片和详情用短标签，商品介绍用全文。
  - `brand` 约束加入 `muse`；`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
    与约束重建在同一份 `db/schema.sql`，容器启动幂等执行。
  - 后台商品编辑新增「质保说明（按货源原文）」输入框。
- 生产文案同步工具：
  - `npm run shop:content` 把种子目录导出为 `scripts/shop-content.json`。
  - `npm run shop:publish` 只改公开文案与展示字段，已存在商品的状态、售价、
    库存、合规确认全部保留；`--publish-new` 才创建新商品并写入管理员合规确认，
    生产环境必须带 `--confirm-production`，支持 `--dry-run`。
  - 本地已跑 `db:migrate` → `shop:seed` → `shop:content` → `shop:publish`，
    7 个商品全部 active，7 条货源映射有效。
- 验证：
  - `npm run typecheck`、`npm run build` 通过。
  - 7 个商品详情页 200；1440 / 390 无横向溢出。
  - 货源原文长度（连续空行已压成一个）：1273 / 1394 / 456 / 1732 / 425 字；
    Gemini 75、Grok 55 仍为原手写说明。
  - 截图检查：Muse 列表卡、详情首屏、重点注意事项、移动端 390。
- GitHub 协作：已向 `wjlwww` 发出写入权限邀请（个人仓库不支持 maintain 角色），
  `.github/CODEOWNERS` 已改为 `* @cool-boy2024 @wjlwww`；对方接受后生效。
- 待办：
  - 合并 PR、发布生产并执行 `shop:publish`（发布前先备份 shop_products 相关表）。
  - Gemini、Grok 找到新货源后替换文案与质保口径。
  - 货源原文引用的图片仍未搬运；Muse 仅有字母标，未使用官方 Logo。

### 2026-10-29 17:20 CST 生产发布 162db8b

- PR #19 squash 合并为 `162db8b`，CI `build` / `e2e` / `compose-smoke` 全绿。
- 发布前备份：
  - 镜像 `cokeai-app:local` → `cokeai-app:pre-muse`
  - `shop_products` + `shop_product_sources` →
    `/home/deploy/backups/cokeai-shop-pre-muse-20261029-171544.sql`
- rsync `main` 到 `/home/deploy/cokeai`，`docker compose … build app && up -d app`；
  app 启动即 healthy，日志 `Database schema is up to date` / `Seed data is ready`。
- 在 app 容器执行 `node scripts/shop-publish.mjs --confirm-production --publish-new`：
  updated 6 / created 1 / linked 7。Muse active、in_stock，货源记录停用；
  Pro 5x 货源切到 wzyp l35pj1（active），旧 catfk 源停用。
- 首次执行报 `compliance_ack_by is of type uuid but expression is of type text`，
  已在脚本里补 `$22::uuid`；为不阻塞发布，先把修复后的脚本 `docker cp` 进运行中的
  容器完成发布，随后用单独 PR 把修复带回 main 并重建镜像。
- 17:34 CST 修复 PR #20 合并为 `14cc70f`，rsync + 重建 app；容器内脚本已含
  `$22::uuid`，`shop:publish --dry-run` 通过（updated 7 / created 0），
  页面继续 200，数据库文案未回退。
- 生产核对：
  - `/shop` 与 6 个详情页 200；Muse 显示现货、货源原文、1 小时首登；
    Pro 5x 显示「月度卡密」且没有账号密码/两步验证输入；Claude Max 同理。
  - 7 个真实商品：Plus / Claude Pro in_stock；Pro 5x / Claude Max low_stock；
    Gemini availability=paused、Grok out_of_stock，均仍在列表显示「补货中」。
  - 生产数据库仍有 `usdt-e2e-test`（USDT 链路测试商品，¥7.30）active，
    且出现在公开列表；本次未删除，待运营决定是否归档。
- 回滚：`docker tag cokeai-app:pre-muse cokeai-app:local && up -d app`；
  数据用上面的 pg_dump 恢复两张表。

### 2026-10-29 17:50 CST 首页回滚到浅色版

- 运营查看生产首页后确认不要 taste-skill 深色版，要求回滚到旧版浅色首页。
- 只回滚首页视觉：`page.tsx`、`layout.tsx`、`SiteNav`、`SiteFooter` 和旧首页组件
  （HeroOrbit / HeroBrandStrip / ShopRing / TaglineReveal / brandMarks）恢复到
  `f33859c`；删除 `taste.css`、CostMeter / EndpointDemo / PlanPicker / StageSteps
  以及两张首页照片。
- 商品、Muse、货源文案、后台、支付、订单全部保留；首页小店文案补上 Muse。
- 验证：typecheck / build 通过；`/`、`/shop`、Muse 详情页、`/pricing`、`/docs`
  在 1440 / 390 无横向溢出；导航、页脚恢复浅色。
- 已合并 PR #23（`7f30a78`）并 rsync + `docker compose build app && up -d app`
  发布；发布前备份镜像 `cokeai-app:pre-light-rollback`。生产 `/`、`/shop`
  200，首页恢复浅色。

### 2026-10-29 18:41 CST Muse 后续待办与安全边界

- **Muse 封面 Logo**：运营发来 Meta Muse 蓝色波浪 “M” 截图（约 `#0866FF`），
  要求替换现有纯字母 M。尚未实现：`ai.meta.com` 与 `vectorseek.com` 被
  WebFetch 拒绝，vectorseek ZIP 下载不完整（77,809 / 388,636 字节），
  本机无 potrace / ImageMagick / PIL 可描摹。下一步需取得官方 SVG，或按
  截图重绘内联 SVG 后改 `ProductCover.tsx` 与 `.shop-cover-muse`。
- **zyanai 货源**：运营要求 Muse 产品参照 `https://zyanai.cc/`。首页是
  JS 模板壳，商品由 `/user/api/index/data` 与
  `/user/api/index/commodity?categoryId=251` 加载。已确认分类 `251 = muse AI`，
  共 2 个商品：
  - `/item/442` 成品号：10 亿 ¥15/20/25；310 亿 ¥25/60/88，分别对应
    1 小时 / 7 天 / 1 个月售后；标现货充足、自动发货，交付邮箱 + 接码地址，
    要求首登 1 小时内换绑自己的 Gmail / Hotmail 并移除原邮箱。
  - `/item/500` 邀请卡密：10 次 ¥12、30 次 ¥26，代开通，客户提供 Muse
    账号 6 位邀请码，不需要账号密码。
  这些是零售价，不是批发价：310 亿 7 天档 ¥60，低于/接近我们 ¥44.8 成本
  加售后后的合理售价，直接转卖没有利润；1 个月档 ¥88 也一样。因此不建议
  照搬其 SKU 与价格；如需 7 天/1 个月质保，应另找批发货源。不得整段复制
  对方受版权保护的营销文案。
- **Sub2API 密码**：运营要求直接给出密码以便自行修改。密码不在聊天、
  文档或仓库中出现。可用方式：运营自己在服务器上读取 `.env`，或在服务器
  侧重置为随机值并写入 `0600` 文件后由运营读取；Sub2API 后台仍只经
  SSH 隧道 `127.0.0.1:18080` 访问，合规确认由运营本人点击。
- **子代理**：运营要求“开多个子代理”；此前并行发起的 3 个子代理
  （zyanai 调研、Muse Logo、Sub2API 密码流程）均被拒绝，未重试。
- 其余不变：`usdt-e2e-test` 仍 active 且公开；Gemini / Grok 待新货源；
  货源图片未搬；`wjlwww` write 邀请待接受。

### 2026-10-29 18:58 CST 下单页增加联系邮箱、购买数量与人机验证

- 商品详情第二步（选择支付方式）新增三个字段：
  - **联系邮箱**：必填，默认取当前登录用户邮箱；校验格式与长度，存入
    `customer_input_encrypted` 的 `contactEmail`（AES 加密，交付后 7 天清除）。
  - **购买数量**：1 到 `SHOP_MAX_QTY`，默认 1；显示单价、件数和合计，
    服务端二次校验整数与上限，订单金额 = 单价 × 数量。
  - **人机验证**：`GET /api/shop/captcha` 返回 4 位 SVG 字符图 + HMAC 签名
    token（`APP_ENCRYPTION_KEY` 派生，5 分钟有效）；提交时服务端验签、比对
    字符，并用 Redis 记录 nonce 防重放。Redis 不可用时仍校验签名与有效期。
- 订单写入：`shop_orders.subtotal_micros` / `amount_micros` 改为合计；
  `shop_order_items.qty` 写实际数量，`supplier_cost_micros` 写该行总成本；
  采购队列、后台毛利、USDT / 易支付金额都直接使用合计，无需改表结构。
- `SHOP_MAX_QTY` 代码默认值与 `.env.example` 从 `1` 改为 `5`。**生产 `.env`
  若显式写了 `SHOP_MAX_QTY=1`，需要运营改成 5 后重启 app；否则下单页仍显示
  最多 1 件。**
- 验证：`npm run typecheck`、`npm run build` 通过；`npm run test:shop` 通过
  （新增 qty=2 金额/数量/联系邮箱断言与超限拒绝）；本地 3011 实测验证码
  签名正确、重放被拒、错误验证码端到端返回“验证码错误或已过期”；1440 / 390
  下单面板无横向溢出，数量加到 3 时合计显示 ¥177.00。
- 未改支付回调、订单状态机、USDT 扫描与数据库结构；未提交真实订单。
- **2026-10-29 19:05 CST 已合并 `72b2847` 并发布生产**：发布前镜像备份
  `cokeai-app:pre-checkout-fields`；生产 `.env` 的 `SHOP_MAX_QTY` 由 1 改为 5，
  原文件备份为 `.env.bak.shop-qty-20261029`（均为 `0600 deploy:deploy`）。
  rsync + build + up 后 app healthy；公网 `/api/health` 200、
  `/shop/muse-ai-310b-account` 200、`/api/shop/captcha` 返回 token + SVG。

### 2026-10-29 19:15 CST Muse 封面换成官方 Logo

- 素材来自 Muse 官网实际使用的
  `https://muse.ai/images/landing/brand/muse-logo.svg`，与 Wikimedia Commons
  `File:Muse_icon.svg` 的 SHA256 一致：
  `e3fc40d72c2d4574bcde117e5e7213d8de0e10516784fe8e43c5a02a88e63844`。
  官方图形是单条填充轮廓 + 三段蓝色渐变（`#0082FB → #0064E0 → #0040DC`），
  不是三根圆头描边；已保存为 `public/brand/muse-logo.svg`。
- `ProductCover.tsx` 在 `key === "muse"` 时渲染该 SVG，替换原来的纯字母 M；
  保留 `Muse AI` caption。封面配色由深色改为浅蓝底 `#eef3ff`，避免官方渐变
  暗端在深底上对比不足；列表卡 / 精选卡 / 详情页分别使用 72 / 96 / 120px，
  移动端详情 88px，环形卡 44px。
- 商标说明：Wikimedia 标注 PD-textlogo 不等于商标授权；该 Logo 只用于识别
  Muse 商品，不作为 CokeAI 自身 Logo，也不暗示 Meta 官方合作或背书。
- 验证：typecheck / build 通过；本地 1440 列表卡与详情封面显示正常，
  `naturalWidth/Height = 100/100`，无横向溢出。
- **2026-10-29 19:22 CST 已合并 `9bd17d7` 并发布生产**：发布前镜像备份
  `cokeai-app:pre-muse-logo`；rsync + build + up 后 app healthy。公网
  `/brand/muse-logo.svg` 200 `image/svg+xml`，
  `/shop/muse-ai-310b-account` 200。
