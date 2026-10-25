import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `sk-coke-${randomToken(28)}`;
  return {
    key,
    hash: sha256(key),
    prefix: `${key.slice(0, 14)}…${key.slice(-4)}`,
  };
}

export function generateReferralCode(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "COKE";
  return `${clean}${randomBytes(3).toString("hex").toUpperCase()}`;
}

function encryptionKey(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret || secret.length < 24) {
    throw new Error("APP_ENCRYPTION_KEY must be at least 24 characters");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  const [version, ivPart, tagPart, encryptedPart] = value.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
