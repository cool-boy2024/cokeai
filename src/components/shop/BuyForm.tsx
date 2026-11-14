"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { LockSimple, ShieldCheck } from "@phosphor-icons/react";
import { createShopCheckoutAction, type ShopCheckoutState } from "@/app/actions/shop";
import type { PublicShopProduct } from "@/lib/shop/catalog";
import { isPurchasable, productPriceLabel, SHOP_COPY } from "@/lib/shop/copy";

const initial: ShopCheckoutState = {};

type Captcha = { token: string; image: string };

function captchaExpiresAt(token: string | undefined): number {
  if (!token) return 0;
  try {
    const encoded = token
      .split(".")[0]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
    const expiresAt = Number(atob(padded).split(".").pop());
    return Number.isFinite(expiresAt) ? expiresAt : 0;
  } catch {
    return 0;
  }
}

export function BuyForm({
  product,
  loggedIn,
  defaultEmail,
  qtyMax,
  paymentOptions,
  initialCaptcha,
}: {
  product: PublicShopProduct;
  loggedIn: boolean;
  defaultEmail: string;
  qtyMax: number;
  paymentOptions: {
    alipay: boolean;
    alipayManual: boolean;
    usdtNetworks: Array<{ provider: string; label: string; hint: string }>;
    manual: boolean;
  };
  initialCaptcha?: Captcha | null;
}) {
  const [state, action, pending] = useActionState(createShopCheckoutAction, initial);
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "method">("idle");
  const [qty, setQty] = useState(1);
  // The first captcha is rendered with the page, so opening the payment step is
  // instant. Refreshes are only needed when it expires, the code is wrong, or
  // the buyer asks for a new one.
  const [captcha, setCaptcha] = useState<Captcha | null>(initialCaptcha ?? null);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [captchaRefreshing, setCaptchaRefreshing] = useState(false);
  const captchaPending = useRef(false);
  const available = isPurchasable(product.availability);
  const maxQty = Math.max(1, Math.trunc(qtyMax));
  const totalMicros = product.price_micros * qty;

  const refreshCaptcha = useCallback(async () => {
    if (captchaPending.current) return;
    captchaPending.current = true;
    setCaptchaRefreshing(true);
    try {
      const response = await fetch("/api/shop/captcha", {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("captcha unavailable");
      const data = (await response.json()) as Captcha;
      setCaptcha(data);
    } catch {
      setCaptcha(null);
    } finally {
      captchaPending.current = false;
      setCaptchaRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (step !== "method") return;
    // A captcha is valid for five minutes; refresh a minute before it expires.
    const expiresAt = captchaExpiresAt(captcha?.token);
    if (!captcha || !expiresAt || Date.now() > expiresAt - 60_000) {
      void refreshCaptcha();
    }
  }, [step, captcha, refreshCaptcha]);

  useEffect(() => {
    if (captchaVersion === 0) return;
    void refreshCaptcha();
  }, [captchaVersion, refreshCaptcha]);

  useEffect(() => {
    if (state.error?.includes("验证码")) {
      setCaptchaVersion((value) => value + 1);
    }
    // The hidden expectedPriceMicros still holds the old price. Refresh the
    // server component so the next submit uses the current price instead of
    // failing with the same message forever.
    if (state.error?.includes("价格已更新")) {
      router.refresh();
    }
  }, [state.error, router]);

  const methods = [
    ...paymentOptions.usdtNetworks.map((network) => ({
      key: network.provider,
      label: network.label,
      hint: network.hint,
    })),
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
        <strong>{productPriceLabel(totalMicros)}</strong>
        <span>
          {qty > 1
            ? `单价 ${productPriceLabel(product.price_micros)} · ${qty} 件`
            : available
              ? "含人工服务"
              : "补货中"}
        </span>
      </div>

      <div className="shop-pay-step-head">
        <h2>选择支付方式</h2>
        <button className="shop-step-back" type="button" onClick={() => setStep("idle")}>
          返回
        </button>
      </div>

      <label className="shop-field">
        <span>
          联系邮箱<em>*</em>
        </span>
        <input
          name="contactEmail"
          type="email"
          required
          defaultValue={defaultEmail}
          maxLength={254}
          autoComplete="email"
          placeholder="用于接收订单通知"
        />
        <small>订单通知和售后联系使用这个邮箱，不会用于登录。</small>
      </label>

      <div className="shop-field">
        <span>购买数量</span>
        <div className="shop-qty">
          <button
            type="button"
            onClick={() => setQty((value) => Math.max(1, value - 1))}
            disabled={qty <= 1}
            aria-label="减少数量"
          >
            −
          </button>
          <input
            name="qty"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxQty}
            value={qty}
            aria-label="购买数量"
            onChange={(event) => {
              const next = Math.trunc(Number(event.target.value) || 1);
              setQty(Math.min(maxQty, Math.max(1, next)));
            }}
          />
          <button
            type="button"
            onClick={() => setQty((value) => Math.min(maxQty, value + 1))}
            disabled={qty >= maxQty}
            aria-label="增加数量"
          >
            +
          </button>
        </div>
        <small>单次最多 {maxQty} 件，合计按单价 × 数量计算。</small>
      </div>

      <div className="shop-field">
        <span>
          人机验证<em>*</em>
        </span>
        <div className="shop-captcha">
          {captcha ? (
            <img
              src={captcha.image}
              alt="人机验证码"
              width={140}
              height={48}
            />
          ) : (
            <span className="shop-captcha-loading">验证码加载中…</span>
          )}
          <button
            type="button"
            disabled={captchaRefreshing}
            onClick={() => setCaptchaVersion((value) => value + 1)}
          >
            {captchaRefreshing ? "刷新中…" : "换一张"}
          </button>
        </div>
        <input
          key={captcha?.token || "captcha"}
          name="captchaCode"
          type="text"
          required
          maxLength={4}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="输入图中 4 位字符"
          aria-label="人机验证码"
        />
        <input type="hidden" name="captchaToken" value={captcha?.token || ""} />
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
        disabled={pending || !available || methods.length === 0 || !captcha}
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
