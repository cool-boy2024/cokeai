/**
 * 评测指标测试。纯函数，无数据库、无网络：用构造的草稿断言每个维度都被
 * 正确判定，确保「可用」这个结论不会被误判成通过。
 */
import assert from "node:assert/strict";
import { scoreDraft, summarize, type EvalFixture } from "./eval/metrics";

const FIXTURE: EvalFixture = {
  id: "fx-1",
  title: "ChatGPT Plus 月度车位",
  priceMicros: 80_000_000,
  category: "subscription",
  displayCategory: "",
  sourceText: "ChatGPT Plus 月度独享。注意事项：仅支持官方客户端。",
  expect: { warrantyType: "first_login", hasNotice: true, minIncludes: 3 },
};

const GOOD = {
  name: "ChatGPT Plus 月度独享车位",
  subtitle: "即充即用，按订单页指引领取",
  description: "ChatGPT Plus 会员月度服务，下单后按订单页指引完成绑定。",
  includes: ["月度服务", "绑定指引", "售后支持"],
  usage: ["打开订单页查看指引。", "按指引绑定。", "有问题联系客服。"],
  notice: "仅支持官方客户端登录。",
  refund: "交付后不支持无理由退款。",
};

function withDraft(overrides: Record<string, unknown>) {
  return { ...GOOD, ...overrides };
}

function main() {
  // 1) 合格草稿：全绿。
  {
    const m = scoreDraft(GOOD, FIXTURE);
    assert.equal(m.schemaValid, true);
    assert.equal(m.leakCount, 0);
    assert.equal(m.priceMentions, 0);
    assert.equal(m.fieldsFilled, true);
    assert.equal(m.lengthOk, true);
    assert.equal(m.noticeLifted, true);
    assert.equal(m.includesEnough, true);
    assert.equal(m.usable, true, "合格草稿必须判为可用");
  }

  // 2) 内部黑话泄露：必须判不可用，并指出具体词。
  {
    const m = scoreDraft(withDraft({ description: "本商品按货源说明发货。" }), FIXTURE);
    assert.equal(m.leakCount > 0, true);
    assert.ok(m.leakSamples.includes("货源"));
    assert.equal(m.usable, false);
  }

  // 3) 外链泄露：任何域名都不允许。
  {
    const m = scoreDraft(withDraft({ description: "详见 https://example.com/help 说明。" }), FIXTURE);
    assert.ok(m.leakSamples.includes("外部链接"));
    assert.equal(m.usable, false);
  }

  // 4) 裸域名也算泄露。
  {
    const m = scoreDraft(withDraft({ usage: ["访问 example.com 查看教程。"] }), FIXTURE);
    assert.equal(m.leakCount > 0, true);
    assert.equal(m.usable, false);
  }

  // 5) 价格外露：文案不该出现具体数字。
  {
    const m = scoreDraft(withDraft({ subtitle: "仅需 ¥199 即可开通" }), FIXTURE);
    assert.equal(m.priceMentions > 0, true);
    assert.equal(m.usable, false);
  }
  {
    const m = scoreDraft(withDraft({ description: "本商品售价 199 元。" }), FIXTURE);
    assert.equal(m.priceMentions > 0, true);
  }

  // 6) Zod 不通过：字段缺失/为空。
  {
    const m = scoreDraft({ name: "短" }, FIXTURE);
    assert.equal(m.schemaValid, false);
    assert.equal(m.schemaErrors > 0, true);
    assert.equal(m.usable, false);
  }
  {
    const m = scoreDraft(withDraft({ includes: [] }), FIXTURE);
    assert.equal(m.schemaValid, false, "空 includes 必须被 Zod 拦下");
    assert.equal(m.usable, false);
  }

  // 7) 样本要求有 notice 但草稿没有：不可用。
  {
    const m = scoreDraft(withDraft({ notice: "" }), FIXTURE);
    assert.equal(m.noticeLifted, false);
    assert.equal(m.usable, false);
  }
  // 样本本身没有 notice 时，草稿没有也不算问题。
  {
    const noNotice: EvalFixture = {
      ...FIXTURE,
      expect: { ...FIXTURE.expect, hasNotice: false },
    };
    const m = scoreDraft(withDraft({ notice: "" }), noNotice);
    assert.equal(m.noticeLifted, true);
  }

  // 8) includes 少于样本要求。
  {
    const strict: EvalFixture = {
      ...FIXTURE,
      expect: { ...FIXTURE.expect, minIncludes: 5 },
    };
    const m = scoreDraft(GOOD, strict);
    assert.equal(m.includesEnough, false);
    assert.equal(m.usable, false);
  }

  // 9) 过度承诺也算泄露（买家不该看到绝对化承诺）。
  {
    const m = scoreDraft(withDraft({ subtitle: "保证100% 稳定" }), FIXTURE);
    assert.equal(m.leakCount > 0, true);
    assert.equal(m.usable, false);
  }

  // 10) 汇总：错误样本不计入分母，顺序稳定，人工分均值正确。
  {
    const rows = [
      { variant: "agent", metrics: scoreDraft(GOOD, FIXTURE), inputTokens: 100, outputTokens: 50, latencyMs: 3000, humanScore: 5 },
      { variant: "agent", metrics: scoreDraft(GOOD, FIXTURE), inputTokens: 200, outputTokens: 100, latencyMs: 5000, humanScore: 3 },
      { variant: "heuristic", metrics: scoreDraft(GOOD, FIXTURE), inputTokens: 0, outputTokens: 0, latencyMs: 5, humanScore: 2 },
      { variant: "single_shot", metrics: scoreDraft({}, FIXTURE), inputTokens: 0, outputTokens: 0, latencyMs: 1500, error: "upstream 500" },
    ];
    const summary = summarize(rows);
    assert.deepEqual(
      summary.map((row) => row.variant),
      ["heuristic", "single_shot", "agent"],
      "顺序必须固定为 heuristic → single_shot → agent",
    );
    const agent = summary.find((row) => row.variant === "agent");
    assert.ok(agent);
    assert.equal(agent.runs, 2);
    assert.equal(agent.errors, 0);
    assert.equal(agent.usablePct, 100);
    assert.equal(agent.avgInputTokens, 150);
    assert.equal(agent.avgHumanScore, 4);

    const single = summary.find((row) => row.variant === "single_shot");
    assert.ok(single);
    assert.equal(single.errors, 1);
    // 全部失败时不产生除零 NaN。
    assert.equal(single.usablePct, 0);
    assert.equal(single.avgInputTokens, 0);
  }

  console.log("test-eval-metrics: all assertions passed");
}

main();
