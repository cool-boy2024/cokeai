import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_PATTERN = /^([a-f0-9]{64})\.(mp4|webm)$/;

/**
 * Public endpoint for tutorial clips mirrored from the supplier help centre.
 * Bytes are content-addressed, so the URL is immutable. MP4 playback in
 * Safari and Chrome seeks with byte ranges, hence the Range support; without
 * a 206 response the browser can still play but cannot scrub.
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
    "SELECT mime, bytes FROM shop_media WHERE hash = $1",
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
  const total = row.bytes.byteLength;
  const baseHeaders = {
    "Content-Type": row.mime,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": cacheControl,
  };

  const ifNoneMatch = request.headers.get("if-none-match");
  const notModified =
    ifNoneMatch?.split(",").some((value) => {
      const candidate = value.trim();
      return candidate === etag || candidate === `W/${etag}`;
    }) ?? false;
  if (notModified) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, total) : null;
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
    });
  }
  if (range) {
    const chunk = row.bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
        "Content-Length": String(chunk.byteLength),
      },
    });
  }

  return new Response(new Uint8Array(row.bytes), {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}

/** Handles the single `bytes=start-end` form browsers send for video seeks. */
function parseRange(
  header: string,
  total: number,
): { start: number; end: number } | "invalid" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "invalid";
  let start: number;
  let end: number;
  if (!rawStart) {
    // Suffix range: bytes=-500 means the last 500 bytes.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return "invalid";
    start = Math.max(0, total - length);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : total - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return "invalid";
  }
  return { start, end: Math.min(end, total - 1) };
}
