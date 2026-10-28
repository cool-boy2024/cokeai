import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Megaphone, Plus, Trash2 } from "lucide-react";
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
  toggleAnnouncementAction,
} from "@/app/actions/announcements";
import { requireAdmin } from "@/lib/auth";
import {
  announcementLevelLabel,
  type AnnouncementLevel,
} from "@/lib/announcement-types";
import { listAllAnnouncements } from "@/lib/announcements";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "公告" };
export const dynamic = "force-dynamic";

function levelClass(level: AnnouncementLevel): string {
  if (level === "success") return "badge-green";
  if (level === "warning") return "badge-yellow";
  return "badge-dark";
}

function windowText(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return "长期";
  const start = startsAt ? formatDateTime(startsAt) : "立即";
  const end = endsAt ? formatDateTime(endsAt) : "长期";
  return `${start} → ${end}`;
}

export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const announcements = await listAllAnnouncements();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>公告</h1>
          <p>发布后会显示在小店、价格页和所有公共页面的顶部；也可以关闭单条公告。</p>
        </div>
        <span className="badge badge-dark">
          <Megaphone size={12} /> {announcements.length} 条
        </span>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>公告已更新。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>发布公告</h2>
            <p>标题必填；正文可以留空。开始和结束时间都按服务器时区解释。</p>
          </div>
          <Plus size={16} />
        </div>
        <div className="panel-body">
          <form action={createAnnouncementAction} className="form-stack">
            <div className="form-row">
              <div className="field">
                <label>标题</label>
                <input
                  className="input"
                  name="title"
                  maxLength={120}
                  placeholder="例如：今晚 23:00 网关维护"
                  required
                />
              </div>
              <div className="field">
                <label>类型</label>
                <select className="select" name="level" defaultValue="info">
                  <option value="info">公告</option>
                  <option value="success">更新</option>
                  <option value="warning">注意</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>正文</label>
              <textarea
                className="input"
                name="body"
                rows={4}
                maxLength={5000}
                placeholder="说明影响范围、时间和用户需要做什么。"
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label>开始时间（可选）</label>
                <input className="input" name="startsAt" type="datetime-local" />
              </div>
              <div className="field">
                <label>结束时间（可选）</label>
                <input className="input" name="endsAt" type="datetime-local" />
              </div>
              <label className="checkbox-field">
                <input type="checkbox" name="pinned" />
                置顶
              </label>
            </div>
            <button className="btn btn-dark" type="submit">
              <Plus size={14} /> 发布公告
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>全部公告</h2>
            <p>关闭后不再展示，数据仍保留，可以随时重新打开。</p>
          </div>
        </div>
        {announcements.length === 0 ? (
          <div className="empty">还没有公告。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>类型</th>
                  <th>展示时间</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {announcements.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      {item.pinned ? <span className="badge badge-dark">置顶</span> : null}
                      {item.body ? (
                        <div className="small muted announcement-admin-body">{item.body}</div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`badge ${levelClass(item.level)}`}>
                        {announcementLevelLabel(item.level)}
                      </span>
                    </td>
                    <td className="small muted">
                      {windowText(item.starts_at, item.ends_at)}
                    </td>
                    <td>
                      <span className={`badge ${item.active ? "badge-green" : "badge-red"}`}>
                        {item.active ? "展示中" : "已关闭"}
                      </span>
                    </td>
                    <td className="small muted nowrap">{formatDateTime(item.updated_at)}</td>
                    <td>
                      <div className="inline-form">
                        <form action={toggleAnnouncementAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button className="btn btn-ghost btn-sm" type="submit">
                            {item.active ? "关闭" : "打开"}
                          </button>
                        </form>
                        <form action={deleteAnnouncementAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button className="btn btn-ghost btn-sm" type="submit">
                            <Trash2 size={13} />
                          </button>
                        </form>
                      </div>
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
