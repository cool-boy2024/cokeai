import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { adminRevokeSessionAction } from "@/app/actions/admin-security";
import {
  currentSessionTokenHash,
  listActiveSessions,
  requireAdmin,
} from "@/lib/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDateTime } from "@/lib/format";
import { config } from "@/lib/config";

export const metadata: Metadata = { title: "在线会话" };
export const dynamic = "force-dynamic";

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const [sessions, currentHash] = await Promise.all([
    listActiveSessions(),
    currentSessionTokenHash(),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>在线会话</h1>
          <p>
            当前有效登录。管理员账号最多同时 {config.adminMaxSessions} 个会话，超出时最旧的会被自动踢下线。
          </p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-light btn-sm" href="/admin/security">
            <ArrowLeft size={14} /> 返回安全
          </Link>
        </div>
      </div>

      {params.revoked === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>会话已踢下线。</div>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>会话列表</h2>
            <p className="small muted">管理员排在最前；点「踢下线」立即让该设备退出登录。</p>
          </div>
          <span className="badge">{sessions.length} 个</span>
        </div>
        {sessions.length === 0 ? (
          <div className="empty">没有有效会话。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>角色</th>
                  <th>IP</th>
                  <th>设备</th>
                  <th>登录时间</th>
                  <th>过期时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const isCurrent = session.tokenHash === currentHash;
                  return (
                    <tr key={session.tokenHash}>
                      <td>
                        <div className="small">{session.name || "—"}</div>
                        <div className="small muted mono">{session.email}</div>
                      </td>
                      <td>
                        <span
                          className={`badge ${session.role === "admin" ? "badge-yellow" : ""}`}
                        >
                          {session.role === "admin" ? "管理员" : "用户"}
                        </span>
                      </td>
                      <td className="mono small">{session.ip || "—"}</td>
                      <td>
                        <div
                          className="small muted"
                          title={session.userAgent || undefined}
                          style={{
                            maxWidth: 300,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {session.userAgent || "—"}
                        </div>
                      </td>
                      <td className="nowrap small">{formatDateTime(session.createdAt)}</td>
                      <td className="nowrap small muted">{formatDateTime(session.expiresAt)}</td>
                      <td className="text-right">
                        {isCurrent ? (
                          <span className="badge badge-green">当前</span>
                        ) : (
                          <form action={adminRevokeSessionAction}>
                            <input type="hidden" name="tokenHash" value={session.tokenHash} />
                            <SubmitButton className="btn btn-light btn-sm" pendingText="踢出中…">
                              <KeyRound size={14} /> 踢下线
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
