import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { Pagination } from "@/components/Pagination";
import { SHOP_COPY } from "@/lib/shop/copy";
import { countAdminShopOrders, listAdminShopOrders } from "@/lib/shop/orders";

export const metadata: Metadata = { title: "小店订单" };
export const dynamic = "force-dynamic";

/** 每页订单数。想调整分页大小只改这一处。 */
const PAGE_SIZE = 15;

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "reported", label: "待确认到账" },
  { key: "unreported", label: "超时待核对" },
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
  // 订单号精确匹配：统一大写并去掉首尾空格，不做模糊匹配。
  const orderNo = (params.q || "").trim().toUpperCase().slice(0, 40);
  const requestedPage = Number.parseInt(params.page || "1", 10);

  const filter = { status, orderNo: orderNo || undefined };
  const total = await countAdminShopOrders(filter);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalPages,
  );
  const orders = await listAdminShopOrders({
    ...filter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // 分页和状态标签都要带上当前搜索词，搜索、筛选、翻页才能组合生效。
  function listHref(
    next: { status?: string; q?: string; page?: number } = {},
  ): string {
    const search = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextQuery = next.q ?? orderNo;
    if (nextStatus !== "all") search.set("status", nextStatus);
    if (nextQuery) search.set("q", nextQuery);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    const suffix = search.toString();
    return `/admin/shop/orders${suffix ? `?${suffix}` : ""}`;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>小店订单</h1>
          <p>
            客户上报付款后先核对收款账单确认到账，再去供货商下单并上传交付。
            「超时待核对」是人工支付宝里已过付款时限、客户又没提交付款信息的订单——
            这类订单不会自动过期（钱可能已到账），需要人工确认或取消。
          </p>
        </div>
      </div>

      <form
        className="order-search"
        action="/admin/shop/orders"
        method="get"
        role="search"
        key={orderNo}
      >
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={orderNo}
          placeholder="输入完整订单号精确搜索，如 CK2026111610554DE9"
          aria-label="按订单号精确搜索"
          maxLength={40}
        />
        <button className="btn btn-sm btn-dark" type="submit">
          搜索
        </button>
        {orderNo ? (
          <Link className="btn btn-sm btn-ghost" href={listHref({ status, q: "", page: 1 })}>
            清除
          </Link>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-8 mb-16">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={listHref({ status: item.key, page: 1 })}
            className={`btn btn-sm ${status === item.key ? "btn-dark" : "btn-ghost"}`}
          >
            {item.label}
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
          <span className="badge">
            {orderNo ? `匹配 ${total} 条` : `${total} 条`}
          </span>
        </div>
        {orders.length === 0 ? (
          <div className="empty">
            {orderNo
              ? `没有找到订单号「${orderNo}」${status === "all" ? "" : "在当前状态下"}的订单。订单号需要完整输入。`
              : "当前筛选条件下没有订单。"}
          </div>
        ) : (
          <>
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
                          <span className="muted">
                            {" "}
                            / {formatCny(order.supplier_cost_micros)}
                          </span>
                        </td>
                        <td className={margin < 15 ? "text-red" : ""}>
                          {margin.toFixed(1)}%
                        </td>
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
                          <Link
                            className="btn btn-ghost btn-sm"
                            href={`/admin/shop/orders/${order.id}`}
                          >
                            处理
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              className="pager--inset"
              page={page}
              totalPages={totalPages}
              total={total}
              hrefFor={(next) => listHref({ page: next })}
              action="/admin/shop/orders"
              hidden={{ status: status === "all" ? undefined : status, q: orderNo || undefined }}
            />
          </>
        )}
      </section>
    </>
  );
}
