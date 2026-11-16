import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { loadPaymentImagesForOrders, type PaymentImage } from "@/lib/shop/payment-images";
import { loadReconcileBoard, type CandidateOrder, type StatementRow } from "@/lib/shop/reconcile";
import {
  adminImportAlipayStatementAction,
  adminSettleStatementRowAction,
} from "@/app/actions/admin-reconcile";

export const metadata: Metadata = { title: "到账核对" };
export const dynamic = "force-dynamic";

const MATCH_LABEL: Record<StatementRow["match_kind"], string> = {
  order_no: "备注订单号",
  amount_unique: "金额唯一",
  amount_multi: "金额多单",
  unmatched: "未归属",
  manual: "人工指定",
};

function ImageStrip({ images }: { images: PaymentImage[] }) {
  if (images.length === 0) {
    return <span className="muted small">客户未上传截图</span>;
  }
  return (
    <div className="flex gap-8">
      {images.map((image) => (
        <a
          key={image.hash}
          href={`/api/support/images/${image.hash}.${image.ext}`}
          target="_blank"
          rel="noreferrer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/support/images/${image.hash}.${image.ext}`}
            alt="客户付款截图"
            style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6 }}
          />
        </a>
      ))}
    </div>
  );
}

function OrderLine({ order }: { order: CandidateOrder }) {
  return (
    <div className="small">
      <Link className="mono" href={`/admin/shop/orders/${order.id}`}>
        {order.order_no}
      </Link>
      <div className="muted">
        {order.email} · {order.product_name} · {formatCny(order.amount_micros)} ·{" "}
        {formatDateTime(order.created_at)}
      </div>
      <div className="muted">
        {order.reported_reference
          ? `客户报的交易号：${order.reported_reference}${
              order.reported_at ? `（${formatDateTime(order.reported_at)}）` : ""
            }`
          : "客户还没上报交易号"}
      </div>
    </div>
  );
}

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const board = await loadReconcileBoard();

  const orderIds = [
    ...board.matched.map((row) => row.order?.id),
    ...board.ambiguous.flatMap((row) => row.candidates.map((candidate) => candidate.id)),
    ...board.reportedWithoutStatement.map((order) => order.id),
  ].filter((id): id is string => Boolean(id));
  const images = await loadPaymentImagesForOrders(orderIds);

  const imported = Number(params.imported || 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>到账核对</h1>
          <p>
            支付宝个人账户没有给第三方读账单的接口，所以由运营定期导出账单再传进来：
            支付宝 → 我的 → 账单 → 右上角「…」→ 下载账单 / 开具交易流水证明，导出 CSV。
            系统按「备注里的订单号」→「金额唯一」自动归属，剩下的你在这里挑。
            确认到账会直接改变订单状态，提交前请核对交易号和付款截图。
          </p>
        </div>
      </div>

      {params.error ? (
        <div className="notice notice-red mb-16">
          <div>{params.error}</div>
        </div>
      ) : null}
      {params.saved ? (
        <div className="notice notice-green mb-16">
          <div>已确认到账：{params.saved}</div>
        </div>
      ) : null}
      {imported > 0 ? (
        <div className="notice notice-green mb-16">
          <div>
            账单导入完成：新增 {imported} 条，重复跳过 {params.duplicates || 0} 条，
            自动归属 {params.matched || 0} 条，待人工 {params.ambiguous || 0} 条，
            未归属 {params.unmatched || 0} 条。
          </div>
        </div>
      ) : null}

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>导入支付宝账单</h2>
            <p>支持支付宝导出的账单 CSV（UTF-8 或 GB18030）。同一份账单重复上传不会产生重复流水。</p>
          </div>
        </div>
        <div className="panel-body">
          <form action={adminImportAlipayStatementAction} className="shop-admin-form">
            <label className="shop-field">
              <span>账单文件（.csv）</span>
              <input type="file" name="statement" accept=".csv,text/csv" required />
            </label>
            <button className="btn btn-primary" type="submit">
              导入并自动匹配
            </button>
          </form>
        </div>
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>自动归属，待确认</h2>
            <p>金额或订单号已经对上，核对截图后点确认。</p>
          </div>
          <span className="badge">{board.matched.length} 条</span>
        </div>
        {board.matched.length === 0 ? (
          <div className="empty">暂无待确认的到账。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>到账</th>
                  <th>对方 / 备注</th>
                  <th>匹配</th>
                  <th>订单</th>
                  <th>付款截图</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {board.matched.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">
                      <strong>{formatCny(row.amount_micros)}</strong>
                      <div className="muted small">{formatDateTime(row.occurred_at)}</div>
                      <div className="mono muted small">{row.trade_no}</div>
                    </td>
                    <td className="small">
                      <div>{row.counterparty || "—"}</div>
                      <div className="muted">{row.remark || row.product_desc || "—"}</div>
                    </td>
                    <td className="nowrap small">{MATCH_LABEL[row.match_kind]}</td>
                    <td>
                      {row.order ? (
                        <OrderLine order={row.order} />
                      ) : (
                        <span className="text-red small">订单已不在待支付状态</span>
                      )}
                    </td>
                    <td>
                      <ImageStrip images={row.order ? images.get(row.order.id) || [] : []} />
                    </td>
                    <td className="text-right">
                      {row.order ? (
                        <form action={adminSettleStatementRowAction}>
                          <input type="hidden" name="rowId" value={row.id} />
                          <input type="hidden" name="orderNo" value={row.order.order_no} />
                          <button className="btn btn-sm btn-primary" type="submit">
                            确认到账
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>需要人工指定订单</h2>
            <p>金额对应多张单，或对不上任何待支付订单。按付款时间和截图挑出正确的一单。</p>
          </div>
          <span className="badge">{board.ambiguous.length} 条</span>
        </div>
        {board.ambiguous.length === 0 ? (
          <div className="empty">没有需要人工判断的到账。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>到账</th>
                  <th>对方 / 备注</th>
                  <th>候选订单</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {board.ambiguous.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">
                      <strong>{formatCny(row.amount_micros)}</strong>
                      <div className="muted small">{formatDateTime(row.occurred_at)}</div>
                      <div className="mono muted small">{row.trade_no}</div>
                      <div className="muted small">{MATCH_LABEL[row.match_kind]}</div>
                    </td>
                    <td className="small">
                      <div>{row.counterparty || "—"}</div>
                      <div className="muted">{row.remark || row.product_desc || "—"}</div>
                    </td>
                    <td>
                      {row.candidates.length === 0 ? (
                        <span className="muted small">同金额的待支付订单都已经被别的流水占用</span>
                      ) : (
                        <div className="flex flex-col gap-8">
                          {row.candidates.map((candidate) => (
                            <div key={candidate.id}>
                              <OrderLine order={candidate} />
                              <ImageStrip images={images.get(candidate.id) || []} />
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      <form action={adminSettleStatementRowAction} className="shop-admin-form">
                        <input type="hidden" name="rowId" value={row.id} />
                        {row.candidates.length > 0 ? (
                          <select className="input" name="orderNo" required defaultValue="">
                            <option value="" disabled>
                              选择订单
                            </option>
                            {row.candidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.order_no}>
                                {candidate.order_no} · {candidate.email}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input mono"
                            name="orderNo"
                            placeholder="CK..."
                            required
                            maxLength={32}
                          />
                        )}
                        <button className="btn btn-sm btn-primary" type="submit">
                          确认到账
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel mb-16">
        <div className="panel-head">
          <div>
            <h2>客户已上报、账单还没对上</h2>
            <p>客户说了付款并报了交易号，但导入的账单里没有对应流水。可能是账单还没更新，也可能客户没付。</p>
          </div>
          <span className="badge">{board.reportedWithoutStatement.length} 条</span>
        </div>
        {board.reportedWithoutStatement.length === 0 ? (
          <div className="empty">没有待核对的申报。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>订单</th>
                  <th>客户</th>
                  <th>付款截图</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {board.reportedWithoutStatement.map((order) => (
                  <tr key={order.id}>
                    <td className="nowrap">
                      <Link className="mono" href={`/admin/shop/orders/${order.id}`}>
                        {order.order_no}
                      </Link>
                      <div className="muted small">{formatDateTime(order.created_at)}</div>
                    </td>
                    <td className="small">
                      <div>{order.email}</div>
                      <div className="muted">{order.reported_reference || "—"}</div>
                    </td>
                    <td>
                      <ImageStrip images={images.get(order.id) || []} />
                    </td>
                    <td className="text-right">
                      <Link className="btn btn-sm btn-ghost" href={`/admin/shop/orders/${order.id}`}>
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

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>最近已确认</h2>
            <p>确认过的流水不会再出现在上面的待办里。</p>
          </div>
          <span className="badge">{board.settled.length} 条</span>
        </div>
        {board.settled.length === 0 ? (
          <div className="empty">还没有确认记录。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>到账</th>
                  <th>交易号</th>
                  <th>订单</th>
                  <th>确认时间</th>
                </tr>
              </thead>
              <tbody>
                {board.settled.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">
                      <strong>{formatCny(row.amount_micros)}</strong>
                      <div className="muted small">{formatDateTime(row.occurred_at)}</div>
                    </td>
                    <td className="mono small">{row.trade_no}</td>
                    <td className="mono small">{row.order_no || "—"}</td>
                    <td className="nowrap muted small">
                      {row.settled_at ? formatDateTime(row.settled_at) : "—"}
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
