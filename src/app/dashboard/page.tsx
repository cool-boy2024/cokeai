import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  Megaphone,
  Plus,
  ReceiptText,
  ShoppingBag,
  Store,
  Wallet,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { announcementLevelLabel } from "@/lib/announcement-types";
import { listActiveAnnouncements } from "@/lib/announcements";
import { config } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import { getGatewayBalanceForRequest } from "@/lib/gateway-credits";
import { formatCny } from "@/lib/money";
import { SHOP_COPY } from "@/lib/shop/copy";
import {
  getUserShopOrderSummary,
  listUserShopOrders,
  type ShopOrderStatus,
} from "@/lib/shop/orders";

export const metadata: Metadata = { title: "概览" };
export const dynamic = "force-dynamic";

const OPEN_ORDER_STATUSES: ShopOrderStatus[] = [
  "pending_payment",
  "paid",
  "procuring",
  "refund_pending",
];

const PAID_ORDER_STATUSES: ShopOrderStatus[] = [
  "paid",
  "procuring",
  "delivered",
  "refund_pending",
];

export default async function DashboardPage() {
  const user = await requireUser();

  const [balanceResult, orders, orderSummary, announcements] = await Promise.all([
    getGatewayBalanceForRequest(user.id).catch(() => ({
      balance: user.balance_micros / 1_000_000,
    })),
    listUserShopOrders(user.id).catch(() => []),
    getUserShopOrderSummary(user.id).catch(() => null),
    listActiveAnnouncements(3).catch(() => []),
  ]);

  const balance = balanceResult.balance;
  const recentOrders = orders.slice(0, 5);
  // The list above is capped at 100 rows; prefer the exact aggregate and only
  // fall back to the visible rows if that query is unavailable.
  const orderCount = orderSummary?.total_count ?? orders.length;
  const openOrderCount =
    orderSummary?.open_count ??
    orders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length;
  const spentMicros =
    orderSummary?.paid_amount_micros ??
    orders
      .filter((order) => PAID_ORDER_STATUSES.includes(order.status))
      .reduce((sum, order) => sum + order.amount_micros, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>概览</h1>
          <p>账户余额、小店订单和最新公告。</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-ghost btn-sm" href="/shop">
            <Store size={14} /> 去小店
          </Link>
          <Link className="btn btn-dark btn-sm" href="/dashboard/billing">
            <Plus size={14} /> 充值
          </Link>
        </div>
      </div>

      {balance < config.lowBalanceCny ? (
        <div className="notice">
          <Wallet size={16} />
          <div>
            账户余额低于 {formatCny(config.lowBalanceCny * 1_000_000)}。
            小店订单使用账户余额支付，
            <Link className="text-link" href="/dashboard/billing" style={{ marginLeft: 8 }}>
              立即充值 →
            </Link>
          </div>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">
            可用余额 <Wallet size={15} />
          </div>
          <div className="stat-value">{formatCny(balance * 1_000_000)}</div>
          <div className="stat-foot">可用于小店订单</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            小店订单 <ShoppingBag size={15} />
          </div>
          <div className="stat-value">{orderCount}</div>
          <div className="stat-foot">累计下单</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            进行中 <Clock3 size={15} />
          </div>
          <div className="stat-value">{openOrderCount}</div>
          <div className="stat-foot">待支付或处理中的订单</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            累计消费 <ReceiptText size={15} />
          </div>
          <div className="stat-value">{formatCny(spentMicros)}</div>
          <div className="stat-foot">已支付订单金额</div>
        </div>
      </div>

      <div className="panel-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>最近小店订单</h2>
                <p>最近 5 笔</p>
              </div>
              <Link className="text-link small" href="/dashboard/shop">
                全部订单 →
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <div className="empty">
                还没有小店订单。去 <Link href="/shop">小店</Link> 看看。
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
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="mono small nowrap">
                          <Link className="text-link" href={`/shop/orders/${order.order_no}`}>
                            {order.order_no}
                          </Link>
                        </td>
                        <td>{order.product_name}</td>
                        <td className="nowrap">{formatCny(order.amount_micros)}</td>
                        <td>
                          <span className={`shop-status shop-status-${order.status}`}>
                            {SHOP_COPY.orderStatus[order.status]}
                          </span>
                        </td>
                        <td className="mono small nowrap">
                          {formatDateTime(order.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>公告</h2>
                <p>服务变更与处理时效</p>
              </div>
              <Megaphone size={15} className="muted" />
            </div>
            {announcements.length === 0 ? (
              <div className="empty">暂无公告。</div>
            ) : (
              <div className="panel-body">
                {announcements.map((item, index) => (
                  <div key={item.id} className={index > 0 ? "mt-16" : undefined}>
                    <div className="flex-between">
                      <strong className="small">{item.title}</strong>
                      <span className={`badge announcement-badge-${item.level}`}>
                        {announcementLevelLabel(item.level)}
                      </span>
                    </div>
                    {item.body ? (
                      <p className="small muted" style={{ margin: "6px 0 0" }}>
                        {item.body}
                      </p>
                    ) : null}
                  </div>
                ))}
                <Link
                  className="btn btn-ghost btn-sm btn-block mt-16"
                  href="/announcements"
                >
                  查看全部公告 <ArrowRight size={13} />
                </Link>
              </div>
            )}
          </section>
        </div>

        <div>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>当前余额</h2>
                <p>充值后即可用于小店订单</p>
              </div>
              <Wallet size={17} />
            </div>
            <div className="panel-body">
              <div className="balance-amount">{formatCny(balance * 1_000_000)}</div>
              <div className="small muted mt-8">余额不过期</div>
              <Link
                className="btn btn-dark btn-sm btn-block mt-16"
                href="/dashboard/billing"
              >
                充值 <Plus size={13} />
              </Link>
              <Link
                className="btn btn-ghost btn-sm btn-block mt-8"
                href="/dashboard/shop"
              >
                查看我的订单 <ArrowRight size={13} />
              </Link>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>账户</h2>
              </div>
            </div>
            <div className="panel-body">
              <div className="flex-between">
                <span className="small muted">邮箱</span>
                <span className="small">{user.email}</span>
              </div>
              <div className="flex-between mt-8">
                <span className="small muted">注册时间</span>
                <span className="small">{formatDateTime(user.created_at)}</span>
              </div>
              <Link
                className="btn btn-ghost btn-sm btn-block mt-16"
                href="/dashboard/settings"
              >
                账户设置 <ArrowRight size={13} />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
