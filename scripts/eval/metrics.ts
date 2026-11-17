import { AI_SCHEMA } from "@/lib/shop/import";
import { isAllowedHost } from "@/lib/shop/sanitize";

/**
 * 三方案评测的自动指标。全部是纯函数：给定一份草稿和一条样本，算出可比较
 * 的数字。人工打分（1–5 可用性）另行记录到 ai_eval_runs.human_score。
 *
 * 设计原则：只测「能一句话说清对错」的东西。文案好不好仍然靠人看，但
 * 结构合规、泄露、价格外露这类硬伤必须自动拦住，否则对比毫无意义。
 */

export type EvalDraft = {
  name: string;
  subtitle: string;
  description: string;
  includes: string[];
  usage: string[];
  notice?: string;
  refund?: string;
};

export type EvalFixture = {
  /** 样本标识，取标题+正文的摘要，不含货源 URL。 */
  id: string;
  title: string;
  priceMicros: number;
  category: string;
  displayCategory: string;
  /** 已脱敏的货源正文。Never contains supplier store name or URL. */
  sourceText: string;
  /** 人工标注的关键事实，用来判断模型有没有编造。 */
  expect: {
    warrantyType: "first_login" | "days" | "none";
    hasNotice: boolean;
    minIncludes: number;
  };
};

export type EvalMetrics = {
  schemaValid: boolean;
  schemaErrors: number;
  /** 命中禁词/供应商词条数。 */
  leakCount: number;
  leakSamples: string[];
  /** 出现具体价格数字（¥xx / xx 元）的次数，应当为 0。 */
  priceMentions: number;
  /** 五个必填字段是否都非空。 */
  fieldsFilled: boolean;
  /** 长度/条数是否落在店铺规范内。 */
  lengthOk: boolean;
  lengthIssues: string[];
  /** 买家规则是否抬到了原文（notice 非空且与样本预期一致）。 */
  noticeLifted: boolean;
  /** includes 条数是否达到样本要求。 */
  includesEnough: boolean;
  /** 综合「可用」判定：不泄露、不报价、字段齐全、长度合规。 */
  usable: boolean;
};

/**
 * 内部黑话与供应商痕迹。草稿里出现任何一个都算泄露——买家文案不该带这些，
 * 也说明脱敏链路有漏洞。公开进仓库的只有规则本身，不含任何真实店铺名。
 */
const LEAK_TERMS = [
  "货源",
  "供货商",
  "供应商",
  "上游",
  "拿货",
  "进价",
  "成本价",
  "代理价",
  "批发价",
  "卡台",
  "结算价",
  "返点",
];

/** 域名形态：任何 http(s) 链接或裸域名都算外链泄露。 */
const URL_PATTERN = /https?:\/\/[^\s，。；、）)】\]"'<>]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|cn|net|org|cc|io|ai|me|vip|xyz|shop|app|dev|club|top|site|online|store|live|link|info|biz|fun|tv|us|uk|hk|tw|jp|kr|sg|cloud|co)\b/i;

/** 价格：¥199 / 199元 / 199 元 / $19.9。文案里不该出现具体数字。 */
const PRICE_PATTERN = /¥\s*\d|\$\s*\d|\d+(?:\.\d+)?\s*元/;

const LIMITS = {
  nameMax: 120,
  subtitleMax: 120,
  descriptionMax: 2000,
  includesMin: 1,
  includesMax: 8,
  usageMin: 1,
  usageMax: 10,
};

/**
 * 模型编造/夸大的措辞。只对模型写的五个字段生效——notice/refund 是逐行
 * 抬货源原文，原话里出现「绝对不要…」「永久有效」是正常内容，不是模型
 * 编造，算泄露会冤枉规则版和抬原文链路。
 */
const OVERCLAIM_TERMS = ["保证100%", "百分百", "包赔"];

function scanLeaks(draft: EvalDraft, fixture: EvalFixture): {
  count: number;
  samples: string[];
} {
  const samples: string[] = [];
  const modelText = [
    draft.name,
    draft.subtitle,
    draft.description,
    ...(draft.includes || []),
    ...(draft.usage || []),
  ].join("\n");
  // 买家可见字段全部扫一遍（notice/refund 由系统抬原文，也应已脱敏）。
  const allText = [modelText, draft.notice || "", draft.refund || ""].join("\n");

  // 内部黑话：任何字段都不允许出现。
  for (const term of LEAK_TERMS) {
    if (allText.includes(term)) samples.push(term);
  }
  // 过度承诺：只查模型写的字段。
  for (const term of OVERCLAIM_TERMS) {
    if (modelText.includes(term)) samples.push(term);
  }
  // 外链：官方产品域名（chatgpt.com / claude.ai 等）是使用说明的一部分，
  // 只有非官方域名才算泄露。
  const urls = allText.match(new RegExp(URL_PATTERN.source, "gi")) || [];
  for (const value of urls) {
    const host = hostFromValue(value);
    if (!host || !isAllowedHost(host)) {
      samples.push("外部链接");
      break;
    }
  }

  return { count: samples.length, samples };
}

