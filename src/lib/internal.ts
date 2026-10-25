import { timingSafeEqual } from "node:crypto";

function safeEqual(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyInternalSecret(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || expected.length < 24) return false;
  const provided = request.headers.get("x-internal-secret") || "";
  if (!provided) return false;
  return safeEqual(expected, provided);
}

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
