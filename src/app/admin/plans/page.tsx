import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Settings } from "lucide-react";
import { updatePlanAction } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import { formatCny } from "@/lib/money";

export const metadata: Metadata = { title: "套餐管理" };
export const dynamic = "force-dynamic";

type PlanRow = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  duration_days: number;
  tier: number;
  features: unknown;
  highlight: boolean;
  active: boolean;
  sort_order: number;
  created_at: string;
};

function yuan(value: string | number): string {
  return (Number(value) / 1_000_000).toFixed(2);
}

export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const result = await query<PlanRow>(
    `SELECT id, name, tagline, price_micros, credits_micros, duration_days,
            tier, features, highlight, active, sort_order, created_at
       FROM plans
      ORDER BY sort_order`,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>套餐管理</h1>
          <p>价格、额度和权益会实时反映到前台与控制台；历史订单保持购买时快照。</p>
        </div>
        <span className="badge badge-dark">
          <Settings size={12} /> {result.rows.length} 个套餐
        </span>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>套餐已更新。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}

      <div className="notice">
        套餐售价应覆盖上游成本、支付手续费、服务器、客服与佣金。
        调整额度或售价前，先用真实用量数据验证毛利，不要只看充值收入。
      </div>

      <div className="grid-2">
        {result.rows.map((plan) => {
          const features = Array.isArray(plan.features)
            ? (plan.features as string[])
            : [];
          return (
            <form key={plan.id} action={updatePlanAction} className="admin-form-card">
              <input type="hidden" name="id" value={plan.id} />
              <div className="flex-between mb-12">
                <h3 style={{ margin: 0 }}>
                  {plan.name}{" "}
                  <span className="mono muted" style={{ fontSize: 9 }}>
                    {plan.id}
                  </span>
                </h3>
                <span className={`badge ${plan.active ? "badge-green" : "badge-red"}`}>
                  {plan.active ? "上架中" : "已下架"}
                </span>
              </div>

              <div className="form-stack">
                <div className="form-row">
                  <div className="field">
                    <label>名称</label>
                    <input
                      className="input"
                      name="name"
                      defaultValue={plan.name}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>套餐等级</label>
                    <select className="select" name="tier" defaultValue={plan.tier}>
                      <option value="0">体验版</option>
                      <option value="1">开发者版</option>
                      <option value="2">专业版</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>一句话描述</label>
                  <input
                    className="input"
                    name="tagline"
                    defaultValue={plan.tagline}
                    required
                  />
                </div>
                <div className="form-row">
                  <div className="field">
                    <label>售价（元）</label>
                    <input
                      className="input"
                      name="priceYuan"
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={yuan(plan.price_micros)}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>到账额度（元）</label>
                    <input
                      className="input"
                      name="creditsYuan"
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={yuan(plan.credits_micros)}
                      required
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="field">
                    <label>有效天数</label>
                    <input
                      className="input"
                      name="durationDays"
                      type="number"
                      min="1"
                      max="3650"
                      defaultValue={plan.duration_days}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>换算参考</label>
                    <div className="input" style={{ background: "var(--paper)" }}>
                      <span className="small muted">
                        {formatCny(plan.price_micros)} / {plan.duration_days} 天
                      </span>
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label>权益（每行一条）</label>
                  <textarea
                    className="textarea"
                    name="features"
                    rows={5}
                    defaultValue={features.join("\n")}
                    required
                  />
                </div>
                <div className="flex gap-12 flex-wrap">
                  <label className="checkbox-row">
                    <input type="checkbox" name="active" defaultChecked={plan.active} />
                    上架
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      name="highlight"
                      defaultChecked={plan.highlight}
                    />
                    标记推荐
                  </label>
                  <span className="small muted">
                    排序 {toNumber(plan.sort_order)}
                  </span>
                </div>
                <button className="btn btn-dark btn-sm" type="submit">
                  保存套餐
                </button>
              </div>
            </form>
          );
        })}
      </div>
    </>
  );
}
