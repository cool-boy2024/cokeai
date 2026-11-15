import { pathToFileURL } from "node:url";
import { loadEnv } from "./env.mjs";
import { SHOP_SOURCE_COPY, sourceCopyText } from "./shop-source-copy";

loadEnv();

type SeedProduct = {
  slug: string;
  brand: "chatgpt" | "claude" | "gemini" | "grok" | "muse";
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
  /** 货源页面原样的质保口径；非空时优先于天数字段显示。 */
  warrantyNote: string;
  /**
   * 货源没有进入聚合 feed、但已人工打开货源页确认可购买时，设置这个库存；
   * 发布脚本会把货源标记为停用，避免每小时同步把它改成补货中。
   */
  manualAvailability?: "in_stock" | "low_stock" | "out_of_stock";
  includes: string[];
  usage: string[];
  notice: string;
  refund: string;
  inputFields: Array<Record<string, unknown>>;
  featured: boolean;
  sort: number;
  offer: { store: string; titleLike: string };
};

type MuseVariant = {
  slug: string;
  name: string;
  price: number;
  warrantyType: "none" | "days";
  warrantyDays: number;
  warrantyNote: string;
  sort: number;
};

const MUSE_VARIANTS: MuseVariant[] = [
  {
    slug: "muse-10b-1h",
    name: "Muse 10 亿额度成品号（1 小时后无任何质保）",
    price: 15,
    warrantyType: "none",
    warrantyDays: 0,
    warrantyNote: "1 小时后无任何质保",
    sort: 70,
  },
  {
    slug: "muse-10b-7d",
    name: "Muse 10 亿额度成品号（7 天之内死了就换）",
    price: 20,
    warrantyType: "days",
    warrantyDays: 7,
    warrantyNote: "7 天之内死了就换",
    sort: 71,
  },
  {
    slug: "muse-10b-30d",
    name: "Muse 10 亿额度成品号（1 个月之内死了就换）",
    price: 25,
    warrantyType: "days",
    warrantyDays: 30,
    warrantyNote: "1 个月之内死了就换",
    sort: 72,
  },
  {
    slug: "muse-310b-1h",
    name: "Muse 310 亿额度成品号（1 小时后无任何质保）",
    price: 25,
    warrantyType: "none",
    warrantyDays: 0,
    warrantyNote: "1 小时后无任何质保",
    sort: 73,
  },
  {
    slug: "muse-310b-7d",
    name: "Muse 310 亿额度成品号（7 天之内死了就换）",
    price: 60,
    warrantyType: "days",
    warrantyDays: 7,
    warrantyNote: "7 天之内死了就换",
    sort: 74,
  },
  {
    slug: "muse-310b-30d",
    name: "Muse 310 亿额度成品号（1 个月之内死了就换）",
    price: 88,
    warrantyType: "days",
    warrantyDays: 30,
    warrantyNote: "1 个月之内死了就换",
    sort: 75,
  },
];

