import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, CreditCard } from "lucide-react";
import { updatePlanAction } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const metadata: Metadata = { title: "充值包" };
export const dynamic = "force-dynamic";

type PlanRow = {
  id: string;
  name: string;
  tagline: string;
  price_micros: string;
  credits_micros: string;
  highlight: boolean;
  active: boolean;
  sort_order: number;
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
    `SELECT id, name, tagline, price_micros, credits_micros,
            highlight, active, sort_order
       FROM plans
      ORDER BY sort_order`,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>充值包</h1>
          <p>前台展示的充值金额与到账额度。</p>
        </div>
        <span className="badge badge-dark">
          <CreditCard size={12} /> {result.rows.length} 个
        </span>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>已保存。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}

      <div className="grid-2">
        {result.rows.map((plan) => (
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
                  <input className="input" name="name" defaultValue={plan.name} required />
                </div>
                <div className="field">
                  <label>排序</label>
                  <input className="input" value={plan.sort_order} readOnly />
                </div>
              </div>
              <div className="field">
                <label>一句话描述</label>
                <input className="input" name="tagline" defaultValue={plan.tagline} />
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
              <div className="flex gap-12 flex-wrap">
                <label className="checkbox-row">
                  <input type="checkbox" name="active" defaultChecked={plan.active} />
                  上架
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" name="highlight" defaultChecked={plan.highlight} />
                  推荐
                </label>
              </div>
              <button className="btn btn-dark btn-sm" type="submit">
                保存
              </button>
            </div>
          </form>
        ))}
      </div>
    </>
  );
}
