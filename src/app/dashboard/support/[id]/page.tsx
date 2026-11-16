import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  getTicketForUser,
  listTicketMessages,
  markTicketReadByCustomer,
} from "@/lib/support";
import { replySupportTicketAction } from "@/app/actions/support";

export const metadata: Metadata = { title: "工单详情" };
export const dynamic = "force-dynamic";

export default async function DashboardSupportTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const flags = await searchParams;
  const ticket = await getTicketForUser(id, user.id);
  if (!ticket) notFound();
  const messages = await listTicketMessages(id);
  await markTicketReadByCustomer(id, user.id);

  return (
    <>
      <Link className="shop-back" href="/dashboard/support">
        <ArrowLeft size={14} /> 返回工单
      </Link>

      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <p className="muted">
            {ticket.orderNo ? `关联订单 ${ticket.orderNo}` : "未关联订单"} ·{" "}
            {formatDateTime(ticket.createdAt)}
          </p>
        </div>
        <span className={`badge ${ticket.status === "open" ? "badge-green" : ""}`}>
          {ticket.status === "open" ? "处理中" : "已关闭"}
        </span>
      </div>

      {flags.created === "1" ? (
        <div className="notice notice-green">工单已提交，运营会尽快回复。</div>
      ) : null}
      {flags.saved === "1" ? <div className="notice notice-green">回复已发送。</div> : null}
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
              className={`notice ${message.author === "admin" ? "" : "notice-green"}`}
              style={{ marginBottom: 8 }}
            >
              <div className="small muted">
                {message.author === "admin" ? "运营" : "我"} ·{" "}
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
                      {/* 工单图片走鉴权路由，不用 next/image 优化（那是公开资源用的） */}
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

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>回复</h2>
          </div>
        </div>
        <div className="panel-body">
          <form action={replySupportTicketAction} className="form-stack" encType="multipart/form-data">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <div className="field">
              <textarea
                className="input"
                name="message"
                rows={3}
                maxLength={4000}
                placeholder="补充说明…（只发图片可以不写字）"
              />
            </div>
            <div className="field">
              <label className="support-upload">
                <span>上传图片（收款码、报错截图）</span>
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
    </>
  );
}
