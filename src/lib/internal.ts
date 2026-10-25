import { sha256 } from "./crypto";

export function verifyInternalSecret(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || expected.length < 24) return false;
  const provided = request.headers.get("x-internal-secret") || "";
  if (!provided) return false;
  return sha256(provided) === sha256(expected);
}

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
