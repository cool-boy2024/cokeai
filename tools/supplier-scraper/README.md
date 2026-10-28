# 供货商数据抓取（Scrapling）

抓取 [aibijia.org](https://aibijia.org/) 公开的 AI 订阅比价数据，给 CokeAI 小店的
“成本 / 库存 / 供货商链接”同步使用。

## 边界

只访问公开、无需登录的数据：

- `https://aibijia.org/live-data/meta.json`
- `https://aibijia.org/live-data/products.json`
- `https://aibijia.org/`（HTML 交叉校验）

不做的事：

- 不登录任何供货商账号；
- 不解阿里云 ESA、Cloudflare Turnstile 等验证码；
- 不抓需要登录/验证码的商品详情页；
- 不自动下单、不自动付款。

`wzyp.cn`、`kapay.shop` 等店铺页面是 Vue SPA，且带阿里云 ESA 滑块验证，
静态请求只能拿到验证页。这是供应商侧的风控，不是本工具能“优化”的部分。
采购仍由运营在浏览器里确认下单；CokeAI 负责把商品、价格、库存、采购链接
和交付模板准备好，把人工步骤压到“付款 + 回填交付内容”。

## 安装

```bash
cd tools/supplier-scraper
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/scrapling install
# patchright 的浏览器版本与 scrapling install 的缓存可能不一致，补一次：
.venv/bin/patchright install chromium
```

macOS 上 `camoufox fetch` 下载较慢，可跳过；`StealthyFetcher` 默认走 patchright。

## 运行

```bash
.venv/bin/python scraper.py              # JSON feed + HTML 交叉校验
.venv/bin/python scraper.py --mode feed  # 只抓 JSON，最快
.venv/bin/python scraper.py --out /tmp/aibijia
```

输出到 `.local-data/supplier/aibijia/<UTC 时间戳>/`：

| 文件 | 内容 |
|---|---|
| `meta.raw.json` | 供货商元数据、商品数、offer 数、SHA-256 |
| `products.raw.json` | 原始 `products.json` 快照 |
| `offers.jsonl` | 标准化后的每个 offer（成本、库存、链接、风险标记） |
| `summary.json` | 按商品/店铺/状态/价格分位统计 + 数据质量检查 |
| `candidates.json` | 内部选品候选，按“文案可改写程度”排序 |
| `html-check.json` | JSON 与 HTML 页面 offer 数对比 |
| `latest` | 指向最近一次快照的软链接 |

## 字段说明

- `external_key = sha256(url + 0x1f + source_title)`：同一 URL 可能挂多个不同标题/价格的
  offer，只用 URL 会丢数据；价格不参与 key，涨价后仍是同一条记录。
- `availability`：`in_stock / low_stock / out_of_stock`，与 aibijia 一致。
- `flags`：`account_sale`、`shared`、`temp_warranty`、`offsite_contact`、
  `absolute_claim`、`reverse_proxy` 等，只用于内部选品，不对外展示。
- `curation_score`：0–100，越高越容易改写成干净的商品文案；不是价格指标。

## 与商城同步的关系

生产环境的每小时同步由 Node 侧 `src/lib/shop/sync.ts` 直接拉 JSON 完成，
不依赖 Python 常驻进程。本工具用于：

1. 人工分析供货商结构、选品、价格分位；
2. 生成测试 fixture；
3. 需要时用 Scrapling 做 HTML 交叉校验（适配站点改版）。

公开页面永远不展示供货商 `source_title`、店铺名、成本、毛利或原始链接。