function museProduct(variant: MuseVariant): SeedProduct {
  return {
    slug: variant.slug,
    brand: "muse",
    category: "account",
    productType: "account",
    name: variant.name,
    subtitle: "美国号池 · 成品号 · 邮箱号 + 接码链接交付",
    description:
      "Muse 成品账号，邮箱号与接码链接交付。首登、换绑和防封要求按货源原文执行。",
    cover: "muse",
    price: variant.price,
    etaMin: 30,
    etaMax: 120,
    warrantyType: variant.warrantyType,
    warrantyDays: variant.warrantyDays,
    warrantyNote: variant.warrantyNote,
    manualAvailability: "in_stock",
    includes: [variant.name, "邮箱号 + 接码链接", "登录、换绑与防封教程"],
    usage: [
      "首登前确认当前 IP 为美国、日本、新加坡或加拿大，开启全局代理，并使用浏览器无痕模式。",
      "进入 Muse 官网输入发货邮箱号，页面会提示输入验证码。",
      "打开接码链接获取验证码并填入登录页。",
      "上号后检查额度，1 小时内换绑成自己的 Gmail 或 Hotmail，并下掉原邮箱。",
      "换绑细节按本页下方操作步骤执行。",
    ],
    notice:
      "下单前请务必选择好自己要的质保方案；如果买的是「1 小时后无任何质保」，代表 1 小时后号死了也不质保。\n1. 质保多久根据您自己下单的质保规格。最近封号比较严重，我们只能这么和您说。\n2. 上号后请在 1 小时内换绑成自己的邮箱；因为没有换绑导致临时邮箱失效，我们无法售后。\n3. 不接受吹毛求疵的客户。有可能下单时发现额度不是 310 亿整，这种我们愿意按照你付款比例补一点；当然额度差距太大了的话，我们会给你换。\n4. 本产品登录方式在页面下方，请按步骤操作。\n5. Muse 目前只在以下地区 IP 环境可以使用：美国、日本、新加坡、加拿大。",
    refund:
      variant.warrantyType === "none"
        ? "质保规格：1 小时后无任何质保。购买后 1 小时内可登录，1 小时后账号死亡不质保。\n上号后请在 1 小时内换绑成自己的邮箱；没有换绑导致临时邮箱失效，无法售后。\n换绑成功后务必下掉原邮箱；不下掉被找回，无法售后。"
        : `质保规格：${variant.warrantyNote}。\n上号后请在 1 小时内换绑成自己的邮箱；没有换绑导致临时邮箱失效，无法售后。\n换绑成功后务必下掉原邮箱；不下掉被找回，无法售后。`,
    inputFields: [],
    featured: false,
    sort: variant.sort,
    offer: { store: "子砚的AI店铺", titleLike: "%muse成品账号（应对封号迭代升级版%）" },
  };
}

