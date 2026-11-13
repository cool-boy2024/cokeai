import type { Metadata } from "next";
import { LockKey, Timer } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { TwoFactorTool } from "@/components/tools/TwoFactorTool";
import "./twofa.css";

export const metadata: Metadata = {
  title: "2FA 验证码工具",
  description:
    "在浏览器本地把 32 位 2FA 密钥生成 6 位动态验证码，不上传、不保存密钥。",
};

export default function TwoFactorPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main twofa-page">
        <section className="twofa-hero">
          <div className="container">
            <div className="hero-eyebrow">
              <i />
              2FA tool
            </div>
            <h1>2FA 验证码工具</h1>
            <p>
              把 32 位新密钥生成 6 位动态验证码。计算全部在浏览器里完成，密钥不会发到服务器，也不会被保存。
            </p>
          </div>
        </section>

        <section className="twofa-section">
          <div className="container twofa-layout">
            <TwoFactorTool />

            <aside className="twofa-guide" aria-label="使用说明">
              <div className="twofa-guide-head">
                <LockKey size={18} />
                <h2>使用说明</h2>
              </div>
              <ol>
                <li>
                  <strong>复制新密钥</strong>
                  <span>
                    在添加 2FA 的页面拿到 32 位密钥，整段复制。密钥里通常只有大写字母和数字 2–7。
                  </span>
                </li>
                <li>
                  <strong>点击「粘贴并生成」</strong>
                  <span>
                    工具会优先读取剪贴板里的新密钥；浏览器不允许读取剪贴板时，把密钥粘贴到输入框再点一次。
                  </span>
                </li>
                <li>
                  <strong>复制 6 位验证码</strong>
                  <span>
                    点击「复制验证码」，回到添加 2FA 的页面粘贴。验证码每 30 秒换新，以页面显示的最新一次为准。
                  </span>
                </li>
                <li>
                  <strong>提示验证码错误时</strong>
                  <span>
                    先确认密钥复制完整、没有混入空格以外的字符，再检查设备时间和系统自动对时是否开启。时间偏差超过 30 秒会导致验证码对不上。
                  </span>
                </li>
              </ol>
              <div className="twofa-guide-note">
                <Timer size={16} />
                <p>
                  这个页面不联网、不记录密钥。关闭标签页后需要重新粘贴密钥，所以请把密钥保存在自己的密码管理器里。
                </p>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
