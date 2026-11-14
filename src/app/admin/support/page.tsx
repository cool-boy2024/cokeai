import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listAllTickets, type TicketStatus } from "@/lib/support";

export const metadata: Metadata = { title: "工单" };
export const dynamic = "force-dynamic";

const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "处理中",
  closed: "已关闭",
};

export default async function AdminSupportPage() {
  await requireAdmin();
  const tickets = await listAllTickets();
  const openCount = tickets.filter((ticket) => ticket.status === "open").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>工单</h1>
          <p>顾客提交的售后问题。回复后顾客在「控制台 → 售后工单」里能看到。</p>
        </div>
        <span className={`badge ${openCount > 0 ? "badge-red" : ""}`}>
          {openCount} 个待处理
        </span>
      </div>

      <section className="panel">
        {tickets.length === 0 ? (
          <div className="empty">还没有工单。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>用户</th>
                  <th>关联订单</th>
                  <th>状态</th>
                  <th>最后更新</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link className="small" href={`/admin/support/${ticket.id}`}>
                        {ticket.subject}
                      </Link>
                      {ticket.unreadCount > 0 ? (
                        <span className="badge badge-red">新回复 {ticket.unreadCount}</span>
                      ) : null}
                      {ticket.messageCount > 0 ? (
                        <div className="small muted">共 {ticket.messageCount} 条消息</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="small">{ticket.userName || "—"}</div>
                      <div className="small muted mono">{ticket.userEmail}</div>
                    </td>
                    <td className="mono small">
                      {ticket.orderNo ? (
                        <Link href={`/admin/shop/orders/${ticket.orderId}`}>{ticket.orderNo}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className={`badge ${ticket.status === "open" ? "badge-green" : ""}`}>
                        {TICKET_STATUS_LABEL[ticket.status]}
                      </span>
                    </td>
                    <td className="nowrap small muted">{formatDateTime(ticket.updatedAt)}</td>
                    <td className="text-right">
                      <Link className="btn btn-light btn-sm" href={`/admin/support/${ticket.id}`}>
                        处理
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
