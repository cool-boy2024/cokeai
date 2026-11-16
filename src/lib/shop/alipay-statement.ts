/**
 * 支付宝账单（CSV）解析。
 *
 * 个人支付宝不给第三方读账单的接口，运营只能自己在「账单 → 开具交易流水
 * 证明 / 下载账单」里导出，再把这个文件传到后台。所以这里做两件事：
 *
 *   1. 识别编码。支付宝导出的 CSV 常见两种编码：带 BOM 的 UTF-8，和
 *      GB18030（旧版客户端）。先用 UTF-8 试解，解出替换字符就回退 GB18030。
 *   2. 跳过前面的说明行，按表头找列，再把「收入 + 交易成功」的行变成
 *      结构化数据；从备注 / 商品说明 / 商家订单号里抠出我们自己的订单号。
 *
 * 这里是纯函数，不碰数据库，方便直接写测试。
 */

/** 我们自己的订单号格式：CK + 8 位日期 + 8 位十六进制（见 newOrderNo）。 */
const ORDER_NO_PATTERN = /CK\d{8}[0-9A-F]{8}/i;

export type AlipayStatementRow = {
  tradeNo: string;
  occurredAt: string;
  amountMicros: number;
  direction: "income" | "expense" | "other";
  tradeStatus: string;
  counterparty: string;
  counterpartyAccount: string;
  productDesc: string;
  remark: string;
  /** 从备注 / 商品说明 / 商家订单号里识别出的本站订单号。 */
  orderNo: string | null;
};

export type ParseResult = {
  rows: AlipayStatementRow[];
  /** 表头识别成功但被跳过的行数（支出、非成功状态等）。 */
  skipped: number;
  warnings: string[];
};

/**
 * 把上传的字节解成文本。
 *
 * Node 22 自带完整 ICU，`TextDecoder('gb18030')` 可用；不引入额外依赖。
 */
export function decodeStatement(bytes: Uint8Array): string {
  // UTF-8 BOM 优先。
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // U+FFFD 说明不是合法的 UTF-8，按支付宝旧版导出的 GB18030 再解一次。
  return utf8.includes("�") ? new TextDecoder("gb18030").decode(bytes) : utf8;
}

/** 一行 CSV 按引号规则切成字段。支付宝的备注里会带逗号。 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

const HEADER_ALIASES: Record<keyof RowFields, string[]> = {
  occurredAt: ["交易时间", "入账时间", "创建时间"],
  tradeNo: ["交易订单号", "支付宝交易号", "交易号"],
  amount: ["金额", "金额（元）", "金额(元)", "收支金额（元）", "收支金额(元)"],
  direction: ["收/支", "收支类型", "收支"],
  tradeStatus: ["交易状态", "状态"],
  counterparty: ["交易对方", "对方"],
  counterpartyAccount: ["对方账号", "对方账户"],
  productDesc: ["商品说明", "商品名称"],
  remark: ["备注", "付款备注", "买家备注"],
  merchantOrderNo: ["商家订单号", "商户订单号"],
  category: ["交易分类", "分类"],
};

type RowFields = {
  occurredAt: number;
  tradeNo: number;
  amount: number;
  direction: number;
  tradeStatus: number;
  counterparty: number;
  counterpartyAccount: number;
  productDesc: number;
  remark: number;
  merchantOrderNo: number;
  category: number;
};

type ColumnIndex = Partial<Record<keyof RowFields, number>>;

function mapHeader(fields: string[]): ColumnIndex | null {
  const normalized = fields.map((name) => name.replace(/\s/g, ""));
  const index: ColumnIndex = {};
  // 按别名的书写顺序精确匹配，不做前缀匹配——否则「收支」会把
  // 「收支金额(元)」当成收/支列。
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [keyof RowFields, string[]]
  >) {
    for (const alias of aliases) {
      const position = normalized.indexOf(alias);
      if (position >= 0) {
        index[key] = position;
        break;
      }
    }
  }
  // 没有交易号和金额这两列，就不是账单。
  if (index.tradeNo === undefined || index.amount === undefined) return null;
  return index;
}

/** `2026-11-16 10:23:45` 是北京时间，按 +08:00 解释。 */
function parseOccurredAt(value: string): string | null {
  const match = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(
    value,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(
    2,
    "0",
  )}:${minute}:${(second || "00").padStart(2, "0")}+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseAmountMicros(value: string): number | null {
  const cleaned = value.replace(/[¥￥,\s]/g, "").replace(/^[+-]/, "");
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;
  const micros = Math.round(Number(cleaned) * 1_000_000);
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
}

function classifyDirection(value: string): "income" | "expense" | "other" {
  const text = value.replace(/\s/g, "");
  if (/^(收|收入|转入|入账)$/.test(text)) return "income";
  if (/^(支|支出|转出|出账)$/.test(text)) return "expense";
  return "other";
}

function pick(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] || "").trim();
}

