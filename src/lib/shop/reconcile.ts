import { query, toNumber } from "@/lib/db";
import { markShopOrderPaid } from "./orders";
import type { AlipayStatementRow } from "./alipay-statement";

/**
 * 支付宝账单对账。
 *
 * 客户付款后会上报交易号并传一张付款成功截图，但那是「人证」；真正的
 * 判定依据是运营从支付宝导出的账单。这里把导入的流水落到
 * alipay_statement_rows，按下面顺序自动归属：
 *
 *   1. 备注 / 商品说明 / 商家订单号里带本站订单号 → 精确归属；
 *   2. 金额只对应一张待支付的人工支付宝订单 → 金额唯一归属；
 *   3. 金额对应多张 → 列为候选，人工挑；
 *   4. 对不上任何订单 → 未归属池，等人工处理。
 *
 * **永远不自动确认到账。** 自动归属只是把候选摆好，最终一步必须运营点，
 * 因为确认到账会直接改变订单状态、触发交付。
 */

export type StatementRow = {
  id: string;
  trade_no: string;
  occurred_at: string;
  amount_micros: number;
  trade_status: string;
  counterparty: string;
  counterparty_account: string;
  product_desc: string;
  remark: string;
  order_id: string | null;
  order_no: string | null;
  match_kind: "order_no" | "amount_unique" | "amount_multi" | "unmatched" | "manual";
  settled_at: string | null;
  created_at: string;
};

export type CandidateOrder = {
  id: string;
  order_no: string;
  amount_micros: number;
  created_at: string;
  email: string;
  product_name: string;
  status: string;
  reported_reference: string | null;
  reported_at: string | null;
};

export type Board = {
  /** 已自动归属、等运营点确认的流水。 */
  matched: Array<StatementRow & { order: CandidateOrder | null }>;
  /** 金额对多张单 / 对不上任何单，需要人工指定。 */
  ambiguous: Array<StatementRow & { candidates: CandidateOrder[] }>;
  /** 最近已确认的流水。 */
  settled: StatementRow[];
  /** 客户报了交易号、但账单里还没导入对应流水的订单。 */
  reportedWithoutStatement: CandidateOrder[];
};

export type ImportSummary = {
  received: number;
  inserted: number;
  duplicates: number;
  matchedOrderNo: number;
  matchedAmount: number;
  ambiguous: number;
  unmatched: number;
};

function rowAmountCents(micros: number): number {
  return Math.round(micros / 10_000);
}

async function findPendingManualOrderByNo(orderNo: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT o.id
       FROM shop_orders o
      WHERE o.order_no = $1
        AND o.status = 'pending_payment'
        AND o.payment_provider = 'alipay_manual'
        AND NOT EXISTS (
          SELECT 1 FROM alipay_statement_rows r WHERE r.order_id = o.id
        )
      LIMIT 1`,
    [orderNo],
  );
  return result.rows[0]?.id ?? null;
}

async function findPendingManualOrdersByAmount(cents: number): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT o.id
       FROM shop_orders o
      WHERE o.status = 'pending_payment'
        AND o.payment_provider = 'alipay_manual'
        AND round(o.amount_micros / 10000.0) = $1
        AND NOT EXISTS (
          SELECT 1 FROM alipay_statement_rows r WHERE r.order_id = o.id
        )
      ORDER BY o.created_at DESC
      LIMIT 25`,
    [cents],
  );
  return result.rows.map((row) => row.id);
}

/** 订单号是否存在（不管什么状态），用来区分「写错了单号」和「这单已经处理过」。 */
async function orderNoExists(orderNo: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    "SELECT id FROM shop_orders WHERE order_no = $1 LIMIT 1",
    [orderNo],
  );
  return Boolean(result.rows[0]);
}

/**
 * 导入一批流水。重复的交易号直接跳过，可以放心重复上传同一份账单。
 */
