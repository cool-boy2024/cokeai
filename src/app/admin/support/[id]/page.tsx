import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  getTicket,
  listTicketMessages,
  markTicketReadByAdmin,
} from "@/lib/support";
import {
  adminReplyTicketAction,
  adminSetTicketStatusAction,
} from "@/app/actions/support";

export const metadata: Metadata = { title: "工单详情" };
export const dynamic = "force-dynamic";

export default async function AdminSupportTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  const flags = await searchParams;
  const ticket = await getTicket(id);
  if (!ticket) notFound();
  const messages = await listTicketMessages(id);
  // Opening the thread is the "I read it" action. The sidebar badge also lives
  // in a cached layout, so the shell's count is only refreshed by the badge's
  // own fetch; do not expect this render to update it.
  await markTicketReadByAdmin(id);

  return (
    <>
      <Link className="shop-back" href="/admin/support">
        <ArrowLeft size={14} /> 返回工单
      </Link>

      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <p className="muted">
            {ticket.userName || ticket.userEmail} ·{" "}
            <span className="mono">{ticket.userEmail}</span>
            {ticket.orderNo ? (
              <>
                {" "}· 关联订单{" "}
                <Link className="mono" href={`/admin/shop/orders/${ticket.orderId}`}>
                  {ticket.orderNo}
                </Link>
              </>
            ) : (
              " · 未关联订单"
            )}
            {" "}· {formatDateTime(ticket.createdAt)}
          </p>
        </div>
        <span className={`badge ${ticket.status === "open" ? "badge-green" : ""}`}>
          {ticket.status === "open" ? "处理中" : "已关闭"}
        </span>
      </div>

      {flags.saved === "1" ? <div className="notice notice-green">回复已发送。</div> : null}
      {flags.status ? (
        <div className="notice notice-green">
          {flags.status === "closed" ? "工单已关闭。" : "工单已重新打开。"}
        </div>
      ) : null}
      {flags.error ? <div className="notice notice-red">{flags.error}</div> : null}

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>对话</h2>
          </div>
        </div>
        <div className="panel-body">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`notice ${message.author === "customer" ? "notice-green" : ""}`}
              style={{ marginBottom: 8 }}
            >
              <div className="small muted">
                {message.author === "admin" ? "运营（我）" : "顾客"} ·{" "}
                {formatDateTime(message.createdAt)}
              </div>
              {message.body ? (
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                  {message.body}
                </div>
              ) : null}
              {message.imageHashes?.length ? (
                <div className="support-images">
                  {message.imageHashes.map((hash) => (
                    <a
                      key={hash}
                      href={`/api/support/images/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/support/images/${hash}`} alt="工单图片" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>回复</h2>
          </div>
        </div>
        <div className="panel-body">
          <form action={adminReplyTicketAction} className="form-stack" encType="multipart/form-data">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <div className="field">
              <textarea
                className="input"
                name="message"
                rows={3}
                maxLength={4000}
                placeholder="回复顾客…（只发图片可以不写字）"
              />
            </div>
            <div className="field">
              <label className="support-upload">
                <span>附上图片（截图等）</span>
                <input
                  type="file"
                  name="images"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                />
                <small>PNG / JPG / WebP，单张不超过 5MB，最多 3 张</small>
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-dark btn-sm" type="submit">
                发送回复
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-body">
          <form action={adminSetTicketStatusAction} className="form-inline">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <input
              type="hidden"
              name="status"
              value={ticket.status === "open" ? "closed" : "open"}
            />
            <button
              className={`btn btn-sm ${ticket.status === "open" ? "btn-light" : "btn-dark"}`}
              type="submit"
            >
              {ticket.status === "open" ? "关闭工单" : "重新打开"}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