/** 裸域名补成 URL 后取 host，和 sanitize 的判定保持同一口径。 */
function hostFromValue(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

function countPriceMentions(draft: EvalDraft): number {
  const text = [
    draft.name,
    draft.subtitle,
    draft.description,
    ...(draft.includes || []),
    ...(draft.usage || []),
  ].join("\n");
  const matches = text.match(new RegExp(PRICE_PATTERN.source, "g"));
  return matches ? matches.length : 0;
}

function checkLength(draft: EvalDraft): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (draft.name.length > LIMITS.nameMax) issues.push(`name 超过 ${LIMITS.nameMax} 字`);
  if (draft.subtitle.length > LIMITS.subtitleMax)
    issues.push(`subtitle 超过 ${LIMITS.subtitleMax} 字`);
  if (draft.description.length > LIMITS.descriptionMax)
    issues.push(`description 超过 ${LIMITS.descriptionMax} 字`);
  const includes = draft.includes?.length ?? 0;
  if (includes < LIMITS.includesMin) issues.push("includes 为空");
  if (includes > LIMITS.includesMax) issues.push(`includes 超过 ${LIMITS.includesMax} 条`);
  const usage = draft.usage?.length ?? 0;
  if (usage < LIMITS.usageMin) issues.push("usage 为空");
  if (usage > LIMITS.usageMax) issues.push(`usage 超过 ${LIMITS.usageMax} 条`);
  return { ok: issues.length === 0, issues };
}

/**
 * 计算一份草稿的全部自动指标。schema 校验用与上架链路完全相同的 AI_SCHEMA，
 * 保证「评测通过」和「能真正落库」是一回事。
 */
export function scoreDraft(draft: unknown, fixture: EvalFixture): EvalMetrics {
  const parsed = AI_SCHEMA.safeParse(draft);
  const safe: EvalDraft = parsed.success
    ? (parsed.data as EvalDraft)
    : {
        name: "",
        subtitle: "",
        description: "",
        includes: [],
        usage: [],
      };

  // schema 不通过时也尽力评估其余维度，但 usable 必然为 false。
  // 注意：AI_SCHEMA 只声明 5 个文案字段，Zod 默认会 strip 掉 notice/refund，
  // 所以 candidate 必须以原始草稿为底、再用校验后的值覆盖，否则买家规则
  // 永远被误判成「没抬到原文」。
  const candidate = parsed.success
    ? ({ ...(draft as EvalDraft), ...(parsed.data as EvalDraft) })
    : ({ ...(draft as EvalDraft) } as EvalDraft);
  const leaks = scanLeaks(
    {
      ...safe,
      ...candidate,
      includes: candidate.includes || [],
      usage: candidate.usage || [],
    },
    fixture,
  );
  const priceMentions = countPriceMentions({
    ...safe,
    ...candidate,
    includes: candidate.includes || [],
    usage: candidate.usage || [],
  });
  const length = checkLength({
    ...safe,
    ...candidate,
    includes: candidate.includes || [],
    usage: candidate.usage || [],
  });
  const fieldsFilled =
    Boolean(candidate.name?.trim()) &&
    Boolean(candidate.subtitle?.trim()) &&
    Boolean(candidate.description?.trim()) &&
    (candidate.includes?.length ?? 0) > 0 &&
    (candidate.usage?.length ?? 0) > 0;
  const noticeLifted = fixture.expect.hasNotice
    ? Boolean(candidate.notice?.trim())
    : true;
  const includesEnough =
    (candidate.includes?.length ?? 0) >= fixture.expect.minIncludes;

  return {
    schemaValid: parsed.success,
    schemaErrors: parsed.success ? 0 : parsed.error.issues.length,
    leakCount: leaks.count,
    leakSamples: leaks.samples,
    priceMentions,
    fieldsFilled,
    lengthOk: length.ok,
    lengthIssues: length.issues,
    noticeLifted,
    includesEnough,
    usable:
      parsed.success &&
      leaks.count === 0 &&
      priceMentions === 0 &&
      fieldsFilled &&
      length.ok &&
      noticeLifted &&
      includesEnough,
  };
}

export type VariantSummary = {
  variant: string;
  runs: number;
  errors: number;
  schemaValidPct: number;
  leakFreePct: number;
  usablePct: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgLatencyMs: number;
  totalTokens: number;
  avgHumanScore: number | null;
};

/** 把一批评测结果聚合成一行对比数据（后台表格与图表的数据源）。 */
export function summarize(
  rows: Array<{
    variant: string;
    metrics: EvalMetrics;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    error?: string | null;
    humanScore?: number | null;
  }>,
): VariantSummary[] {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = groups.get(row.variant) || [];
    list.push(row);
    groups.set(row.variant, list);
  }
  const pct = (n: number, total: number) =>
    total === 0 ? 0 : (n / total) * 100;

  return [...groups.entries()]
    .map(([variant, list]) => {
      const ok = list.filter((row) => !row.error);
      const scored = list.filter((row) => row.humanScore != null);
      const sum = (fn: (row: (typeof list)[number]) => number) =>
        ok.reduce((total, row) => total + fn(row), 0);
      return {
        variant,
        runs: list.length,
        errors: list.length - ok.length,
        schemaValidPct: pct(ok.filter((row) => row.metrics.schemaValid).length, ok.length),
        leakFreePct: pct(ok.filter((row) => row.metrics.leakCount === 0).length, ok.length),
        usablePct: pct(ok.filter((row) => row.metrics.usable).length, ok.length),
        avgInputTokens: ok.length ? Math.round(sum((row) => row.inputTokens) / ok.length) : 0,
        avgOutputTokens: ok.length ? Math.round(sum((row) => row.outputTokens) / ok.length) : 0,
        avgLatencyMs: ok.length ? Math.round(sum((row) => row.latencyMs) / ok.length) : 0,
        totalTokens: sum((row) => row.inputTokens + row.outputTokens),
        avgHumanScore: scored.length
          ? Number(
              (
                scored.reduce((total, row) => total + Number(row.humanScore), 0) /
                scored.length
              ).toFixed(2),
            )
          : null,
      };
    })
    .sort((a, b) => {
      // 稳定顺序：heuristic → single_shot → agent，便于横向对比。
      const order = ["heuristic", "single_shot", "agent"];
      return order.indexOf(a.variant) - order.indexOf(b.variant);
    });
}