export async function importAlipayStatement(input: {
  adminId: string;
  rows: AlipayStatementRow[];
}): Promise<ImportSummary> {
  const summary: ImportSummary = {
    received: input.rows.length,
    inserted: 0,
    duplicates: 0,
    matchedOrderNo: 0,
    matchedAmount: 0,
    ambiguous: 0,
    unmatched: 0,
  };

  for (const row of input.rows) {
    const inserted = await query<{ id: string }>(
      `INSERT INTO alipay_statement_rows
         (trade_no, occurred_at, amount_micros, direction, trade_status,
          counterparty, counterparty_account, product_desc, remark, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (trade_no) DO NOTHING
       RETURNING id`,
      [
        row.tradeNo,
        row.occurredAt,
        row.amountMicros,
        row.direction,
        row.tradeStatus,
        row.counterparty,
        row.counterpartyAccount,
        row.productDesc,
        row.remark,
        input.adminId,
      ],
    );
    const statementId = inserted.rows[0]?.id;
    if (!statementId) {
      summary.duplicates += 1;
      continue;
    }
    summary.inserted += 1;

    let orderId: string | null = null;
    let kind: StatementRow["match_kind"] = "unmatched";
    let orderNo: string | null = null;

    // 客户在备注里写了订单号。如果这单还在待支付，直接归属；如果订单号
    // 存在但已经付过/关掉，就停在「未归属」让人工看——绝不能退回去按金额
    // 猜，那样会把一笔已经处理过的钱绑到别人的单上。
    let referencedPaidOrder = false;
    if (row.orderNo) {
      orderId = await findPendingManualOrderByNo(row.orderNo);
      if (orderId) {
        kind = "order_no";
        orderNo = row.orderNo;
        summary.matchedOrderNo += 1;
      } else {
        referencedPaidOrder = await orderNoExists(row.orderNo);
      }
    }
    if (!orderId && !referencedPaidOrder) {
      const candidates = await findPendingManualOrdersByAmount(rowAmountCents(row.amountMicros));
      if (candidates.length === 1) {
        orderId = candidates[0];
        kind = "amount_unique";
        summary.matchedAmount += 1;
      } else if (candidates.length > 1) {
        kind = "amount_multi";
        summary.ambiguous += 1;
      } else {
        summary.unmatched += 1;
      }
    } else if (!orderId) {
      summary.unmatched += 1;
    }

    if (orderId) {
      const orderRow = await query<{ order_no: string }>(
        "SELECT order_no FROM shop_orders WHERE id = $1",
        [orderId],
      );
      orderNo = orderRow.rows[0]?.order_no ?? orderNo;
    }

    await query(
      `UPDATE alipay_statement_rows
          SET order_id = $2, order_no = $3, match_kind = $4
        WHERE id = $1`,
      [statementId, orderId, orderNo, kind],
    );
  }

  return summary;
}

/**
 * pg 把 timestamptz 返回成 Date。直接 String() 得到的是带中文时区名的
 * 本地格式（"Tue Nov 16 2026 … GMT+0800 (中国标准时间)"），再塞回
 * $n::timestamptz 会报 invalid input syntax。统一转 ISO。
 */
function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value ?? "");
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function mapRow(row: Record<string, unknown>): StatementRow {
  return {
    id: String(row.id),
    trade_no: String(row.trade_no),
    occurred_at: asIso(row.occurred_at),
    amount_micros: toNumber(row.amount_micros as string | number),
    trade_status: String(row.trade_status || ""),
    counterparty: String(row.counterparty || ""),
    counterparty_account: String(row.counterparty_account || ""),
    product_desc: String(row.product_desc || ""),
    remark: String(row.remark || ""),
    order_id: row.order_id ? String(row.order_id) : null,
    order_no: row.order_no ? String(row.order_no) : null,
    match_kind: row.match_kind as StatementRow["match_kind"],
    settled_at: row.settled_at ? asIso(row.settled_at) : null,
    created_at: asIso(row.created_at),
  };
}

const CANDIDATE_SELECT = `
  SELECT o.id, o.order_no, o.amount_micros, o.created_at, o.status,
         u.email, i.product_name,
         p.reported_reference, p.reported_at
    FROM shop_orders o
    JOIN users u ON u.id = o.user_id
    JOIN shop_order_items i ON i.order_id = o.id
    LEFT JOIN manual_alipay_payments p
      ON p.order_id = o.id AND p.order_kind = 'shop'
`;

const PENDING_MANUAL = `
   WHERE o.status = 'pending_payment'
     AND o.payment_provider = 'alipay_manual'
`;

function mapCandidate(row: Record<string, unknown>): CandidateOrder {
  return {
    id: String(row.id),
    order_no: String(row.order_no),
    amount_micros: toNumber(row.amount_micros as string | number),
    created_at: String(row.created_at),
    email: String(row.email || ""),
    product_name: String(row.product_name || ""),
    status: String(row.status || ""),
    reported_reference: row.reported_reference ? String(row.reported_reference) : null,
    reported_at: row.reported_at ? String(row.reported_at) : null,
  };
}

