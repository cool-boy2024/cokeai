import { NextResponse } from "next/server";
import { createShopCaptcha } from "@/lib/shop/captcha";

export const dynamic = "force-dynamic";

export async function GET() {
  const captcha = createShopCaptcha();
  return NextResponse.json(captcha, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
