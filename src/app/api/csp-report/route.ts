import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSP violation sink. The enforced policy in next.config.ts points
 * `report-uri` here. Reports are unauthenticated browser telemetry, so only a
 * small, redacted slice is logged: full document URLs can contain query
 * strings, and a broken page can produce thousands of identical reports.
 */

const MAX_BODY_BYTES = 16_384;
const LOGS_PER_MINUTE = 20;

let windowStartedAt = 0;
let windowCount = 0;

type CspReport = {
  "document-uri"?: string;
  "blocked-uri"?: string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "source-file"?: string;
  "line-number"?: number;
  disposition?: string;
};

function hostAndPath(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return value.slice(0, 200);
  }
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  const body = (await request.text()).slice(0, MAX_BODY_BYTES);
  if (!body) return new NextResponse(null, { status: 204 });

  const now = Date.now();
  if (now - windowStartedAt > 60_000) {
    windowStartedAt = now;
    windowCount = 0;
  }
  if (windowCount < LOGS_PER_MINUTE) {
    windowCount += 1;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const report = (parsed["csp-report"] ?? parsed) as CspReport;
      console.warn(
        "[csp]",
        JSON.stringify({
          document: hostAndPath(report["document-uri"]),
          blocked: hostAndPath(report["blocked-uri"]),
          directive:
            report["effective-directive"] || report["violated-directive"],
          source: hostAndPath(report["source-file"]),
          line: report["line-number"],
          disposition: report.disposition,
        }),
      );
    } catch {
      console.warn("[csp] unparseable report");
    }
  }
  return new NextResponse(null, { status: 204 });
}
