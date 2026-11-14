import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listUserShopOrders } from "@/lib/shop/orders";
import { listUserTickets, type TicketStatus } from "@/lib/support";
import { createSupportTicketAction } from "@/app/actions/support";

export const metadata: Metadata = { title: "售后工单" };
export const dynamic = "force-dynamic";

const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "处理中",
  closed: "已关闭",
};

export default async function DashboardSupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const [tickets, orders] = await Promise.all([
    listUserTickets(user.id),
    listUserShopOrders(user.id),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>售后工单</h1>
          <p>提交问题或售后，运营会在这里回复。涉及订单请在下方选择关联订单。</p>
        </div>
      </div>

      {params.error ? <div className="notice notice-red">{params.error}</div> : null}

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>新建工单</h2>
          </div>
        </div>
        <div className="panel-body">
          <form action={createSupportTicketAction} className="form-stack">
            <div className="field">
              <label htmlFor="subject">标题</label>
              <input
                id="subject"
                className="input"
                name="subject"
                maxLength={200}
                required
                placeholder="一句话描述问题"
              />
            </div>
            <div className="field">
              <label htmlFor="orderId">关联订单（可选）</label>
              <select id="orderId" className="input" name="orderId" defaultValue="">
                <option value="">不关联订单</option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_no} · {order.product_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="message">问题描述</label>
              <textarea
                id="message"
                className="input"
                name="message"
                rows={4}
                maxLength={4000}
                required
                placeholder="请描述遇到的问题"
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-dark btn-sm" type="submit">
                提交工单
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>我的工单</h2>
          </div>
          <span className="badge">{tickets.length}</span>
        </div>
        {tickets.length === 0 ? (
          <div className="empty">还没有工单。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>关联订单</th>
                  <th>最后更新</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link className="small" href={`/dashboard/support/${ticket.id}`}>
                        {ticket.subject}
                      </Link>
                      {ticket.messageCount > 0 ? (
                        <div className="small muted">共 {ticket.messageCount} 条消息</div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`badge ${ticket.status === "open" ? "badge-green" : ""}`}>
                        {TICKET_STATUS_LABEL[ticket.status]}
                      </span>
                    </td>
                    <td className="mono small">{ticket.orderNo || "—"}</td>
                    <td className="nowrap small muted">{formatDateTime(ticket.updatedAt)}</td>
                    <td className="text-right">
                      <Link className="btn btn-light btn-sm" href={`/dashboard/support/${ticket.id}`}>
                        查看
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
