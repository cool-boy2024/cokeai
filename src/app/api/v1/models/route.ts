import { authenticateApiKey } from "@/lib/auth";
import { query } from "@/lib/db";
import { retailCnyPerMillion } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth.user) {
    return Response.json(
      { error: { message: auth.error || "鉴权失败", type: "cokeai_error" } },
      { status: auth.status || 401, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
    );
  }

  const result = await query<{
    id: string;
    display_name: string;
    description: string;
    context_window: number;
    input_price_usd_micros_per_mtok: string;
    output_price_usd_micros_per_mtok: string;
    markup_bps: string;
  }>(
    `SELECT m.id, m.display_name, m.description, m.context_window,
            m.input_price_usd_micros_per_mtok, m.output_price_usd_micros_per_mtok, m.markup_bps
       FROM models m
       JOIN upstreams u ON u.id = m.upstream_id
      WHERE m.enabled = TRUE
        AND u.enabled = TRUE
        AND u.api_key_encrypted IS NOT NULL
        AND m.min_plan_tier <= $1
      ORDER BY m.sort_order, m.display_name`,
    [auth.user.planTier],
  );

  return Response.json(
    {
      object: "list",
      data: result.rows.map((model) => ({
        id: model.id,
        object: "model",
        created: 0,
        owned_by: "cokeai",
        name: model.display_name,
        description: model.description,
        context_window: model.context_window,
        pricing_cny_per_million_tokens: {
          input: Number(
            retailCnyPerMillion(
              model.input_price_usd_micros_per_mtok,
              model.markup_bps,
            ).toFixed(3),
          ),
          output: Number(
            retailCnyPerMillion(
              model.output_price_usd_micros_per_mtok,
              model.markup_bps,
            ).toFixed(3),
          ),
        },
      })),
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}
