import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "数字商品购买须知",
  description: "CokeAI 小店的数字商品、发货、质保与退款说明。",
};

export default function ShopTermsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main legal">
        <div className="container-narrow">
          <h1>数字商品购买须知</h1>
          <div className="legal-meta">最后更新：2026-10-27</div>

          <p>
            本页适用于 CokeAI 小店（<Link href="/shop">/shop</Link>）销售的数字商品，
            包括订阅代充、开通卡密、成品账号等。下单即表示你已阅读并同意本页内容。
          </p>

          <h2>1. 商品性质</h2>
          <ul>
            <li>小店商品均为数字商品，不是实物，不产生物流发货。</li>
            <li>商品由人工处理，发货时效以商品页标注为准，不承诺秒发。</li>
            <li>部分商品需要你提供账号信息才能完成代充，具体字段以下单页为准。</li>
            <li>商品可能受库存、地区政策和账号状态影响。</li>
          </ul>

          <h2>2. 账号与凭据</h2>
          <ul>
            <li>需要代充时，请提供你本人有权使用的账号，并确保可以正常登录。</li>
            <li>账号信息使用 AES-256-GCM 加密保存，仅用于本次订单，交付完成 7 天后自动清除。</li>
            <li>请勿在备注中填写与订单无关的敏感信息。</li>
            <li>交付完成后，建议立即修改密码并检查登录设备。</li>
          </ul>

          <h2>3. 发货与验收</h2>
          <ul>
            <li>付款后订单进入处理中，完成后可在订单页查看交付内容。</li>
            <li>卡密类商品请在收到后 24 小时内兑换，逾期失效风险由买家承担。</li>
            <li>收到交付内容后，请及时核对并保存；查看记录会写入订单日志。</li>
            <li>如超过商品页标注的最长时效仍未完成，请联系售后。</li>
          </ul>

          <h2>4. 质保与售后</h2>
          <ul>
            <li>质保范围以商品页标注为准，常见为“首登质保”或“7 天质保”。</li>
            <li>质保不包含因买家修改密码、违规使用、地区限制或平台封号导致的失效。</li>
            <li>卡密未使用且兑换失败，经核实可补发或退款；已成功兑换的订单不支持退款。</li>
            <li>代充未开始处理可申请全额退款；已到账的订单不支持退款。</li>
          </ul>

          <h2>5. 缺货与退款</h2>
          <ul>
            <li>商品显示“补货中”时无法下单；已付款后遇缺货，订单转入退款处理。</li>
            <li>退款由人工处理，到账时间以原支付渠道为准。</li>
            <li>支付宝人工收款需要先核对交易号，再原路退回；到账时间以支付宝为准，非即时。</li>
            {/* USDT 未开放时不提这条，避免客户去找一个不存在的支付方式。 */}
            {config.usdtEnabled ? (
              <li>USDT 转账不可逆，退款需要人工核对地址与金额，可能产生链上手续费。</li>
            ) : null}
          </ul>

          <h2>6. 使用限制</h2>
          <ul>
            <li>不得将商品用于违法、欺诈、侵权或违反平台服务条款的用途。</li>
            <li>不得转售、共享或批量滥用账号类商品。</li>
            <li>平台有权拒绝来源不明、疑似盗取或高风险订单。</li>
          </ul>

          <h2>7. 联系方式</h2>
          <p>
            售后邮箱：<a href={`mailto:${config.shopSupportEmail}`}>{config.shopSupportEmail}</a>
            。请在邮件中附上订单号，便于快速处理。
          </p>

          <p className="legal-foot">
            <Link href="/shop">返回小店</Link> · <Link href="/terms">平台服务条款</Link> ·{" "}
            <Link href="/privacy">隐私政策</Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
