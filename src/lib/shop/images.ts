import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { query, withTransaction } from "@/lib/db";

/**
 * Mirrors supplier images into our own database.
 *
 * Supplier product pages are fetched by the sync job, but buyers must see
 * images served from our own domain. Each download is validated (public https
 * target, image mime, size cap, magic bytes) and stored content-addressed by
 * sha256: the same bytes always map to the same hash, so the public URL stays
 * stable and can be cached forever.
 */

export type StoredImage = { hash: string; ext: string; mime: string };

type StoredImageWithSize = StoredImage & {
  byteSize: number;
  width: number | null;
  height: number | null;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Supplier covers are often the shop's 128x128 product icon (2-3 KB), so a
// byte floor cannot stand in for "is this a real picture". Only obvious
// spacers are rejected by size; covers get a pixel-size gate instead.
const MIN_STORED_BYTES = 256;
const MIN_COVER_SIDE = 64;
const MAX_REDIRECTS = 3;
const COVER_LIMIT = 1;
const DESCRIPTION_LIMIT = 12;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// A single sync run touches many products that often reuse the same banner
// images. Keeping successful downloads in memory avoids fetching (and
// hashing) the same bytes dozens of times in one run.
const remoteImageMemory = new Map<string, StoredImageWithSize>();
const REMOTE_IMAGE_MEMORY_LIMIT = 500;

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  return true;
}

/**
 * Only https and only public targets. Every redirect hop is checked again,
 * because a public hostname can redirect to an internal address.
 */
async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("图片地址不是合法的 URL");
  }
  if (url.protocol !== "https:") throw new Error("图片地址必须使用 https");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("图片地址不是可抓取的公开地址");
  }
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new Error("图片地址指向内网地址");
    return url;
  }
  const addresses = await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0) throw new Error("图片域名无法解析");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("图片地址指向内网地址");
  }
  return url;
}

function detectImage(bytes: Buffer): { mime: string; ext: string } | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 6) {
    const head = bytes.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return { mime: "image/gif", ext: "gif" };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/**
 * Reads pixel dimensions from the image header. Returns null when the format
 * is not understood, and callers treat that as "accept": the gate exists to
 * drop 1x1 spacers and 32x32 icons, not to reject valid artwork.
 */
function probeImageSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mime === "image/gif" && bytes.length >= 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (mime === "image/jpeg" && bytes.length >= 4) {
      let i = 2;
      while (i + 8 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        if (marker === 0xd8 || marker === 0xd9) {
          i += 2;
          continue;
        }
        const size = bytes.readUInt16BE(i + 2);
        const isSof =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;
        if (isSof) {
          return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
        }
        i += 2 + size;
      }
      return null;
    }
    if (mime === "image/webp" && bytes.length >= 30) {
      const chunk = bytes.subarray(12, 16).toString("ascii");
      if (chunk === "VP8X") {
        const width = 1 + bytes.readUIntLE(24, 3);
        const height = 1 + bytes.readUIntLE(27, 3);
        return { width, height };
      }
      if (chunk === "VP8 ") {
        return {
          width: bytes.readUInt16LE(26) & 0x3fff,
          height: bytes.readUInt16LE(28) & 0x3fff,
        };
      }
      if (chunk === "VP8L") {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function downloadImage(
  url: string,
): Promise<{
  bytes: Buffer;
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
} | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = await assertPublicHttpsUrl(current);
    const response = await fetch(target, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "user-agent": USER_AGENT,
        accept: "image/png,image/jpeg,image/webp,image/gif",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("图片跳转缺少地址");
      current = new URL(location, target).toString();
      continue;
    }
    if (!response.ok) throw new Error(`图片返回 ${response.status}`);
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(contentType)) throw new Error("图片类型不受支持");
    const bytes = await readCapped(response, MAX_IMAGE_BYTES);
    if (!bytes || bytes.length === 0) throw new Error("图片为空或超过 5MB");
    const detected = detectImage(bytes);
    if (!detected) throw new Error("图片文件格式不正确");
    const size = probeImageSize(bytes, detected.mime);
    return { bytes, ...detected, width: size?.width ?? null, height: size?.height ?? null };
  }
  throw new Error("图片跳转过多");
}