/** 对账台首页需要的全部数据，一次查完。 */
export async function loadReconcileBoard(): Promise<Board> {
  const pending = await query<Record<string, unknown>>(
    `SELECT * FROM alipay_statement_rows
      WHERE settled_at IS NULL
      ORDER BY occurred_at DESC
      LIMIT 200`,
  );
  const rows = pending.rows.map(mapRow);

  const matchedRows = rows.filter(
    (row) => row.match_kind === "order_no" || row.match_kind === "amount_unique",
  );
  const matchedIds = new Set(matchedRows.map((row) => row.id));
  const ambiguousRows = rows.filter((row) => !matchedIds.has(row.id));

  // 已归属的流水要把对应订单一起带出来：运营要同时看「账单这一行」和
  // 「客户报的交易号 + 付款截图」，两边吻合才点确认。
  const orderIds = matchedRows
    .map((row) => row.order_id)
    .filter((id): id is string => Boolean(id));
  const orderMap = new Map<string, CandidateOrder>();
  if (orderIds.length > 0) {
    const orders = await query<Record<string, unknown>>(
      `${CANDIDATE_SELECT} WHERE o.id = ANY($1::uuid[])`,
      [orderIds],
    );
    for (const row of orders.rows) {
      const candidate = mapCandidate(row);
      orderMap.set(candidate.id, candidate);
    }
  }
  const matched = matchedRows.map((row) => ({
    ...row,
    order: row.order_id ? orderMap.get(row.order_id) ?? null : null,
  }));

  const ambiguous = [];
  for (const row of ambiguousRows) {
    const candidates = await query<Record<string, unknown>>(
      `${CANDIDATE_SELECT}
       ${PENDING_MANUAL}
         AND round(o.amount_micros / 10000.0) = $1
         AND NOT EXISTS (
           SELECT 1 FROM alipay_statement_rows r WHERE r.order_id = o.id
         )
       ORDER BY abs(extract(epoch FROM (o.created_at - $2::timestamptz))) ASC
       LIMIT 10`,
      [rowAmountCents(row.amount_micros), row.occurred_at],
    );
    ambiguous.push({ ...row, candidates: candidates.rows.map(mapCandidate) });
  }

  const settledRows = await query<Record<string, unknown>>(
    `SELECT * FROM alipay_statement_rows
      WHERE settled_at IS NOT NULL
      ORDER BY settled_at DESC
      LIMIT 20`,
  );

  const reported = await query<Record<string, unknown>>(
    `${CANDIDATE_SELECT}
     ${PENDING_MANUAL}
       AND p.reported_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM alipay_statement_rows r WHERE r.order_id = o.id
       )
     ORDER BY p.reported_at DESC
     LIMIT 50`,
  );

  return {
    matched,
    ambiguous,
    settled: settledRows.rows.map(mapRow),
    reportedWithoutStatement: reported.rows.map(mapCandidate),
  };
}

/**
 * 把一条账单流水确认到指定订单。
 *
 * 实际入账逻辑仍然走 markShopOrderPaid：它会锁订单行、按分比对金额、
 * 用 (provider, receipt_ref) 保证一个支付宝交易号只能用一次。
 */
export async function settleStatementRow(input: {
  adminId: string;
  rowId: string;
  orderNo: string;
}): Promise<void> {
  const result = await query<Record<string, unknown>>(
    "SELECT * FROM alipay_statement_rows WHERE id = $1 LIMIT 1",
    [input.rowId],
  );
  const row = result.rows[0] ? mapRow(result.rows[0]) : null;
  if (!row) throw new Error("流水不存在");
  if (row.settled_at) throw new Error("这条流水已经确认过了");

  await markShopOrderPaid({
    orderNo: input.orderNo,
    provider: "alipay_manual",
    providerRef: row.trade_no,
    paidAmountMicros: row.amount_micros,
    adminId: input.adminId,
    note: `支付宝账单对账入账（${row.occurred_at.slice(0, 10)}）`,
  });

  const order = await query<{ id: string }>(
    "SELECT id FROM shop_orders WHERE order_no = $1 LIMIT 1",
    [input.orderNo],
  );
  await query(
    `UPDATE alipay_statement_rows
        SET order_id = $2,
            order_no = $3,
            match_kind = CASE WHEN match_kind = 'unmatched' THEN 'manual' ELSE match_kind END,
            settled_at = now()
      WHERE id = $1`,
    [input.rowId, order.rows[0]?.id ?? null, input.orderNo],
  );
}
