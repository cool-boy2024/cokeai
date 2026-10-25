import type { Metadata } from "next";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Plus,
  Server,
  Settings2,
} from "lucide-react";
import {
  createModelAction,
  createUpstreamAction,
  updateModelAction,
  updateUpstreamAction,
} from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { retailCnyPerMillion } from "@/lib/money";

export const metadata: Metadata = { title: "模型与上游" };
export const dynamic = "force-dynamic";

type UpstreamRow = {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  has_key: boolean;
  model_count: string;
  last_health_at: string | null;
  last_health_status: string | null;
  updated_at: string;
};

type ModelRow = {
  id: string;
  upstream_id: string;
  upstream_name: string;
  upstream_model: string;
  display_name: string;
  description: string;
  input_price_usd_micros_per_mtok: string;
  output_price_usd_micros_per_mtok: string;
  markup_bps: string;
  min_plan_tier: number;
  context_window: number;
  enabled: boolean;
  upstream_enabled: boolean;
  upstream_has_key: boolean;
  sort_order: number;
  updated_at: string;
};

const tierLabels = ["体验版", "开发者版", "专业版"];

function priceInput(value: string | number): string {
  return (Number(value) / 1_000_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export default async function AdminModelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [upstreamsResult, modelsResult] = await Promise.all([
    query<UpstreamRow>(
      `SELECT u.id, u.name, u.base_url, u.enabled,
              (u.api_key_encrypted IS NOT NULL) AS has_key,
              (SELECT COUNT(*) FROM models m WHERE m.upstream_id = u.id) AS model_count,
              u.last_health_at, u.last_health_status, u.updated_at
         FROM upstreams u
        ORDER BY u.created_at`,
    ),
    query<ModelRow>(
      `SELECT m.id, m.upstream_id, u.name AS upstream_name, m.upstream_model,
              m.display_name, m.description,
              m.input_price_usd_micros_per_mtok, m.output_price_usd_micros_per_mtok,
              m.markup_bps, m.min_plan_tier, m.context_window, m.enabled,
              u.enabled AS upstream_enabled,
              (u.api_key_encrypted IS NOT NULL) AS upstream_has_key,
              m.sort_order, m.updated_at
         FROM models m JOIN upstreams u ON u.id = m.upstream_id
        ORDER BY m.sort_order, m.display_name`,
    ),
  ]);

  const readyCount = modelsResult.rows.filter(
    (model) => model.enabled && model.upstream_enabled && model.upstream_has_key,
  ).length;
  const hasUpstream = upstreamsResult.rows.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>模型与上游</h1>
          <p>上游密钥使用 AES-256-GCM 加密保存；页面不会显示明文。</p>
        </div>
        <span className="badge badge-dark">
          <Server size={12} /> {readyCount} 个模型可用
        </span>
      </div>

      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>模型配置已保存，新的请求将使用最新价格与状态。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}
      {readyCount === 0 ? (
        <div className="notice">
          <AlertTriangle size={16} />
          <div>
            目前没有可用模型。请先填写上游 API Key、启用上游，再启用至少一个模型。
            所有上游都必须具备商业使用授权和相应地区许可。
          </div>
        </div>
      ) : null}

      <h2 className="section-title">上游服务</h2>
      <div className="grid-2">
        {upstreamsResult.rows.map((upstream) => (
          <form
            key={upstream.id}
            action={updateUpstreamAction}
            className="admin-form-card"
          >
            <input type="hidden" name="id" value={upstream.id} />
            <div className="flex-between mb-12">
              <h3 style={{ margin: 0 }}>
                {upstream.name}{" "}
                <span className="mono muted" style={{ fontSize: 9 }}>
                  {upstream.id}
                </span>
              </h3>
              <span
                className={`badge ${
                  upstream.enabled && upstream.has_key ? "badge-green" : "badge-yellow"
                }`}
              >
                {upstream.enabled && upstream.has_key
                  ? "已启用"
                  : upstream.has_key
                    ? "待启用"
                    : "缺少 Key"}
              </span>
            </div>
            <div className="form-stack">
              <div className="field">
                <label>名称</label>
                <input className="input" name="name" defaultValue={upstream.name} required />
              </div>
              <div className="field">
                <label>Base URL</label>
                <input
                  className="input mono"
                  name="baseUrl"
                  defaultValue={upstream.base_url}
                  placeholder="https://api.provider.com/v1"
                  required
                />
                <span className="hint">平台会自动追加 /chat/completions</span>
              </div>
              <div className="field">
                <label>API Key</label>
                <input
                  className="input"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={upstream.has_key ? "已配置，留空保持不变" : "输入上游 API Key"}
                />
              </div>
              <label className="checkbox-row">
                <input type="checkbox" name="enabled" defaultChecked={upstream.enabled} />
                启用此上游（需要已保存 API Key）
              </label>
              <div className="small muted" style={{ fontSize: 9 }}>
                {upstream.model_count} 个模型 · 最后更新{" "}
                {formatDateTime(upstream.updated_at)}
              </div>
              <button className="btn btn-dark btn-sm" type="submit">
                <KeyRound size={13} /> 保存上游配置
              </button>
            </div>
          </form>
        ))}
      </div>

      <details className="admin-details mt-16">
        <summary>
          <Plus size={11} style={{ display: "inline", marginRight: 5 }} />
          添加新的 OpenAI 兼容上游
        </summary>
        <form action={createUpstreamAction} className="admin-form-card mt-12">
          <div className="form-stack">
            <div className="form-row">
              <div className="field">
                <label>上游标识</label>
                <input className="input mono" name="id" placeholder="provider-a" required />
                <span className="hint">小写字母、数字、短横线，3-40 位，创建后不可修改</span>
              </div>
              <div className="field">
                <label>显示名称</label>
                <input className="input" name="name" placeholder="Provider A 官方 API" required />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Base URL</label>
                <input
                  className="input mono"
                  name="baseUrl"
                  placeholder="https://api.provider.com/v1"
                  required
                />
              </div>
              <div className="field">
                <label>API Key</label>
                <input
                  className="input"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  required
                />
              </div>
            </div>
            <button className="btn btn-dark btn-sm" type="submit">
              创建并启用上游
            </button>
          </div>
        </form>
      </details>

      <h2 className="section-title">模型目录</h2>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>模型配置</h2>
            <p>展开“编辑”可修改上游模型名、美元成本价、加价比例与套餐门槛。</p>
          </div>
          <span className="badge">{modelsResult.rows.length} 个</span>
        </div>
        {modelsResult.rows.length === 0 ? (
          <div className="empty">还没有模型，请先在下方添加。</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>模型</th>
                  <th>上游</th>
                  <th>零售价 / 1M</th>
                  <th>加价</th>
                  <th>套餐门槛</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {modelsResult.rows.map((model) => {
                  const ready =
                    model.enabled && model.upstream_enabled && model.upstream_has_key;
                  return (
                    <tr key={model.id}>
                      <td>
                        <div className="table-model">
                          <span className="model-mark">
                            {model.display_name.slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <strong>{model.display_name}</strong>
                            <span>
                              {model.id} → {model.upstream_model}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="small">{model.upstream_name}</td>
                      <td className="mono small nowrap">
                        入 ¥
                        {retailCnyPerMillion(
                          model.input_price_usd_micros_per_mtok,
                          model.markup_bps,
                        ).toFixed(2)}
                        <br />出 ¥
                        {retailCnyPerMillion(
                          model.output_price_usd_micros_per_mtok,
                          model.markup_bps,
                        ).toFixed(2)}
                      </td>
                      <td className="mono small">
                        {toNumber(model.markup_bps) / 100}%
                      </td>
                      <td className="small">
                        {tierLabels[model.min_plan_tier] || model.min_plan_tier}
                      </td>
                      <td>
                        <span
                          className={`badge ${ready ? "badge-green" : "badge-yellow"}`}
                        >
                          {ready ? "可用" : model.enabled ? "上游未就绪" : "未启用"}
                        </span>
                      </td>
                      <td>
                        <details className="admin-details">
                          <summary>
                            <Settings2 size={11} style={{ display: "inline", marginRight: 4 }} />
                            编辑
                          </summary>
                          <form action={updateModelAction} className="form-stack">
                            <input type="hidden" name="id" value={model.id} />
                            <div className="form-row">
                              <div className="field">
                                <label>显示名称</label>
                                <input
                                  className="input"
                                  name="displayName"
                                  defaultValue={model.display_name}
                                  required
                                />
                              </div>
                              <div className="field">
                                <label>上游模型 ID</label>
                                <input
                                  className="input mono"
                                  name="upstreamModel"
                                  defaultValue={model.upstream_model}
                                  required
                                />
                              </div>
                            </div>
                            <div className="form-row">
                              <div className="field">
                                <label>输入成本 $ / 1M</label>
                                <input
                                  className="input"
                                  name="inputUsd"
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  defaultValue={priceInput(
                                    model.input_price_usd_micros_per_mtok,
                                  )}
                                  required
                                />
                              </div>
                              <div className="field">
                                <label>输出成本 $ / 1M</label>
                                <input
                                  className="input"
                                  name="outputUsd"
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  defaultValue={priceInput(
                                    model.output_price_usd_micros_per_mtok,
                                  )}
                                  required
                                />
                              </div>
                            </div>
                            <div className="form-row">
                              <div className="field">
                                <label>加价比例 %</label>
                                <input
                                  className="input"
                                  name="markupPercent"
                                  type="number"
                                  step="1"
                                  min="100"
                                  max="500"
                                  defaultValue={toNumber(model.markup_bps) / 100}
                                  required
                                />
                              </div>
                              <div className="field">
                                <label>最低套餐</label>
                                <select
                                  className="select"
                                  name="minPlanTier"
                                  defaultValue={model.min_plan_tier}
                                >
                                  <option value="0">体验版</option>
                                  <option value="1">开发者版</option>
                                  <option value="2">专业版</option>
                                </select>
                              </div>
                            </div>
                            <div className="form-row">
                              <div className="field">
                                <label>上下文窗口 Token</label>
                                <input
                                  className="input"
                                  name="contextWindow"
                                  type="number"
                                  min="1000"
                                  defaultValue={model.context_window}
                                  required
                                />
                              </div>
                              <div className="field" style={{ alignSelf: "end" }}>
                                <label className="checkbox-row">
                                  <input
                                    type="checkbox"
                                    name="enabled"
                                    defaultChecked={model.enabled}
                                  />
                                  启用模型
                                </label>
                              </div>
                            </div>
                            <button className="btn btn-dark btn-sm" type="submit">
                              保存模型
                            </button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hasUpstream ? (
        <details className="admin-details mt-16">
          <summary>
            <Plus size={11} style={{ display: "inline", marginRight: 5 }} />
            添加模型
          </summary>
          <form action={createModelAction} className="admin-form-card mt-12">
            <div className="form-stack">
              <div className="form-row">
                <div className="field">
                  <label>模型 ID</label>
                  <input
                    className="input mono"
                    name="id"
                    placeholder="provider-model-name"
                    required
                  />
                  <span className="hint">对外 API 使用的 model 值，创建后不可修改</span>
                </div>
                <div className="field">
                  <label>上游</label>
                  <select className="select" name="upstreamId" required>
                    {upstreamsResult.rows.map((upstream) => (
                      <option key={upstream.id} value={upstream.id}>
                        {upstream.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>显示名称</label>
                  <input
                    className="input"
                    name="displayName"
                    placeholder="Provider Model"
                    required
                  />
                </div>
                <div className="field">
                  <label>上游模型 ID</label>
                  <input
                    className="input mono"
                    name="upstreamModel"
                    placeholder="model-version"
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>输入成本 $ / 1M</label>
                  <input
                    className="input"
                    name="inputUsd"
                    type="number"
                    step="0.0001"
                    min="0"
                    required
                  />
                </div>
                <div className="field">
                  <label>输出成本 $ / 1M</label>
                  <input
                    className="input"
                    name="outputUsd"
                    type="number"
                    step="0.0001"
                    min="0"
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label>描述</label>
                <textarea
                  className="textarea"
                  name="description"
                  maxLength={300}
                  placeholder="适合什么任务..."
                />
              </div>
              <button className="btn btn-dark btn-sm" type="submit">
                创建模型（默认停用）
              </button>
            </div>
          </form>
        </details>
      ) : null}

      <div className="notice mt-16">
        上游配置直接决定平台成本与服务稳定性。启用前请核对：商业授权、允许的区域、
        计费币种与单价、速率限制、数据处理条款和退款政策。成本价必须以官方或授权供应商账单为准。
      </div>
    </>
  );
}