async function storeRemoteImageInternal(url: string): Promise<StoredImageWithSize | null> {
  const cached = remoteImageMemory.get(url);
  if (cached) return cached;
  try {
    const downloaded = await downloadImage(url);
    if (!downloaded) return null;
    const hash = createHash("sha256").update(downloaded.bytes).digest("hex");
    await query(
      `INSERT INTO shop_images (hash, mime, ext, bytes, byte_size)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (hash) DO NOTHING`,
      [hash, downloaded.mime, downloaded.ext, downloaded.bytes, downloaded.bytes.length],
    );
    const stored = {
      hash,
      mime: downloaded.mime,
      ext: downloaded.ext,
      byteSize: downloaded.bytes.length,
      width: downloaded.width,
      height: downloaded.height,
    };
    if (remoteImageMemory.size >= REMOTE_IMAGE_MEMORY_LIMIT) {
      const oldest = remoteImageMemory.keys().next().value;
      if (oldest) remoteImageMemory.delete(oldest);
    }
    remoteImageMemory.set(url, stored);
    return stored;
  } catch (error) {
    console.warn(
      `[shop/images] 跳过图片 ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Downloads an image and stores its bytes. Never throws; failures return null. */
export async function storeRemoteImage(url: string): Promise<StoredImage | null> {
  const stored = await storeRemoteImageInternal(url);
  if (!stored) return null;
  return { hash: stored.hash, ext: stored.ext, mime: stored.mime };
}

type ProductImageRow = {
  kind: "cover" | "description";
  position: number;
  imageHash: string;
  alt: string;
  sourceUrl: string;
};

type ExistingImageRow = {
  image_hash: string;
  ext: string;
  mime: string;
};

/**
 * Previous source URL -> stored image. Reusing these keeps the hourly sync
 * from re-downloading every unchanged image, and gives the article renderer a
 * mapping even when a fresh download fails.
 */
async function loadExistingProductImages(productId: string): Promise<Map<string, ExistingImageRow>> {
  const existing = new Map<string, ExistingImageRow>();
  try {
    const rows = await query<ExistingImageRow & { source_url: string }>(
      `SELECT spi.source_url, spi.image_hash, si.ext, si.mime
         FROM shop_product_images spi
         JOIN shop_images si ON si.hash = spi.image_hash
        WHERE spi.product_id = $1 AND spi.source_url <> ''`,
      [productId],
    );
    for (const row of rows.rows) {
      if (!existing.has(row.source_url)) {
        existing.set(row.source_url, {
          image_hash: row.image_hash,
          ext: row.ext,
          mime: row.mime,
        });
      }
    }
  } catch (error) {
    console.warn(`[shop/images] 读取商品 ${productId} 旧图片失败: ${String(error)}`);
  }
  return existing;
}

/**
 * Downloads the given images and swaps a product's image rows in one
 * transaction. Individual failures are skipped; if every image fails the
 * previous rows are left untouched rather than clearing the product gallery.
 *
 * Returns the mapping of original URL -> public path so the rich description
 * can point inline images at our own mirrored copies.
 */
export async function replaceProductImages(
  productId: string,
  input: { coverUrl?: string | null; images?: Array<{ url: string; alt?: string }> },
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  try {
    const existing = await loadExistingProductImages(productId);
    for (const [sourceUrl, image] of existing) {
      mapping.set(sourceUrl, imagePublicPath({ hash: image.image_hash, ext: image.ext }));
    }

    const rows: ProductImageRow[] = [];
    const resolve = async (
      sourceUrl: string,
      options: { cover?: boolean } = {},
    ): Promise<{ hash: string; ext: string } | null> => {
      const previous = existing.get(sourceUrl);
      if (previous) return { hash: previous.image_hash, ext: previous.ext };
      const stored = await storeRemoteImageInternal(sourceUrl);
      if (!stored || stored.byteSize < MIN_STORED_BYTES) return null;
      if (
        options.cover &&
        stored.width !== null &&
        stored.height !== null &&
        Math.min(stored.width, stored.height) < MIN_COVER_SIDE
      ) {
        // A 32x32 icon stretched across a card is worse than the brand cover.
        console.warn(
          `[shop/images] 跳过过小的封面 ${sourceUrl} (${stored.width}x${stored.height})`,
        );
        return null;
      }
      return { hash: stored.hash, ext: stored.ext };
    };

    if (input.coverUrl) {
      const stored = await resolve(input.coverUrl, { cover: true });
      if (stored) {
        rows.push({
          kind: "cover",
          position: 0,
          imageHash: stored.hash,
          alt: "",
          sourceUrl: input.coverUrl,
        });
        mapping.set(input.coverUrl, imagePublicPath(stored));
      }
    }

    const candidates = (input.images ?? [])
      .filter((image) => Boolean(image.url))
      .slice(0, DESCRIPTION_LIMIT);
    const seen = new Set<string>();
    let position = 0;
    for (const candidate of candidates) {
      if (position >= DESCRIPTION_LIMIT) break;
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      const stored = await resolve(candidate.url);
      if (!stored) continue;
      rows.push({
        kind: "description",
        position,
        imageHash: stored.hash,
        alt: (candidate.alt || "").slice(0, 200),
        sourceUrl: candidate.url,
      });
      mapping.set(candidate.url, imagePublicPath(stored));
      position += 1;
    }

    if (rows.length === 0) {
      console.warn(`[shop/images] 商品 ${productId} 本次没有可用图片，保留原有图片`);
      return mapping;
    }

    await withTransaction(async (client) => {
      await client.query("DELETE FROM shop_product_images WHERE product_id = $1", [productId]);
      for (const row of rows) {
        await client.query(
          `INSERT INTO shop_product_images
             (product_id, kind, position, image_hash, alt, source_url, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())`,
          [productId, row.kind, row.position, row.imageHash, row.alt, row.sourceUrl],
        );
      }
    });
    return mapping;
  } catch (error) {
    console.warn(
      `[shop/images] 商品 ${productId} 图片更新失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return mapping;
  }
}

export function imagePublicPath(image: { hash: string; ext: string }): string {
  return `/api/shop/images/${image.hash}.${image.ext}`;
}
