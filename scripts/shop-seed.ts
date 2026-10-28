import { loadEnv } from "./env.mjs";

loadEnv();

type SeedProduct = {
  slug: string;
  brand: "chatgpt" | "claude" | "gemini" | "grok";
  category: "subscription" | "account" | "topup" | "giftcard";
  productType: "subscription" | "account" | "topup" | "giftcard";
  name: string;
  subtitle: string;
  description: string;
  cover: string;
  price: number;
  etaMin: number;
  etaMax: number;
  warrantyType: "first_login" | "days" | "none";
  warrantyDays: number;
  includes: string[];
  usage: string[];
  notice: string;
  refund: string;
  inputFields: Array<Record<string, unknown>>;
  featured: boolean;
  sort: number;
  offer: { store: string; titleLike: string };
};

const PRODUCTS: SeedProduct[] = [
  {
    slug: "chatgpt-plus-1m-code",
    brand: "chatgpt",
    category: "giftcard",
    productType: "giftcard",
    name: "ChatGPT Plus 月度卡密",
    subtitle: "开通卡密，按说明自助兑换 1 个月 Plus",
    description:
      "适用于自己的 ChatGPT 账号。下单后由客服发送开通卡密和兑换说明，按步骤在指定渠道完成开通，无需提供账号密码。",
    cover: "chatgpt",
    price: 169,
    etaMin: 10,
    etaMax: 60,
    warrantyType: "days",
    warrantyDays: 7,
    includes: ["ChatGPT Plus 1 个月开通卡密", "图文兑换说明", "订单售后记录"],
    usage: [
      "付款后在订单页点击“查看卡密”",
      "确认登录的是自己的 ChatGPT 账号，再按说明完成兑换",
      "兑换成功后回到订单页确认结果",
      "如兑换失败，请保留页面截图并联系在线客服",
    ],
    notice:
      "数字商品，发货后不支持无理由退款。请在收到卡密后 24 小时内完成兑换，逾期未兑换产生的失效风险由买家承担。",
    refund:
      "卡密未使用且兑换失败，经核实可补发或退款；已成功兑换的订单不支持退款。",
    inputFields: [
      {
        key: "chatgpt_email",
        label: "ChatGPT 登录邮箱",
        placeholder: "用于核对账号，不会用于登录",
        type: "text",
        required: true,
        maxLength: 200,
      },
    ],
    featured: true,
    sort: 10,
    offer: { store: "Tokyo", titleLike: "%GPT PLUS%渠道1:质保开通卡密%" },
  },
  {
    slug: "claude-pro-1m-code",
    brand: "claude",
    category: "giftcard",
    productType: "giftcard",
    name: "Claude Pro 月度卡密",
    subtitle: "开通卡密，按说明自助兑换 1 个月 Claude Pro",
    description:
      "适用于自己的 Claude 账号。下单后由客服发送开通卡密和兑换说明，按步骤完成开通，无需提供账号密码。",
    cover: "claude",
    price: 199,
    etaMin: 10,
    etaMax: 60,
    warrantyType: "days",
    warrantyDays: 7,
    includes: ["Claude Pro 1 个月开通卡密", "图文兑换说明", "订单售后记录"],
    usage: [
      "付款后在订单页点击“查看卡密”",
      "确认登录的是自己的 Claude 账号，再按说明完成兑换",
      "兑换成功后回到订单页确认结果",
      "如兑换失败，请保留页面截图并联系在线客服",
    ],
    notice:
      "数字商品，发货后不支持无理由退款。请在收到卡密后 24 小时内完成兑换，逾期未兑换产生的失效风险由买家承担。",
    refund:
      "卡密未使用且兑换失败，经核实可补发或退款；已成功兑换的订单不支持退款。",
    inputFields: [
      {
        key: "claude_email",
        label: "Claude 登录邮箱",
        placeholder: "用于核对账号，不会用于登录",
        type: "text",
        required: true,
        maxLength: 200,
      },
    ],
    featured: true,
    sort: 20,
    offer: { store: "咕咕咕", titleLike: "%Claude Pro%卡密可囤%" },
  },
  {
    slug: "chatgpt-pro-5x-1m",
    brand: "chatgpt",
    category: "topup",
    productType: "topup",
    name: "ChatGPT Pro 5x 月度代充",
    subtitle: "1 个月 Pro 5x，登录你的账号完成充值",
    description:
      "由人工登录你的 ChatGPT 账号完成 Pro 5x 月度订阅充值。下单后请填写账号信息，客服会在发货时效内处理。",
    cover: "chatgpt-pro",
    price: 849,
    etaMin: 30,
    etaMax: 180,
    warrantyType: "days",
    warrantyDays: 7,
    includes: ["ChatGPT Pro 5x 1 个月订阅", "充值完成通知", "7 天售后支持"],
    usage: [
      "下单时填写 ChatGPT 登录邮箱、密码和可用的两步验证信息",
      "充值期间请保持账号可登录，不要修改密码或切换地区",
      "到账后建议立即修改密码并检查登录设备",
      "如 3 小时未到账，请联系在线客服",
    ],
    notice:
      "该商品需要登录你的账号完成代充。账号信息使用 AES-256-GCM 加密保存，交付完成 7 天后自动清除，仅用于本次充值。",
    refund:
      "未开始代充可全额退款；已到账不支持退款。24 小时内未到账，经核实可全额退款。",
    inputFields: [
      {
        key: "account_email",
        label: "ChatGPT 登录邮箱",
        placeholder: "name@example.com",
        type: "text",
        required: true,
        maxLength: 200,
      },
      {
        key: "account_password",
        label: "账号密码",
        placeholder: "仅用于本次代充",
        type: "password",
        required: true,
        maxLength: 200,
        help: "加密保存，交付完成 7 天后自动清除。",
      },
      {
        key: "two_factor",
        label: "两步验证 / 备用码（如有）",
        placeholder: "没有可留空",
        type: "text",
        required: false,
        maxLength: 300,
      },
    ],
    featured: false,
    sort: 30,
    offer: { store: "山姆AI", titleLike: "%Pro5x 1个月%正规代充%" },
  },
  {
    slug: "claude-max-5x-1m",
    brand: "claude",
    category: "topup",
    productType: "topup",
    name: "Claude Max 5x 月度代充",
    subtitle: "1 个月 Max 5x，登录你的账号完成充值",
    description:
      "由人工登录你的 Claude 账号完成 Max 5x 月度订阅充值。下单后请填写账号信息，客服会在发货时效内处理。",
    cover: "claude-max",
    price: 1099,
    etaMin: 30,
    etaMax: 180,
    warrantyType: "days",
    warrantyDays: 7,
    includes: ["Claude Max 5x 1 个月订阅", "充值完成通知", "7 天售后支持"],
    usage: [
      "下单时填写 Claude 登录邮箱、密码和可用的两步验证信息",
      "充值期间请保持账号可登录，不要修改密码或切换地区",
      "到账后建议立即修改密码并检查登录设备",
      "如 3 小时未到账，请联系在线客服",
    ],
    notice:
      "该商品需要登录你的账号完成代充。账号信息使用 AES-256-GCM 加密保存，交付完成 7 天后自动清除，仅用于本次充值。",
    refund:
      "未开始代充可全额退款；已到账不支持退款。24 小时内未到账，经核实可全额退款。",
    inputFields: [
      {
        key: "account_email",
        label: "Claude 登录邮箱",
        placeholder: "name@example.com",
        type: "text",
        required: true,
        maxLength: 200,
      },
      {
        key: "account_password",
        label: "账号密码",
        placeholder: "仅用于本次代充",
        type: "password",
        required: true,
        maxLength: 200,
        help: "加密保存，交付完成 7 天后自动清除。",
      },
      {
        key: "two_factor",
        label: "两步验证 / 备用码（如有）",
        placeholder: "没有可留空",
        type: "text",
        required: false,
        maxLength: 300,
      },
    ],
    featured: false,
    sort: 40,
    offer: { store: "Tokyo", titleLike: "%Claude MAX5x/20x%· 5x%" },
  },
  {
    slug: "gemini-pro-1y",
    brand: "gemini",
    category: "topup",
    productType: "topup",
    name: "Gemini Pro 年度代充",
    subtitle: "12 个月 Google AI Pro，登录你的账号完成开通",
    description:
      "由人工登录你的 Google 账号完成 Gemini Pro（Google AI Pro）年度订阅开通。下单后请填写账号信息，客服会在发货时效内处理。",
    cover: "gemini",
    price: 49,
    etaMin: 30,
    etaMax: 240,
    warrantyType: "days",
    warrantyDays: 7,
    includes: ["Gemini Pro 12 个月订阅", "开通完成通知", "7 天售后支持"],
    usage: [
      "下单时填写 Google 登录邮箱、密码和可用的两步验证信息",
      "开通期间请保持账号可登录，不要修改密码",
      "到账后建议立即修改密码并检查登录设备",
      "如 4 小时未到账，请联系在线客服",
    ],
    notice:
      "该商品需要登录你的 Google 账号完成开通。账号信息使用 AES-256-GCM 加密保存，交付完成 7 天后自动清除。",
    refund:
      "未开始开通可全额退款；已开通不支持退款。24 小时内未到账，经核实可全额退款。",
    inputFields: [
      {
        key: "account_email",
        label: "Google 登录邮箱",
        placeholder: "name@gmail.com",
        type: "text",
        required: true,
        maxLength: 200,
      },
      {
        key: "account_password",
        label: "账号密码",
        placeholder: "仅用于本次开通",
        type: "password",
        required: true,
        maxLength: 200,
        help: "加密保存，交付完成 7 天后自动清除。",
      },
      {
        key: "two_factor",
        label: "两步验证 / 备用码（如有）",
        placeholder: "没有可留空",
        type: "text",
        required: false,
        maxLength: 300,
      },
    ],
    featured: false,
    sort: 50,
    offer: { store: "AI小店", titleLike: "%Gemini Pro 一年代充会员%" },
  },
  {
    slug: "grok-super-1m",
    brand: "grok",
    category: "topup",
    productType: "topup",
    name: "Grok Super 月度代充",
    subtitle: "1 个月 SuperGrok，登录你的 X 账号完成充值",
    description:
      "由人工登录你的 X 账号完成 SuperGrok 月度订阅充值。下单后请填写账号信息，客服会在发货时效内处理。",
    cover: "grok",
    price: 269,
    etaMin: 30,
    etaMax: 240,
    warrantyType: "days",
    warrantyDays: 7,
    includes: ["SuperGrok 1 个月订阅", "充值完成通知", "7 天售后支持"],
    usage: [
      "下单时填写 X 登录邮箱、密码和可用的两步验证信息",
      "充值期间请保持账号可登录，不要修改密码或切换地区",
      "到账后建议立即修改密码并检查登录设备",
      "如 4 小时未到账，请联系在线客服",
    ],
    notice:
      "该商品需要登录你的 X 账号完成代充。账号信息使用 AES-256-GCM 加密保存，交付完成 7 天后自动清除。",
    refund:
      "未开始代充可全额退款；已到账不支持退款。24 小时内未到账，经核实可全额退款。",
    inputFields: [
      {
        key: "account_email",
        label: "X 登录邮箱",
        placeholder: "name@example.com",
        type: "text",
        required: true,
        maxLength: 200,
      },
      {
        key: "account_password",
        label: "账号密码",
        placeholder: "仅用于本次代充",
        type: "password",
        required: true,
        maxLength: 200,
        help: "加密保存，交付完成 7 天后自动清除。",
      },
      {
        key: "two_factor",
        label: "两步验证 / 备用码（如有）",
        placeholder: "没有可留空",
        type: "text",
        required: false,
        maxLength: 300,
      },
    ],
    featured: false,
    sort: 60,
    offer: { store: "Tokyo", titleLike: "%Grok Super 30美刀%" },
  },
];

