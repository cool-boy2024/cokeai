import { config } from "@/lib/config";
import { buildEasyPayCheckout, easyPayConfigError } from "@/lib/payments/easypay";

export function shopEasyPayError(): string | null {
  return easyPayConfigError();
}

export function createShopEasyPayCheckout(input: {
  orderNo: string;
  amountMicros: number;
  productName: string;
}): { url: string } {
  const result = buildEasyPayCheckout({
    orderId: input.orderNo,
    amountYuan: input.amountMicros / 1_000_000,
    productName: `CokeAI小店-${input.productName}`,
    notifyUrl: `${config.appUrl}/api/webhooks/easypay/shop`,
    returnUrl: `${config.appUrl}/shop/orders/${encodeURIComponent(input.orderNo)}`,
  });
  return { url: result.url };
}
