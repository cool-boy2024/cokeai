import { query } from "@/lib/db";
import { CUSTOMER_EVENT_COPY } from "./customer-event-copy";

/**
 * 订单进度日志（客户视角）。
 *
 * 白名单在 customer-event-copy.ts：只有那里列出的 event 会被返回，
 * 运营备注（note 字段）和内部事件一律不进客户页。
 */

export type { CustomerEventCopy } from "./customer-event-copy";
export { CUSTOMER_EVENT_COPY } from "./customer-event-copy";

export type CustomerOrderEvent = {
  key: string;
  label: string;
  detail: string;
  created_at: string;
};

/**
 * 只返回客户该看到的事件。未在白名单里的（运营备注、内部采购记录等）
 * 一律不返回，即使数据库里有。
 */
export async function loadCustomerOrderEvents(
  orderId: string,
): Promise<CustomerOrderEvent[]> {
  const rows = await query<{ event: string; created_at: string }>(
    `SELECT event, created_at
       FROM shop_order_events
      WHERE order_id = $1
        AND event = ANY($2::text[])
      ORDER BY created_at ASC, id ASC`,
    [orderId, Object.keys(CUSTOMER_EVENT_COPY)],
  );

  return rows.rows.flatMap((row) => {
    const copy = CUSTOMER_EVENT_COPY[row.event];
    // 同一事件可能重复出现（例如多次打回），全部保留，客户看得懂时间线。
    if (!copy) return [];
    return [
      {
        key: row.event,
        label: copy.label,
        detail: copy.detail,
        created_at: String(row.created_at),
      },
    ];
  });
}
