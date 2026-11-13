import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { syncHelpAction } from "@/app/actions/help";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatFullDate } from "@/lib/format";
import { getHelpSyncStats, listHelpArticlesForAdmin } from "@/lib/help/store";

export const metadata: Metadata = { title: "帮助中心" };
export const dynamic = "force-dynamic";

export default async function AdminHelpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const [stats, articles] = await Promise.all([
    getHelpSyncStats(),
    listHelpArticlesForAdmin(),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>帮助中心</h1>
          <p>
            镜像上游帮助中心的教程，前台展示在 <Link href="/help">/help</Link>。
            后台或定时任务同步时会自动更新正文、图片和视频。
          </p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-light btn-sm" href="/help">
            查看前台
          </Link>
          <form action={syncHelpAction}>
            <button className="btn btn-primary btn-sm" type="submit">
              <RefreshCw size={14} /> 立即同步
            </button>
          </form>
        </div>
      </div>

      {params.result === "ok" ? (
        <div className="notice notice-green mb-16">
          <CheckCircle2 size={16} />
          <span>
            同步完成：新增 {params.added || 0} 篇，更新 {params.updated || 0} 篇，下架{" "}
            {params.hidden || 0} 篇。
          </span>
        </div>
      ) : null}

      {params.result === "partial" || params.result === "failed" ? (
        <div className="notice notice-red mb-16">
          <AlertTriangle size={16} />
          <span>
            {params.result === "failed" ? "同步失败：" : "部分完成："}
            {params.error || "请稍后重试"}
          </span>
        </div>
      ) : null}

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>同步状态</h2>
            <p>每 6 小时由 n8n 调用内部接口；按钮用于手动补同步。</p>
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span>前台可见</span>
            <strong>{stats.visible}</strong>
          </div>
          <div className="stat">
            <span>已下架</span>
            <strong>{stats.hidden}</strong>
          </div>
          <div className="stat">
            <span>最近同步</span>
            <strong className="small">
              {stats.lastSyncedAt ? formatDateTime(stats.lastSyncedAt) : "尚未同步"}
            </strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>教程列表</h2>
            <p>
              上游删除的教程会在这里标记为下架，不会直接删除记录，避免上游临时故障时丢内容。
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>发布时间</th>
                <th>状态</th>
                <th>最近同步</th>
              </tr>
            </thead>
            <tbody>
              {articles.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="small muted">还没有教程，点击右上角「立即同步」拉取。</div>
                  </td>
                </tr>
              ) : (
                articles.map((article) => (
                  <tr key={article.id}>
                    <td>
                      <div className="small">
                        {article.visible ? (
                          <Link href={`/help/${article.id}`}>{article.title}</Link>
                        ) : (
                          article.title
                        )}
                      </div>
                      {article.summary ? (
                        <div className="small muted">{article.summary.slice(0, 80)}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="small">{formatFullDate(article.publishedAt)}</div>
                    </td>
                    <td>
                      <span className={`badge ${article.visible ? "badge-green" : "badge-yellow"}`}>
                        {article.visible ? "已上线" : "已下架"}
                      </span>
                    </td>
                    <td>
                      <div className="small muted">{formatDateTime(article.syncedAt)}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
