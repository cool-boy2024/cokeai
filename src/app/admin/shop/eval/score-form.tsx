"use client";

import { useState, useTransition } from "react";
import { scoreEvalRun } from "@/app/actions/admin-shop-eval";

/** 1–5 星打分。点一下即保存，失败时在按钮下方提示。 */
export function EvalScoreForm({
  batchId,
  fixtureId,
  variant,
  current,
}: {
  batchId: string;
  fixtureId: string;
  variant: string;
  current: number | null;
}) {
  const [score, setScore] = useState<number | null>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(value: number) {
    const previous = score;
    setScore(value);
    setError(null);
    startTransition(async () => {
      const result = await scoreEvalRun({ batchId, fixtureId, variant, score: value });
      if (!result.ok) {
        setScore(previous);
        setError(result.error || "保存失败");
      }
    });
  }

  return (
    <div className="eval-score">
      <span className="eval-score-label">可用性</span>
      <div className="eval-score-stars" role="group" aria-label="草稿可用性打分">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className={`eval-star${score !== null && value <= score ? " is-on" : ""}`}
            onClick={() => pick(value)}
            disabled={pending}
            aria-label={`${value} 分`}
            aria-pressed={score === value}
          >
            ★
          </button>
        ))}
      </div>
      {score !== null ? <span className="eval-score-value">{score} 分</span> : null}
      {error ? <span className="text-red small">{error}</span> : null}
    </div>
  );
}