/**
 * 解析整份账单。
 *
 * 表头之前的说明行会被跳过；表头之后按列名取值，不依赖列顺序。只保留
 * 「收入 + 交易成功」的行——退款、转出、失败的交易不是我们的订单款。
 */
export function parseAlipayStatement(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];

  // 表头行：同时含「交易时间」和「金额」。
  let headerLine = -1;
  let columns: ColumnIndex | null = null;
  let delimiter = ",";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.includes("交易时间")) continue;
    const candidateDelimiter = line.includes("\t") && !line.includes(",") ? "\t" : ",";
    const fields = splitCsvLine(line, candidateDelimiter);
    const mapped = mapHeader(fields);
    if (mapped) {
      headerLine = i;
      columns = mapped;
      delimiter = candidateDelimiter;
      break;
    }
  }

  if (!columns) {
    return {
      rows: [],
      skipped: 0,
      warnings: ["没有找到账单表头。请确认上传的是支付宝导出的账单 CSV（含「交易时间」「金额」等列）。"],
    };
  }

  const rows: AlipayStatementRow[] = [];
  let skipped = 0;

  for (let i = headerLine + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    // 账单末尾常见「----------」分隔的汇总说明，一并跳过。
    if (/^[-—\s]+$/.test(line)) continue;

    const fields = splitCsvLine(line, delimiter);
    // 账单末尾常有「共 4 笔」「----------」这类汇总行，字段数明显不足，
    // 静默跳过，不计入「被过滤的交易」。
    if (fields.length < 3) continue;
    const tradeNo = pick(fields, columns.tradeNo);
    if (!tradeNo) {
      skipped += 1;
      continue;
    }

    const direction = classifyDirection(
      pick(fields, columns.direction) || pick(fields, columns.category),
    );
    const tradeStatus = pick(fields, columns.tradeStatus);
    const amountMicros = parseAmountMicros(pick(fields, columns.amount));
    const occurredAt = parseOccurredAt(pick(fields, columns.occurredAt));

    if (direction !== "income" || !amountMicros || !occurredAt) {
      skipped += 1;
      continue;
    }
    if (tradeStatus && !/成功|已收钱|交易成功/.test(tradeStatus)) {
      skipped += 1;
      continue;
    }

    const remark = pick(fields, columns.remark);
    const productDesc = pick(fields, columns.productDesc);
    const merchantOrderNo = pick(fields, columns.merchantOrderNo);
    const haystack = `${merchantOrderNo} ${productDesc} ${remark}`;
    const orderMatch = ORDER_NO_PATTERN.exec(haystack);

    rows.push({
      tradeNo,
      occurredAt,
      amountMicros,
      direction,
      tradeStatus,
      counterparty: pick(fields, columns.counterparty),
      counterpartyAccount: pick(fields, columns.counterpartyAccount),
      productDesc,
      remark,
      orderNo: orderMatch ? orderMatch[0].toUpperCase() : null,
    });
  }

  if (rows.length === 0) {
    warnings.push("账单里没有可用的收入记录（只统计「收入 + 交易成功」）。");
  }

  return { rows, skipped, warnings };
}
