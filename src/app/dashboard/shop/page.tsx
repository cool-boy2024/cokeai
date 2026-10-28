import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { listUserShopOrders } from "@/lib/shop/orders";
import { SHOP_COPY } from "@/lib/shop/copy";

export const metadata: Metadata = { title: "我的订单" };
export const dynamic = "force-dynamic";

export default async function DashboardShopPage() {
  const user = await requireUser();
  const orders = await listUserShopOrders(user.id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>我的订单</h1>
          <p>查看小店订单进度和交付内容。</p>
        </div>
        <Link className="btn btn-dark btn-sm" href="/shop">
          <ShoppingBag size={14} /> 去小店
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
          <div className="empty">
            还没有订单。去 <Link href="/shop">小店</Link> 看看。
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>订单</th>
                  <th>商品</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>下单时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="mono nowrap">{order.order_no}</td>
                    <td>{order.product_name}</td>
                    <td className="nowrap">{formatCny(order.amount_micros)}</td>
                    <td>
                      <span className={`shop-status shop-status-${order.status}`}>
                        {SHOP_COPY.orderStatus[order.status]}
                      </span>
                    </td>
                    <td className="nowrap muted">{formatDateTime(order.created_at)}</td>
                    <td className="text-right">
                      <Link className="btn btn-ghost btn-sm" href={`/shop/orders/${order.order_no}`}>
                        {order.status === "pending_payment" ? "去支付" : "查看"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
