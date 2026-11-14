import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { SHOP_COPY } from "@/lib/shop/copy";
import { listAdminShopOrders } from "@/lib/shop/orders";

export const metadata: Metadata = { title: "小店订单" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "reported", label: "待确认到账" },
  { key: "pending_payment", label: "待支付" },
  { key: "paid", label: "待采购" },
  { key: "procuring", label: "采购中" },
  { key: "delivered", label: "已交付" },
  { key: "refund_pending", label: "退款" },
];

export default async function AdminShopOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const requested = params.status || "all";
  const status = FILTERS.some((item) => item.key === requested) ? requested : "all";
  const orders = await listAdminShopOrders({ status });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>小店订单</h1>
          <p>客户上报付款后先核对收款账单确认到账，再去供货商下单并上传交付。</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-8 mb-16">
        {FILTERS.map((filter) => (
          <Link
            key={filter.key}
            href={`/admin/shop/orders${filter.key === "all" ? "" : `?status=${filter.key}`}`}
            className={`btn btn-sm ${status === filter.key ? "btn-dark" : "btn-ghost"}`}
          >
            {filter.label}
          </Link>
        ))}
        <Link className="btn btn-sm btn-ghost" href="/admin/shop/deposits">
          USDT 到账
        </Link>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>订单列表</h2>
          </div>
          <span className="badge">{orders.length} 条</span>
        </div>
        {orders.length === 0 ? (
          <div className="empty">当前筛选条件下没有订单。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>订单</th>
                  <th>客户</th>
                  <th>商品</th>
                  <th>金额 / 成本</th>
                  <th>毛利</th>
                  <th>支付</th>
                  <th>状态</th>
                  <th>时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const margin =
                    order.amount_micros > 0
                      ? ((order.amount_micros - order.supplier_cost_micros) /
                          order.amount_micros) *
                        100
                      : 0;
                  return (
                    <tr key={order.id}>
                      <td className="mono nowrap">{order.order_no}</td>
                      <td>
                        <div>{order.email}</div>
                        <span className="muted">{order.name}</span>
                      </td>
                      <td>{order.product_name}</td>
                      <td className="nowrap">
                        {formatCny(order.amount_micros)}
                        <span className="muted"> / {formatCny(order.supplier_cost_micros)}</span>
                      </td>
                      <td className={margin < 15 ? "text-red" : ""}>{margin.toFixed(1)}%</td>
                      <td className="nowrap">
                        {order.payment_provider === "alipay_easypay"
                          ? "支付宝（易支付）"
                          : order.payment_provider === "alipay_manual"
                            ? "支付宝（人工）"
                            : order.payment_provider === "balance"
                              ? "账户余额"
                              : order.payment_provider.startsWith("usdt_")
                                ? "USDT"
                                : "人工"}
                      </td>
                      <td>
                        {order.status === "pending_payment" && order.reported_at ? (
                          <>
                            <span className="shop-status shop-status-payment_reported">
                              待确认到账
                            </span>
                            <div className="muted small">
                              上报 {formatDateTime(order.reported_at)}
                            </div>
                          </>
                        ) : (
                          <span className={`shop-status shop-status-${order.status}`}>
                            {SHOP_COPY.orderStatus[order.status]}
                          </span>
                        )}
                      </td>
                      <td className="nowrap muted">{formatDateTime(order.created_at)}</td>
                      <td className="text-right">
                        <Link className="btn btn-ghost btn-sm" href={`/admin/shop/orders/${order.id}`}>
                          处理
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
