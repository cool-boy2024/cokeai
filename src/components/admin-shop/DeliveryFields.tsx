"use client";

import { useState } from "react";

type DeliveryKind = "code" | "account" | "manual_note";

/**
 * The delivery form only needs one payload shape at a time. Switching the type
 * swaps the visible group so the operator is not staring at five empty fields
 * that do not apply; unmounted fields are simply not submitted and the server
 * action has always ignored everything except the selected kind.
 */
export function DeliveryFields({ defaultKind = "code" }: { defaultKind?: DeliveryKind }) {
  const [kind, setKind] = useState<DeliveryKind>(defaultKind);

  return (
    <>
      <label className="shop-field">
        <span>交付类型</span>
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as DeliveryKind)}>
          <option value="code">卡密 / 兑换码</option>
          <option value="account">账号密码</option>
          <option value="manual_note">人工说明</option>
        </select>
        <small>只填写所选类型的内容，其他类型留空即可。</small>
      </label>

      {kind === "code" ? (
        <div className="shop-form-group">
          <h3>卡密 / 兑换码</h3>
          <label className="shop-field">
            <span>卡密</span>
            <input name="code" placeholder="交付给客户的卡密" maxLength={2000} required />
          </label>
          <label className="shop-field">
            <span>兑换说明</span>
            <textarea name="codeInstruction" rows={3} maxLength={2000} placeholder="例如：在官网兑换页输入卡密" />
          </label>
        </div>
      ) : null}

      {kind === "account" ? (
        <div className="shop-form-group">
          <h3>账号密码</h3>
          <div className="shop-form-grid">
            <label className="shop-field">
              <span>账号</span>
              <input name="account" maxLength={500} autoComplete="off" required />
            </label>
            <label className="shop-field">
              <span>密码</span>
              <input name="password" maxLength={500} autoComplete="off" />
            </label>
          </div>
          <label className="shop-field">
            <span>两步验证</span>
            <input name="twoFactor" maxLength={500} placeholder="密钥或备用码" autoComplete="off" />
          </label>
        </div>
      ) : null}

      {kind === "manual_note" ? (
        <div className="shop-form-group">
          <h3>人工说明</h3>
          <label className="shop-field">
            <span>交付说明</span>
            <textarea
              name="manualNote"
              rows={4}
              maxLength={2000}
              placeholder="客户在订单页会看到这段说明"
              required
            />
          </label>
        </div>
      ) : null}
    </>
  );
}
