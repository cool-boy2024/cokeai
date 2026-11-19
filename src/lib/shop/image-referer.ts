/**
 * 商品图片防盗链（应用层兜底）。
 *
 * 图片是内容寻址的公开 URL，正常场景包括：站内页面、直接打开图片、
 * 微信/Telegram 等聊天里的链接预览、搜索引擎图片结果。这些客户端要么带
 * 本站 Referer，要么不带 Referer。真正的「盗链」是从第三方页面里嵌
 * `<img src="https://cokeai.cc.cd/api/shop/images/...">`，Referer 是对方域名。
 *
 * 因此这里的口径是**白名单 + 允许空 Referer**，不是一刀切：
 * - 空 Referer / 无法解析的 Referer → 放行（直接打开、App 内打开、部分隐私模式）；
 * - 本站域名（`APP_URL` 与 `cokeai.cc.cd`）→ 放行；
 * - 常见分享/搜索平台 → 放行，避免聊天预览和图片搜索变成裂图；
 * - 其余外站 → 403。
 *
 * 这只是兜底：Cloudflare 边缘缓存命中时请求不会到源站，真正的防盗链要在
 * Cloudflare 打开 Hotlink Protection。这里不加 `Vary: Referer`，否则会让
 * 每种 Referer 各缓存一份图片，缓存命中率会塌掉。
 */
import { config } from "@/lib/config";

/** 本站域名。`APP_URL` 由部署配置提供，其余是生产与本地开发的固定值。 */
const OWN_HOSTS = ["cokeai.cc.cd", "www.cokeai.cc.cd", "localhost", "127.0.0.1", "[::1]"];

/**
 * 分享预览与图片搜索会带上这些域名的 Referer。名单故意保持精简：
 * 多一个域名只是多一个「可以嵌图」的站点，少一个则只是预览裂图。
 */
const SHARE_HOSTS = [
  // 微信 / 企业微信 / 小程序
  "weixin.qq.com",
  "wechat.com",
  "servicewechat.com",
  "wx.qq.com",
  // QQ / 腾讯
  "qq.com",
  // 搜索引擎与图片代理
  "google.com",
  "googleusercontent.com",
  "gstatic.com",
  "bing.com",
  "bing.net",
  "baidu.com",
  "bdimg.com",
  "baiducontent.com",
  "sogou.com",
  // 社交 / 即时通讯
  "x.com",
  "twitter.com",
  "t.co",
  "twimg.com",
  "telegram.org",
  "t.me",
  "telegram-cdn.org",
  "facebook.com",
  "fbcdn.net",
  "discord.com",
  "discordapp.com",
  "reddit.com",
  "redd.it",
  "weibo.com",
  "weibo.cn",
  "xiaohongshu.com",
  "xhscdn.com",
  "zhihu.com",
  "zhimg.com",
];

function configuredHosts(): string[] {
  const own: string[] = [];
  try {
    own.push(new URL(config.appUrl).hostname.toLowerCase());
  } catch {
    // APP_URL 写错不应让所有图片 403；固定值仍然兜住生产域名。
  }
  const extra = (process.env.SHOP_IMAGE_ALLOWED_HOSTS || "")
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, ""),
    )
    .filter(Boolean);
  return [...own, ...OWN_HOSTS, ...extra, ...SHARE_HOSTS].filter(Boolean);
}

const ALLOWED_HOSTS = configuredHosts();

function hostMatches(host: string, allowed: string): boolean {
  // 点号边界：允许 `mp.weixin.qq.com`，不允许 `evilqq.com`。
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * 返回 true 表示这次图片请求可以放行。空/无 Referer 一律放行，
 * 因为浏览器和聊天客户端在「直接打开」与「隐私模式」下本来就不发。
 */
export function isAllowedImageReferer(
  referer: string | null | undefined,
): boolean {
  if (!referer) return true;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    // 无法解析的 Referer（相对路径、`file://` 等）当作空值处理。
    return true;
  }
  if (!host) return true;
  return ALLOWED_HOSTS.some((allowed) => hostMatches(host, allowed));
}
