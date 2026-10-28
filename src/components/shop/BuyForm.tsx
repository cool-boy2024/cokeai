"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { LockSimple, ShieldCheck } from "@phosphor-icons/react";
import { createShopCheckoutAction, type ShopCheckoutState } from "@/app/actions/shop";
import type { PublicShopProduct } from "@/lib/shop/catalog";
import { isPurchasable, productPriceLabel, SHOP_COPY } from "@/lib/shop/copy";

const initial: ShopCheckoutState = {};

export function BuyForm({
  product,
  loggedIn,
  paymentOptions,
}: {
  product: PublicShopProduct;
  loggedIn: boolean;
  paymentOptions: { alipay: boolean; alipayManual: boolean; usdt: boolean; manual: boolean };
}) {
  const [state, action, pending] = useActionState(createShopCheckoutAction, initial);
  const [step, setStep] = useState<"idle" | "method">("idle");
  const available = isPurchasable(product.availability);
  const methods = [
    paymentOptions.usdt ? { key: "usdt", label: "USDT TRC20", hint: "加密货币 · 链上确认" } : null,
    paymentOptions.alipay ? { key: "alipay", label: "支付宝（易支付）", hint: "第三方网关 · 即时到账" } : null,
    paymentOptions.alipayManual ? { key: "alipay_manual", label: "支付宝", hint: "商家核实到账" } : null,
    paymentOptions.manual ? { key: "manual", label: "人工到账", hint: "联系客服" } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; hint: string }>;

  if (!loggedIn) {
    return (
      <div className="shop-buy-panel">
        <div className="shop-buy-price">
          <strong>{productPriceLabel(product.price_micros)}</strong>
          <span>{available ? SHOP_COPY.availability[product.availability as "in_stock" | "low_stock"] : "补货中"}</span>
        </div>
        <Link className="btn btn-primary btn-block" href={`/login?next=/shop/${product.slug}`}>
          登录后购买
        </Link>
        <p className="shop-buy-fine">登录后即可查看订单和交付内容。</p>
      </div>
    );
  }

  if (step === "idle") {
    return (
      <div className="shop-buy-panel">
        <div className="shop-buy-price">
          <strong>{productPriceLabel(product.price_micros)}</strong>
          <span>{available ? "含人工服务" : "补货中"}</span>
        </div>
        <button
          className="btn btn-primary btn-block"
          type="button"
          disabled={!available || methods.length === 0}
          onClick={() => setStep("method")}
        >
          {!available
            ? SHOP_COPY.buy.outOfStock
            : methods.length === 0
              ? "支付通道配置中"
              : "购买"}
        </button>
        {methods.length === 0 ? (
          <div className="shop-form-error">收款通道配置中，暂不可下单。</div>
        ) : null}
        <p className="shop-buy-fine">
          <ShieldCheck size={13} /> 数字商品，人工交付。付款后可在订单页查看进度。
        </p>
        <p className="shop-buy-fine">
          <LockSimple size={13} /> 账号类信息加密保存，交付完成后 7 天自动清除。
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="shop-buy-panel">
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="expectedPriceMicros" value={product.price_micros} />

      <div className="shop-buy-price">
        <strong>{productPriceLabel(product.price_micros)}</strong>
        <span>{available ? "含人工服务" : "补货中"}</span>
      </div>

      <div className="shop-pay-step-head">
        <h2>选择支付方式</h2>
        <button className="shop-step-back" type="button" onClick={() => setStep("idle")}>
          返回
        </button>
      </div>

      {product.input_fields.length > 0 ? (
        <div className="shop-buy-inputs">
          {product.input_fields.map((field) => (
            <label className="shop-field" key={field.key}>
              <span>
                {field.label}
                {field.required ? <em>*</em> : null}
              </span>
              {field.type === "textarea" ? (
                <textarea
                  name={`input_${field.key}`}
                  placeholder={field.placeholder}
                  required={field.required}
                  maxLength={field.maxLength || 500}
                  rows={3}
                />
              ) : (
                <input
                  name={`input_${field.key}`}
                  type={field.type === "password" ? "password" : "text"}
                  placeholder={field.placeholder}
                  required={field.required}
                  maxLength={field.maxLength || 500}
                  autoComplete="off"
                />
              )}
              {field.help ? <small>{field.help}</small> : null}
            </label>
          ))}
        </div>
      ) : null}

      <label className="shop-field">
        <span>备注（选填）</span>
        <input name="note" placeholder="有什么需要提前说明的" maxLength={500} />
      </label>

      {methods.length > 0 ? (
        <fieldset className="shop-pay-methods">
          <legend>支付渠道</legend>
          {methods.map((method, index) => (
            <label key={method.key} className="shop-pay-option">
              <input
                type="radio"
                name="provider"
                value={method.key}
                defaultChecked={index === 0}
              />
              <span>
                <strong>{method.label}</strong>
                <small>{method.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="shop-form-error">收款通道配置中，暂不可下单。</div>
      )}

      {state.error ? <div className="shop-form-error">{state.error}</div> : null}

      <button
        className="btn btn-primary btn-block"
        type="submit"
        disabled={pending || !available || methods.length === 0}
      >
        {!available
          ? SHOP_COPY.buy.outOfStock
          : methods.length === 0
            ? "收款通道配置中"
            : pending
              ? "正在创建订单…"
              : "确认并去支付"}
      </button>

      <p className="shop-buy-fine">
        <ShieldCheck size={13} /> 数字商品，人工交付。付款后可在订单页查看进度。
      </p>
      <p className="shop-buy-fine">
        <LockSimple size={13} /> 账号类信息加密保存，交付完成后 7 天自动清除。
      </p>
    </form>
  );
}
