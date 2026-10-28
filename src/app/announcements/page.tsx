import type { Metadata } from "next";
import { Megaphone } from "@phosphor-icons/react/dist/ssr";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  announcementLevelLabel,
} from "@/lib/announcement-types";
import { listActiveAnnouncements } from "@/lib/announcements";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "公告",
  description: "CokeAI 服务公告、维护安排与处理时效更新。",
};

export default async function AnnouncementsPage() {
  const items = await listActiveAnnouncements(50).catch(() => []);

  return (
    <>
      <SiteHeader />
      <main id="main-content" className="public-main announcements-page">
        <section className="section announcement-page-head">
          <div className="container">
            <div className="hero-eyebrow">
              <i />
              Notice
            </div>
            <h1>公告</h1>
            <p>服务变更、维护安排和处理时效会在这里说明。</p>
          </div>
        </section>

        <section className="section announcements-list-section">
          <div className="container">
            {items.length === 0 ? (
              <div className="announcement-empty">
                <Megaphone size={22} />
                <strong>暂时没有公告</strong>
                <p>有新通知时会显示在页面顶部，也会出现在这里。</p>
              </div>
            ) : (
              <div className="announcements-list">
                {items.map((item) => (
                  <article
                    className={`announcement-card announcement-card-${item.level}`}
                    key={item.id}
                  >
                    <div className="announcement-card-head">
                      <span className={`announcement-badge announcement-badge-${item.level}`}>
                        {announcementLevelLabel(item.level)}
                      </span>
                      <time dateTime={item.starts_at || item.created_at}>
                        {formatDateTime(item.starts_at || item.created_at)}
                      </time>
                      {item.pinned ? <span className="announcement-pin">置顶</span> : null}
                    </div>
                    <h2>{item.title}</h2>
                    {item.body ? <p className="announcement-body">{item.body}</p> : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
