/**
 * 受控 Agent 工具循环测试。不联网、不碰生产：模型调用通过注入的假模型
 * 回放 tool_calls，覆盖正常终止、校验重试、重试耗尽、轮数上限与轨迹
 * 脱敏。走网关的真实调用由 SHOP_IMPORT_AGENT_ENABLED 灰度后再人工验证。
 */
import assert from "node:assert/strict";
import { loadEnv } from "./env.mjs";
import {
  generateAgentCopy,
  type AgentOfferContext,
} from "../src/lib/shop/import-agent";
import { sanitizeSupplierCopy } from "../src/lib/shop/sanitize";

loadEnv();

type FakeCall = {
  content?: string | null;
  toolCalls?: Array<{ name: string; args: unknown }>;
};

/** 与 callGatewayModel 的返回结构一致；测试只回放，不联网。 */
type ModelReply = {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
  usage: { promptTokens: number; completionTokens: number } | null;
  rawUsage: unknown;
};

function fakeModel(
  script: FakeCall[],
  usage = { promptTokens: 100, completionTokens: 40 },
) {
  let calls = 0;
  return async (): Promise<ModelReply> => {
    const reply = script[Math.min(calls, script.length - 1)];
    calls += 1;
    return {
      content: reply.content ?? null,
      toolCalls: (reply.toolCalls || []).map((call, index) => ({
        id: `call-${calls}-${index}`,
        name: call.name,
        args: call.args,
      })),
      usage: { ...usage },
      rawUsage: {
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
      },
    };
  };
}

const VALID_DRAFT = {
  name: "ChatGPT Plus 月度独享车位",
  subtitle: "即充即用，按订单页指引领取",
  description: "ChatGPT Plus 会员月度服务，下单后按订单页指引完成绑定与领取。",
  includes: ["ChatGPT Plus 月度服务", "绑定指引", "售后支持"],
  usage: ["下单后打开订单页查看指引。", "按指引完成绑定。", "有问题先联系客服。"],
};

const CTX: AgentOfferContext = {
  offer: {
    id: "01933333-0000-7000-8000-000000000001",
    source_title: "ChatGPT Plus 月度 独享 干净车",
    source_store: "某某数字商店",
    url: "https://supplier.example.com/item/abc",
    price_micros: "80000000",
  },
  sourceText: sanitizeSupplierCopy(
    [
      "ChatGPT Plus 月度独享。",
      "注意事项：仅支持官方客户端登录，不支持第三方。",
      "退款说明：交付后不支持无理由退款。",
      "质保：首登质保，登录成功即完成质保。",
      "客服不会主动私聊，谨防诈骗。",
    ].join("\n"),
    { store: "某某数字商店", url: "https://supplier.example.com/item/abc" },
  ),
  category: "subscription",
  displayCategory: "",
  targetMarginBps: 3000,
};

async function main() {
  // 1) 正常路径：读规则 → 读模板 → 提交。
  {
    const model = fakeModel([
      { toolCalls: [{ name: "read_pricing_rules", args: {} }] },
      { toolCalls: [{ name: "read_notice_template", args: {} }] },
      { toolCalls: [{ name: "submit_draft", args: VALID_DRAFT }] },
    ]);
    const result = await generateAgentCopy(CTX, model);
    assert.equal(result.copy.engine, "agent");
    assert.equal(result.copy.name, VALID_DRAFT.name);
    assert.equal(result.modelCalls, 3);
    assert.equal(result.toolCalls, 3);
    assert.equal(result.inputTokens, 300);
    assert.equal(result.outputTokens, 120);
    // 买家规则仍然来自 extractNoticeCopy 抬原文，而不是模型输出。
    assert.match(result.copy.notice, /仅支持官方客户端登录/);
    assert.equal(result.copy.warranty_type, "first_login");
    // 轨迹只存摘要：供应商名与货源 URL 不允许出现在 steps 里。
    const stepsJson = JSON.stringify(result.steps);
    assert.ok(!stepsJson.includes("supplier.example.com"));
    assert.ok(!stepsJson.includes("某某数字商店"));
    assert.ok(result.steps.some((step) => step.kind === "submit"));
    assert.ok(result.steps.some((step) => step.kind === "stop"));
  }

  // 2) 校验失败 → 模型修正 → 成功（一次重试）。
  {
    const model = fakeModel([
      { toolCalls: [{ name: "submit_draft", args: { ...VALID_DRAFT, name: "短" } }] },
      { toolCalls: [{ name: "submit_draft", args: VALID_DRAFT }] },
    ]);
    const result = await generateAgentCopy(CTX, model);
    assert.equal(result.copy.name, VALID_DRAFT.name);
    const stepJson = JSON.stringify(result.steps);
    assert.match(stepJson, /校验失败（第 1 次）/);
  }

  // 3) 重试耗尽：连续 3 次非法提交必须抛错（调用方回退 heuristicCopy）。
  {
    const model = fakeModel([
      { toolCalls: [{ name: "submit_draft", args: { ...VALID_DRAFT, name: "短" } }] },
      { toolCalls: [{ name: "submit_draft", args: { ...VALID_DRAFT, name: "短" } }] },
      { toolCalls: [{ name: "submit_draft", args: { ...VALID_DRAFT, name: "短" } }] },
    ]);
    await assert.rejects(
      () => generateAgentCopy(CTX, model),
      /submit_draft 连续 3 次校验失败/,
    );
  }

  // 4) 模型一直不调用工具：轮数上限兜底，绝不无限循环。
  {
    const model = fakeModel([{ content: "我先想想……" }]);
    await assert.rejects(
      () => generateAgentCopy(CTX, model),
      /未调用工具|轮上限/,
    );
  }

  // 5) 未知工具直接拒绝并写进轨迹，循环继续。
  {
    const model = fakeModel([
      { toolCalls: [{ name: "run_sql", args: { sql: "DROP TABLE users" } }] },
      { toolCalls: [{ name: "submit_draft", args: VALID_DRAFT }] },
    ]);
    const result = await generateAgentCopy(CTX, model);
    assert.equal(result.copy.name, VALID_DRAFT.name);
    const stepJson = JSON.stringify(result.steps);
    assert.match(stepJson, /未知工具，已拒绝/);
    // 危险参数绝不进轨迹。
    assert.ok(!stepJson.includes("DROP TABLE"));
  }

  console.log("test-shop-import-agent: all assertions passed");
}

main();