async function main() {
  const draftOnly = process.argv.includes("--draft");
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && draftOnly && !process.argv.includes("--confirm-production")) {
    throw new Error(
      "生产环境只允许以草稿方式导入（--draft --confirm-production）；不会自动上架或代勾合规确认",
    );
  }
  if (isProduction && !draftOnly && !process.argv.includes("--force")) {
    throw new Error(
      "shop:seed 是本地演示数据，生产环境请从后台创建商品并经人工合规确认；确认要写入请加 --force",
    );
  }
  const { query } = await import("../src/lib/db");
  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const product of PRODUCTS) {
    if (draftOnly) {
      const existing = await query<{ id: string }>(
        "SELECT id FROM shop_products WHERE slug = $1",
        [product.slug],
      );
      if (existing.rows[0]) {
        console.log(`skip ${product.slug}: already exists`);
        skipped += 1;
        continue;
      }
    }
    const offerResult = await query<{
      id: string;
      price_micros: string;
      availability: string;
      source_title: string;
      source_store: string;
    }>(
      `SELECT id, price_micros, availability, source_title, source_store
         FROM shop_offers
        WHERE source_store = $1 AND source_title ILIKE $2
        ORDER BY last_seen_at DESC
        LIMIT 1`,
      [product.offer.store, product.offer.titleLike],
    );
    const offer = offerResult.rows[0];
    if (!offer) {
      console.warn(`skip ${product.slug}: offer not found (${product.offer.store} ${product.offer.titleLike})`);
      continue;
    }

    const priceMicros = product.price * 1_000_000;
    const availability =
      offer.availability === "in_stock" || offer.availability === "low_stock"
        ? offer.availability
        : "out_of_stock";
    const autoPublish = !draftOnly;
    const result = await query<{ id: string }>(
      `INSERT INTO shop_products
         (slug, brand, category, product_type, name, subtitle, description,
          cover_variant, price_micros, delivery_method, eta_min_minutes,
          eta_max_minutes, warranty_type, warranty_days, includes, usage_notes,
          customer_notice, refund_policy, input_fields, status, availability,
          copy_ready, compliance_ack_at, featured, sort_order, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12,$13,
               $14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19,$20,
               TRUE, CASE WHEN $21 THEN now() ELSE NULL END, $22, $23,
               CASE WHEN $24 THEN now() ELSE NULL END)
       ON CONFLICT (slug) DO UPDATE SET
         brand = EXCLUDED.brand,
         category = EXCLUDED.category,
         product_type = EXCLUDED.product_type,
         name = EXCLUDED.name,
         subtitle = EXCLUDED.subtitle,
         description = EXCLUDED.description,
         cover_variant = EXCLUDED.cover_variant,
         price_micros = EXCLUDED.price_micros,
         eta_min_minutes = EXCLUDED.eta_min_minutes,
         eta_max_minutes = EXCLUDED.eta_max_minutes,
         warranty_type = EXCLUDED.warranty_type,
         warranty_days = EXCLUDED.warranty_days,
         includes = EXCLUDED.includes,
         usage_notes = EXCLUDED.usage_notes,
         customer_notice = EXCLUDED.customer_notice,
         refund_policy = EXCLUDED.refund_policy,
         input_fields = EXCLUDED.input_fields,
         status = CASE
           WHEN shop_products.status = 'active' THEN shop_products.status
           ELSE EXCLUDED.status
         END,
         copy_ready = TRUE,
         compliance_ack_at = CASE
           WHEN EXCLUDED.status = 'active'
             THEN COALESCE(shop_products.compliance_ack_at, now())
           ELSE shop_products.compliance_ack_at
         END,
         availability = EXCLUDED.availability,
         pricing_review_required = FALSE,
         availability_reason = NULL,
         featured = EXCLUDED.featured,
         sort_order = EXCLUDED.sort_order,
         published_at = CASE
           WHEN EXCLUDED.status = 'active' AND shop_products.published_at IS NULL
             THEN now()
           ELSE shop_products.published_at
         END,
         updated_at = now()
       RETURNING id`,
      [
        product.slug,
        product.brand,
        product.category,
        product.productType,
        product.name,
        product.subtitle,
        product.description,
        product.cover,
        priceMicros,
        product.etaMin,
        product.etaMax,
        product.warrantyType,
        product.warrantyDays,
        JSON.stringify(product.includes),
        JSON.stringify(product.usage),
        product.notice,
        product.refund,
        JSON.stringify(product.inputFields),
        draftOnly ? "draft" : "active",
        availability,
        autoPublish,
        product.featured,
        product.sort,
        autoPublish,
      ],
    );
    const productId = result.rows[0].id;
    created += 1;

    await query(
      `UPDATE shop_product_sources SET active = FALSE
        WHERE product_id = $1 AND offer_id <> $2`,
      [productId, offer.id],
    );

    await query(
      `INSERT INTO shop_product_sources
         (product_id, offer_id, role, active, supplier_cost_micros,
          supplier_availability, last_synced_at)
       VALUES ($1, $2, 'primary', TRUE, $3, $4, now())
       ON CONFLICT (product_id, offer_id) DO UPDATE SET
         role = 'primary', active = TRUE,
         supplier_cost_micros = EXCLUDED.supplier_cost_micros,
         supplier_availability = EXCLUDED.supplier_availability,
         last_synced_at = now()`,
      [productId, offer.id, offer.price_micros, offer.availability],
    );
    linked += 1;

    const cost = Number(offer.price_micros) / 1_000_000;
    console.log(
      `${product.slug}: ¥${product.price} (cost ¥${cost.toFixed(2)}, margin ${(
        ((product.price - cost) / product.price) *
        100
      ).toFixed(1)}%)`,
    );
  }

  console.log(
    `seeded ${created} ${draftOnly ? "drafts" : "products"}, ${linked} sources` +
      (skipped ? `, skipped ${skipped} existing` : ""),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
