import sharp from "sharp";
import { query } from "@/lib/db";
import { SHOP_IMAGE_WIDTHS } from "@/lib/shop/media-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_PATTERN = /^([a-f0-9]{64})\.(png|jpe?g|webp|gif)$/;
const VARIANT_WIDTHS = new Set<number>(SHOP_IMAGE_WIDTHS);

// Variants are deterministic for a given hash and width, so an in-process
// cache avoids re-encoding the same cover for every edge cache miss. The cap
// keeps a busy catalogue from growing the Node heap without bound.
const VARIANT_CACHE_LIMIT = 160;
const variantCache = new Map<string, { bytes: Buffer; mime: string }>();

function rememberVariant(key: string, value: { bytes: Buffer; mime: string }) {
  variantCache.set(key, value);
  if (variantCache.size > VARIANT_CACHE_LIMIT) {
    const oldest = variantCache.keys().next().value;
    if (oldest) variantCache.delete(oldest);
  }
}

/**
 * Public, unauthenticated image endpoint. Bytes are content-addressed by
 * sha256, so a given URL never changes and can be cached immutably.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const match = FILE_PATTERN.exec(file);
  if (!match) {
    return new Response("Bad Request", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const hash = match[1];

  const result = await query<{ mime: string; bytes: Buffer }>(
    "SELECT mime, bytes FROM shop_images WHERE hash = $1",
    [hash],
  );
  const row = result.rows[0];
  if (!row) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // `?w=` asks for a resized WebP variant. Only the fixed ladder is accepted,
  // so an arbitrary width cannot turn this public endpoint into an encoder.
  const requestedWidth = Number(new URL(request.url).searchParams.get("w"));
  const variantWidth =
    Number.isInteger(requestedWidth) && VARIANT_WIDTHS.has(requestedWidth)
      ? requestedWidth
      : null;
  // Animated GIFs keep their original bytes; resizing frames is not supported.
  const useVariant = variantWidth !== null && row.mime !== "image/gif";

  let mime = row.mime;
  let bytes = row.bytes;
  let etag = `"${hash}"`;

  if (useVariant) {
    const key = `${hash}-w${variantWidth}`;
    const cached = variantCache.get(key);
    if (cached) {
      mime = cached.mime;
      bytes = cached.bytes;
      etag = `"${key}"`;
    } else {
      try {
        bytes = await sharp(row.bytes)
          .resize({ width: variantWidth, withoutEnlargement: true })
          .webp({ quality: 72 })
          .toBuffer();
        mime = "image/webp";
        etag = `"${key}"`;
        rememberVariant(key, { bytes, mime });
      } catch (error) {
        console.warn(
          `[shop/images] 生成缩略图失败 ${hash} w=${variantWidth}:`,
          error instanceof Error ? error.message : error,
        );
        // Fall back to the original bytes and original ETag. Never label
        // original bytes with the variant ETag: a later successful encode
        // would then reuse that ETag for different bytes.
        mime = row.mime;
        bytes = row.bytes;
      }
    }
  }

  const cacheControl = "public, max-age=31536000, immutable";
  const ifNoneMatch = request.headers.get("if-none-match");
  const notModified =
    ifNoneMatch?.split(",").some((value) => {
      const candidate = value.trim();
      return candidate === etag || candidate === `W/${etag}`;
    }) ?? false;
  if (notModified) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  const body = new Uint8Array(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(body.byteLength),
      ETag: etag,
      "Cache-Control": cacheControl,
    },
  });
}
