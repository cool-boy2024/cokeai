import { query, toNumber } from "@/lib/db";
import { isUsdtNetwork, USDT_NETWORKS } from "@/lib/payments/networks";

/**
 * 加密货币到账看板的数据源。
 *
 * 后台页面首屏和 /api/admin/shop/usdt/live 共用同一份查询，避免两处口径
 * 不一致（比如页面说 3 笔、接口说 4 笔）。
 */
export type LiveDeposit = {
  id: string;
  network: string;
  network_label: string;
  order_no: string;
  order_id: string;
  product_name: string | null;
  email: string;
  expected_usdt: number;
  received_usdt: number;
  confirmations: number;
  required_confirmations: number;
  status: string;
  txid: string | null;
  address: string;
  updated_at: string;
};

export type UsdtLivePayload = {
  deposits: LiveDeposit[];
  summary: { today_usdt: number; pending: number; confirming: number; manual: number };
};

export async function loadUsdtLive(): Promise<UsdtLivePayload> {
  const rows = await query<Record<string, unknown>>(
    `SELECT d.id, d.network, d.address, d.expected_usdt, d.received_usdt,
            d.confirmations, d.status, d.txid, d.updated_at,
            o.id AS order_id, o.order_no, u.email,
            (SELECT i.product_name FROM shop_order_items i
              WHERE i.order_id = o.id ORDER BY i.created_at LIMIT 1) AS product_name
       FROM shop_usdt_deposits d
       JOIN shop_orders o ON o.id = d.order_id
       JOIN users u ON u.id = o.user_id
      WHERE d.status IN ('waiting', 'partial', 'confirming', 'confirmed', 'overpaid', 'manual')
      ORDER BY d.updated_at DESC
      LIMIT 40`,
  );

  const deposits: LiveDeposit[] = rows.rows.map((row) => {
    const network = String(row.network);
    const meta = isUsdtNetwork(network) ? USDT_NETWORKS[network] : null;
    return {
      id: String(row.id),
      network,
      network_label: meta?.label || network,
      order_no: String(row.order_no),
      order_id: String(row.order_id),
      product_name: row.product_name ? String(row.product_name) : null,
      email: String(row.email || ""),
      expected_usdt: toNumber(row.expected_usdt as string | number),
      received_usdt: toNumber(row.received_usdt as string | number),
      confirmations: Number(row.confirmations || 0),
      required_confirmations: meta?.requiredConfirmations || 1,
      status: String(row.status),
      txid: row.txid ? String(row.txid) : null,
      address: String(row.address || ""),
      updated_at: new Date(row.updated_at as string).toISOString(),
    };
  });

  // 今日到账只统计真正收到钱的流水；状态计数覆盖全部在途。
  const summaryRow = await query<{
    today: string;
    pending: string;
    confirming: string;
    manual: string;
  }>(
    `SELECT COALESCE(SUM(received_usdt) FILTER (
              WHERE received_usdt > 0 AND updated_at >= date_trunc('day', now())
            ), 0)::text AS today,
            COUNT(*) FILTER (WHERE status = 'waiting')::text AS pending,
            COUNT(*) FILTER (WHERE status = 'confirming')::text AS confirming,
            COUNT(*) FILTER (WHERE status IN ('manual', 'overpaid', 'partial'))::text AS manual
       FROM shop_usdt_deposits`,
  );

  const summary = summaryRow.rows[0];
  return {
    deposits,
    summary: {
      today_usdt: Number(summary?.today || 0),
      pending: Number(summary?.pending || 0),
      confirming: Number(summary?.confirming || 0),
      manual: Number(summary?.manual || 0),
    },
  };
}
