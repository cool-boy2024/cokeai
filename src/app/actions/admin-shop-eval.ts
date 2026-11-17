"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * 人工可用性打分（1–5）。只更新 human_score/human_note，不动自动指标，
 * 也不触碰任何商品或订单数据。
 */
export async function scoreEvalRun(input: {
  batchId: string;
  fixtureId: string;
  variant: string;
  score: number;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();

  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, error: "分数必须是 1–5 的整数" };
  }
  if (!["heuristic", "single_shot", "agent"].includes(input.variant)) {
    return { ok: false, error: "未知方案" };
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.batchId) || !/^[0-9a-f]{8,}$/i.test(input.fixtureId)) {
    return { ok: false, error: "参数格式不正确" };
  }

  const updated = await query<{ id: string }>(
    `UPDATE ai_eval_runs
        SET human_score = $4, human_note = NULL
      WHERE batch_id = $1 AND fixture_id = $2 AND variant = $3
      RETURNING id`,
    [input.batchId, input.fixtureId, input.variant, score],
  );
  if (updated.rowCount === 0) {
    return { ok: false, error: "找不到该评测记录" };
  }

  revalidatePath("/admin/shop/eval");
  // 只记录打分动作本身，不记录运营身份之外的信息。
  void admin;
  return { ok: true };
}
