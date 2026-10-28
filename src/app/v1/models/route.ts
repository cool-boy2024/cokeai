import { authenticateApiKey } from "@/lib/auth";
import { listCatalogModels } from "@/lib/model-catalog";

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

  const models = await listCatalogModels();

  return Response.json(
    {
      object: "list",
      data: models
        .filter((model) => model.inputCnyPerMtok > 0 || model.outputCnyPerMtok > 0)
        .map((model) => ({
          id: model.id,
          object: "model",
          created: 0,
          owned_by: "cokeai",
          name: model.displayName,
          description: model.description,
          context_window: model.contextWindow,
          pricing_cny_per_million_tokens: {
            input: Number(model.inputCnyPerMtok.toFixed(3)),
            output: Number(model.outputCnyPerMtok.toFixed(3)),
          },
        })),
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}
