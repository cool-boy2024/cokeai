/**
 * In-site tutorial media. The supplier used to link its own help centre; the
 * pages now play a locally hosted walkthrough so buyers never leave the shop.
 * Only products listed here get a tutorial block.
 */
export type ShopTutorial = {
  title: string;
  video: string;
  poster: string;
  caption: string;
  steps: string[];
  image?: { src: string; alt: string; caption: string };
};

const MUSE_TUTORIAL: ShopTutorial = {
  title: "Muse 登录与换绑",
  video: "/media/muse-tutorial.mp4",
  poster: "/media/muse-tutorial-poster.jpg",
  caption: "按商品流程整理的操作演示，约 1 分钟。实际页面以 Muse 官网为准。",
  steps: [
    "打开 Muse 官网，输入发货给您的临时邮箱。",
    "打开邮箱里的接码链接，把验证码填回登录页。",
    "登录后先检查额度，确认套餐正常。",
    "换绑成自己的 Gmail 或 Hotmail（该邮箱必须从未注册过 Muse）。",
    "换绑成功后下掉原邮箱，否则账号可能被找回。",
  ],
};

const CODEX_TUTORIAL: ShopTutorial = {
  title: "Codex 单次接码",
  video: "/media/codex-sms-tutorial.mp4",
  poster: "/media/codex-sms-tutorial-poster.jpg",
  caption: "接码平台与 OpenAI app 的操作演示，只支持下方展示的登录验证页面。",
  steps: [
    "下单后收到 CDK 卡密，卡密内含接码平台地址。",
    "打开接码平台，输入 CDK 获取美国号码（+1）。",
    "在 OpenAI app 登录验证页填入号码，选择短信，点继续。",
    "收到验证码后填回 OpenAI，完成登录。",
    "收不到码就点「释放号码」换新号，未收码不消耗卡密。",
  ],
  image: {
    src: "/shop/codex-sms-supported-page.png",
    alt: "OpenAI 手机号验证页面：电话号码为必填项，默认美国 +1，可选短信或 WhatsApp。",
    caption: "只支持这个页面：电话号码必填，地区选美国（+1），方式选短信，再点「继续」。",
  },
};

export function getShopTutorial(slug: string): ShopTutorial | null {
  if (slug === "codex-sms-single") return CODEX_TUTORIAL;
  if (slug.startsWith("muse-")) return MUSE_TUTORIAL;
  return null;
}
