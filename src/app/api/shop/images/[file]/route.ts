import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_PATTERN = /^([a-f0-9]{64})\.(png|jpe?g|webp|gif)$/;

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

  const etag = `"${hash}"`;
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

  const bytes = new Uint8Array(row.bytes);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(bytes.byteLength),
      ETag: etag,
      "Cache-Control": cacheControl,
    },
  });
}