export const PRODUCTS: SeedProduct[] = [
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
    warrantyType: "first_login",
    warrantyDays: 0,
    warrantyNote: "质保开通：保证充值开通成功；订阅掉线与账号封禁不在质保范围",
    includes: [
      "ChatGPT Plus 1 个月开通 CDK 卡密",
      "激活地址与兑换说明",
      "本站订单页随时查看卡密",
    ],
    usage: [
      "下单后获取 CDK 卡密和激活地址，请留意订单页面显示的信息。",
      "打开激活页面并输入 CDK 卡密（激活页面会随卡密一起发送）。",
      "按激活页面提示操作，并确保需要充值的 GPT 账号已经在浏览器中登录。",
      "根据激活页面提示完成账号授权信息获取。",
      "将页面要求的信息提交到激活页面，系统会自动完成充值。",
    ],
    notice:
      "本商品为 CDK 卡密商品，卡密本身不会过期，建议现买现用。\n安全提醒：登录凭证属于敏感账号信息，请确认激活页面来源可信后再操作，不要将相关信息发送给陌生人。\n渠道 1 使用前请注意：如果 GPT 账号此前使用 iOS、Google Pay 或其他非银行卡方式订阅，通常需要等待约 3 天后再尝试渠道 1。",
    refund:
      "质保开通：保证充值开通成功；订阅异常掉线、账号被封不在质保范围。\n渠道 1：账号被封时，可自行尝试向 GPT 官方申请退款；符合官方退款条件的订单可申请处理。是否退款以官方处理结果为准，退款需买家自行按官方流程申请；本店不代申请，也不承诺退款结果。\n模型表现、响应速度、服务器卡顿、功能调整等平台自身服务情况，不属于充值售后范围。",
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
    warrantyType: "none",
    warrantyDays: 0,
    warrantyNote: "掉订阅包赔；封号不质保",
    includes: ["Claude Pro 1 个月充值卡密", "充值地址与网页教程"],
    usage: [
      "付款后在本站订单页获取充值卡密以及充值地址，按照网页教程进行充值。",
      "打开充值网站，自助充值激活会员。",
      "充值前确认账号没有未到期订阅、没有欠费或退款记录。",
      "在官网对话框发送一条消息，确认组织 ID 未被封禁。",
      "进入升级订阅页面，确认右上角没有组织 ID 被封禁提示。",
    ],
    notice:
      "下单前请先了解商品的特殊性：不质保封号。哪怕你用了 1 分钟或者没用上，都没有售后退款。\n以下情况充值会无法到账，遇到以下情况导致的订阅不到账无法退款：订阅未到期的不可充值；账户账单中有欠费、有退款记录的不可充值；组织 ID 被隐性封禁的不可充值。\n部分账号充值完成后会随机出现 KYC 验证，必须完成身份验证后订阅才能激活；KYC 有认证不通过的风险，本店不承担任何责任，无法退款。\n支持在现有会员到期前提前续费，新充值的时间会直接覆盖原有时间，并非累计叠加。",
    refund:
      "只能保证充值渠道正规，充值有问题只会掉订阅，掉订阅包赔。\n封号都是因为环境问题，无法质保，哪怕刚充就封号也无法质保。\n防风控技巧见商品说明原文；以上只能降低风险，被封不处理售后。",
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
    category: "giftcard",
    productType: "giftcard",
    name: "ChatGPT Pro 5x 月度卡密",
    subtitle: "开通卡密，按货源教程自助充值 1 个月 Pro 5x",
    description:
      "开通卡密自助充值到你自己的 ChatGPT 账号，按货源教程在兑换网站提交 session 完成 Pro 5x 订阅。",
    cover: "chatgpt-pro",
    price: 849,
    etaMin: 10,
    etaMax: 60,
    warrantyType: "days",
    warrantyDays: 30,
    warrantyNote: "质保一个月订阅，掉订阅可按比例退款",
    includes: [
      "ChatGPT Pro 5x 1 个月订阅",
      "充值卡密与兑换网站 https://lovecodex.cn/",
      "可在官网账单页查看官方账单",
    ],
    usage: [
      "下单后复制收到的充值卡密。",
      "打开兑换网站 https://lovecodex.cn/。",
      "按照页面提示登录需要充值的账号。",
      "根据兑换页面指引跳转到 session 网站，复制完整的凭证，粘贴后提交充值。",
      "提交后等待约 1 分钟；如果提示充值失败，重新提交 session 再试一遍。",
      "充值成功后刷新官网页面，在订阅或账单页面查看 Pro 状态。",
    ],
    notice:
      "下单时设置的“安全密码”，请勿填写 QQ 号、手机号、常用密码等个人信息，以免卡密被他人盗取。\n适用于目前无订阅的普通账号（该账号目前没有 GO、PLUS、PRO 等订阅）。\n支持提前续费：系统会提前绑定新卡，在账单到期后自动扣费完成续费。\n充值之后大概率可直接使用 codex，无需再次绑定手机号验证。\n如因账号不符合充值条件而失败，可申请全额退款。",
    refund:
      "质保方式：质保一个月订阅，掉订阅可按比例退款。\n如因账号不符合充值条件而失败，可申请全额退款。",
    inputFields: [],
    featured: false,
    sort: 30,
    offer: { store: "启航AI", titleLike: "%智利渠道%Pro5x正价代充%" },
  },
  {
    slug: "claude-max-5x-1m",
    brand: "claude",
    category: "giftcard",
    productType: "giftcard",
    name: "Claude Max 5x 月度卡密",
    subtitle: "开通卡密，按货源教程自助充值 1 个月 Max 5x",
    description:
      "开通卡密自助充值到你自己的 Claude 账号，按货源说明完成 iOS 订阅凭证充值。",
    cover: "claude-max",
    price: 1099,
    etaMin: 10,
    etaMax: 60,
    warrantyType: "none",
    warrantyDays: 0,
    warrantyNote: "订阅掉线按实际使用天数计算退款，账号封禁不质保",
    includes: [
      "Claude Max 5x 1 个月订阅",
      "充值完成通知",
      "未到账时提供 AppleId 与充值订单（货源方口径）",
    ],
    usage: [
      "确认账号当前没有生效中的 Claude 会员。",
      "确认账号此前订阅过 Claude Pro / Max。",
      "确认账号没有做过 KYC；Max 5x / 20x 一定会触发 KYC。",
      "检查 Google 账单没有欠费，Google Pay 旧订阅结束后建议等待 7 天以上。",
      "关闭 Google 自动续费，移除 Claude 账单页绑定的银行卡。",
      "确认是个人版账号，且没有异常免费订阅记录。",
      "提交充值后等待处理；未到账时按售后说明联系客服。",
    ],
    notice:
      "下单前快速检查：\n1. 当前不能有正在生效的 Claude 会员\n2. 账号以前必须订阅过 Claude\n3. Max 5x / 20x 需要做好 KYC 准备\n4. Google 不能存在欠费账单\n5. Google Pay 旧订阅结束后建议等待 7 天以上\n6. 必须关闭自动续费\n7. Claude 账单页面不能绑定银行卡\n8. 必须是个人版账号，不能是团队版\n9. 有异常免费订阅记录的账号不要充值\n10. 当前账号确定没有过 KYC",
    refund:
      "Claude 风控增强，有概率（概率不高，但是有）不到账和掉订阅。如果出现不到账或掉订阅，只提供 AppleId 自行尝试退款（不一定能退回来）。\n近几天销出 139 单 5x 和 20x，报告不到账 29 例，使用 AppleId 退款成功 11 个，其余退款全部 AppleId 被封，购买需要谨慎。充 Claude 5x 和 20x 相当于赌博，我们能做的只是在不到账后提供 AppleId 和充值订单，不承担其他的。\n订阅掉线按实际使用天数计算退款，账号封禁不质保。",
    inputFields: [],
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
    warrantyNote: "",
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
    warrantyNote: "",
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
  {
    slug: "codex-sms-single",
    brand: "chatgpt",
    category: "giftcard",
    productType: "giftcard",
    name: "Codex 单次短信接码（美国号）",
    subtitle: "单次 OpenAI Codex 登录验证码，CDK 卡密发货",
    description:
      "单次 Codex 短信验证码，CDK 卡密交付，卡密内含接码平台地址。只支持 OpenAI app 登录验证，未收码可释放号码换号。支持页面与教程见本页。",
    cover: "codex-sms",
    price: 5,
    etaMin: 10,
    etaMax: 60,
    warrantyType: "none",
    warrantyDays: 0,
    warrantyNote: "未收码不消耗卡密",
    includes: [
      "单次 Codex 短信验证码 CDK",
      "接码平台地址（卡密中包含）",
      "未收码可释放号码换号，不消耗 CDK",
    ],
    usage: [
      "下单后在本站订单页获取 CDK 卡密与接码平台地址。",
      "打开接码平台，使用卡密进入接码页面。",
      "在 OpenAI app 的 Codex 登录验证页选择美国（+1）并获取短信验证码。",
      "回到接码平台查看验证码并填入登录页。",
      "未收到码时点击「释放号码」更换号码；未收到验证码不会消耗卡密。",
      "号码为美国号码，默认美国代码即可。",
    ],
    notice:
      "只支持OpenAI的app的登录验证，其他网址或功能的验证均不保证，乱拍不退。\n无法接google账户风控验证，无法用于注册账号，只支持下面这个页面，看清楚拍：\n单次收码会从系统号码池中选择剩余天数较少的号码，单次有效，保底能接，如果有长期需要，请选购长期收码。\n如果接不到码，请点击“释放号码”后重新获取新号码！！\n只要没收到验证码就不会消耗卡密，可以重新获取更换号码再做尝试。\n号码为美国号码，默认美国代码即可。",
    refund:
      "虚拟产品售出无质量问题不支持无理由退换货。\n虚拟产品具有保密性，已发出的卡密不支持无理由退款，请勿乱拍，乱拍不退。\n一次购买保保底绑定1个账号，理论1个（只保1个），可保底获取1次。",
    inputFields: [],
    featured: false,
    sort: 80,
    offer: { store: "启航AI", titleLike: "%单次codex短信验证码收码%" },
  },
  ...MUSE_VARIANTS.map(museProduct),
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
          eta_max_minutes, warranty_type, warranty_days, warranty_note,
          includes, usage_notes, customer_notice, refund_policy, input_fields,
          status, availability, copy_ready, compliance_ack_at, featured,
          sort_order, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12,$13,$14,
               $15::jsonb,$16::jsonb,$17,$18,$19::jsonb,$20,$21,
               TRUE, CASE WHEN $22 THEN now() ELSE NULL END, $23, $24,
               CASE WHEN $25 THEN now() ELSE NULL END)
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
         warranty_note = EXCLUDED.warranty_note,
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
        sourceCopyText(product.slug) ?? product.description,
        product.cover,
        priceMicros,
        product.etaMin,
        product.etaMax,
        product.warrantyType,
        product.warrantyDays,
        SHOP_SOURCE_COPY[product.slug]?.warrantyNote ?? product.warrantyNote,
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

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
