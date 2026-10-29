import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ensureConnected, getRedis } from "@/lib/rate-limit";

const CAPTCHA_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CAPTCHA_TTL_MS = 5 * 60_000;

function captchaSecret(): string {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret || secret.length < 24) {
    throw new Error("APP_ENCRYPTION_KEY must be at least 24 characters");
  }
  return `${secret}:shop-captcha:v1`;
}

function sign(payload: string): string {
  return createHmac("sha256", captchaSecret()).update(payload).digest("base64url");
}

function codeFor(nonce: string): string {
  const digest = createHmac("sha256", captchaSecret())
    .update(`code:${nonce}`)
    .digest();
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += CAPTCHA_CHARSET[digest[index] % CAPTCHA_CHARSET.length];
  }
  return code;
}

function renderSvg(code: string, nonce: string): string {
  const bytes = createHmac("sha256", captchaSecret())
    .update(`svg:${nonce}`)
    .digest();
  const glyphs = code
    .split("")
    .map((char, index) => {
      const x = 30 + index * 27;
      const y = 34 + (bytes[index] % 5) - 2;
      const angle = (bytes[index + 6] % 25) - 12;
      return `<text x="${x}" y="${y}" transform="rotate(${angle} ${x} ${y})" fill="#1f6f5c" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="26" font-weight="600" text-anchor="middle">${char}</text>`;
    })
    .join("");
  const lines = [0, 1, 2]
    .map((index) => {
      const y1 = 8 + (bytes[12 + index] % 30);
      const y2 = 8 + (bytes[16 + index] % 30);
      return `<path d="M6 ${y1} L134 ${y2}" stroke="#1f6f5c" stroke-opacity="0.22" stroke-width="1.5" />`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="48" viewBox="0 0 140 48" role="img" aria-label="人机验证码"><rect width="140" height="48" rx="8" fill="#f7f6f3"/><g>${lines}</g>${glyphs}</svg>`;
}

export function createShopCaptcha(): { token: string; image: string } {
  const nonce = randomBytes(12).toString("base64url");
  const expiresAt = Date.now() + CAPTCHA_TTL_MS;
  const payload = Buffer.from(`${nonce}.${expiresAt}`, "utf8").toString(
    "base64url",
  );
  const token = `${payload}.${sign(payload)}`;
  const svg = renderSvg(codeFor(nonce), nonce);
  return {
    token,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  };
}

export async function verifyShopCaptcha(
  token: string,
  answer: string,
): Promise<boolean> {
  if (!token || !answer) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false;
  }

  const [nonce, expiresAtRaw] = Buffer.from(payload, "base64url")
    .toString("utf8")
    .split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!nonce || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const expectedCode = Buffer.from(codeFor(nonce));
  const submittedCode = Buffer.from(answer.trim().toUpperCase());
  if (
    expectedCode.length !== submittedCode.length ||
    !timingSafeEqual(expectedCode, submittedCode)
  ) {
    return false;
  }

  // A valid captcha can only be used once. If Redis is unavailable we still
  // accept it, because the signature and expiry remain enforced.
  const client = getRedis();
  if (!client) return true;
  try {
    await ensureConnected(client);
    const stored = await client.set(
      `shop:captcha:${nonce}`,
      "1",
      "EX",
      Math.ceil(CAPTCHA_TTL_MS / 1000),
      "NX",
    );
    return stored === "OK";
  } catch (error) {
    console.warn(
      "[shop-captcha]",
      error instanceof Error ? error.message : error,
    );
    return true;
  }
}
