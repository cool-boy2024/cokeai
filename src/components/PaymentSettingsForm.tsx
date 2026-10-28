"use client";

import { useActionState } from "react";
import { saveManualAlipayAction, saveUsdtSettingsAction, type PaymentSettingsState } from "@/app/actions/payment-settings";

const initial: PaymentSettingsState = {};
function Result({ state }: { state: PaymentSettingsState }) {
  return <div aria-live="polite">{state.error ? <p className="form-error" role="alert">{state.error}</p> : state.saved ? <p className="notice notice-green">收款设置已保存。</p> : null}</div>;
}

export function PaymentSettingsForm({ alipay, usdt }: {
  alipay: { enabled: boolean; payee: string; qrDataUrl: string };
  usdt: { enabled: boolean; hasXpub: boolean; hasApiKey: boolean; firstAddress: string };
}) {
  const [alipayState, alipayAction, alipayPending] = useActionState(saveManualAlipayAction, initial);
  const [usdtState, usdtAction, usdtPending] = useActionState(saveUsdtSettingsAction, initial);
  return <div className="payment-settings-grid">
    <section className="panel">
      <div className="panel-head"><div><h2>支付宝</h2><p>个人收款码 · 人工核实到账</p></div><span className={`badge ${alipay.enabled ? "badge-green" : "badge-yellow"}`}>{alipay.enabled ? "已启用" : "未启用"}</span></div>
      <form action={alipayAction} className="panel-body payment-form">
        <label className="field">收款人名称<input name="payee" className="input" maxLength={80} defaultValue={alipay.payee} placeholder="与支付宝收款页一致" /></label>
        <label className="field">支付宝收款码<input name="qrImage" className="input" type="file" accept="image/png,image/jpeg" /><span className="small muted">PNG 或 JPG，450 KB 内。未选择图片则保留原收款码。</span></label>
        {alipay.qrDataUrl ? <img src={alipay.qrDataUrl} alt="当前支付宝收款码" className="payment-qr" /> : <div className="empty">上传你在支付宝保存的收款码</div>}
        <label className="payment-check"><input type="checkbox" name="enabled" defaultChecked={alipay.enabled} /> 开放支付宝收款</label>
        <p className="small muted">客户提交交易号后，在“订单 → 核实到账”中对照你的支付宝真实账单确认。更换收款码只影响新订单。</p>
        <Result state={alipayState} />
        <button className="btn btn-primary" type="submit" disabled={alipayPending}>{alipayPending ? "正在保存…" : "保存支付宝设置"}</button>
      </form>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>USDT · TRC20</h2><p>自己的钱包 · 每单独立地址</p></div><span className={`badge ${usdt.enabled ? "badge-green" : "badge-yellow"}`}>{usdt.enabled ? "已启用" : "未启用"}</span></div>
      <form action={usdtAction} className="panel-body payment-form">
        <label className="field">账户公钥 xpub<textarea className="input mono" name="xpub" rows={3} autoComplete="off" maxLength={120} placeholder={usdt.hasXpub ? "已配置，留空保留" : "xpub…"} /><span className="small muted">路径 m/44&apos;/195&apos;/0&apos;。仅填写扩展公钥，不要填写私钥或助记词。</span></label>
        <label className="field">TronGrid API Key（可选）<input type="password" name="apiKey" className="input" maxLength={256} autoComplete="new-password" placeholder={usdt.hasApiKey ? "已配置，留空保留" : "不填则使用低频公共接口"} /><span className="small muted">生产建议填写免费 TronGrid Key；不填也能收款，但链上查询更慢、可能被限流。</span></label>
        <label className="field">你钱包里的首个收款地址<input name="firstAddress" className="input mono" maxLength={34} autoComplete="off" placeholder="T…" /><span className="small muted">从你自己的钱包复制 m/44&apos;/195&apos;/0&apos;/0/0 地址。启用前会核对派生结果。</span></label>
        {usdt.firstAddress ? <div className="small muted payment-address">当前配置的首地址：<span className="mono">{usdt.firstAddress}</span></div> : null}
        <label className="payment-check"><input type="checkbox" name="enabled" defaultChecked={usdt.enabled} /> 开放 USDT 收款</label>
        <p className="small muted">资金留在各订单地址。归集或转出需要你用自己的钱包签名，并准备 TRX / 能量。网站只负责查询到账。</p>
        <Result state={usdtState} />
        <button className="btn btn-primary" type="submit" disabled={usdtPending}>{usdtPending ? "正在保存…" : "保存钱包设置"}</button>
      </form>
    </section>
  </div>;
}
