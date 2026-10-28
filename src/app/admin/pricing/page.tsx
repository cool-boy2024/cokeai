import type { Metadata } from "next";
import {
  AlertTriangle,
  CheckCircle2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  deletePricingCostAction,
  syncPricingAction,
  upsertPricingCostAction,
} from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { query, toNumber } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCny } from "@/lib/money";
import { listCurrentPrices } from "@/lib/pricing/engine";

export const metadata: Metadata = { title: "定价" };
export const dynamic = "force-dynamic";

type CostRow = {
  id: string;
  model_id: string;
  platform: string;
  account_id: string | null;
  source_name: string;
  input_usd_per_mtok: string;
  output_usd_per_mtok: string;
  cache_read_usd_per_mtok: string;
  cache_write_usd_per_mtok: string;
  per_request_usd: string;
  created_at: string;
};

export default async function AdminPricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [prices, costs, lastSync] = await Promise.all([
    listCurrentPrices(),
    query<CostRow>(
      `SELECT id, model_id, platform, account_id, source_name,
              input_usd_per_mtok, output_usd_per_mtok,
              cache_read_usd_per_mtok, cache_write_usd_per_mtok,
              per_request_usd, created_at
         FROM pricing_costs
        ORDER BY model_id, created_at DESC
        LIMIT 200`,
    ),
    query<{
      started_at: string;
      status: string;
      fx_rate: string | null;
      models_active: number;
      models_paused: number;
      models_updated: number;
    }>(
      `SELECT started_at, status, fx_rate, models_updated,
              models_updated AS models_active, models_paused
         FROM pricing_sync_runs
        ORDER BY started_at DESC LIMIT 1`,
    ),
  ]);

  const sync = lastSync.rows[0];
  const active = prices.filter((row) => row.status === "active").length;
  const paused = prices.filter((row) => row.status === "paused").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>定价</h1>
          <p>官方价与拿货价共同决定售价：先按官方价让利，再守住拿货价与最低毛利。</p>
        </div>
        <form action={syncPricingAction} className="inline-form">
          <button className="btn btn-dark" type="submit">
            <RefreshCw size={14} /> 立即同步
          </button>
          <button
            className="btn btn-ghost"
            type="submit"
            name="force"
            value="on"
            title="跳过单次涨幅熔断，人工确认后重新上架"
          >
            强制同步
          </button>
        </form>
      </div>

      {params.synced === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>
            同步完成：{params.active} 个在售，{params.paused} 个暂停。
          </div>
        </div>
      ) : null}
      {params.saved === "1" ? (
        <div className="notice notice-green">
          <CheckCircle2 size={16} />
          <div>成本已记录。</div>
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-red">
          <AlertTriangle size={16} />
          <div>{params.error}</div>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">在售模型</div>
          <div className="stat-value">{active}</div>
          <div className="stat-foot">已推送分组价</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">暂停模型</div>
          <div className="stat-value">{paused}</div>
          <div className="stat-foot">缺成本 / 毛利不足 / 涨幅熔断</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">汇率 USD/CNY</div>
          <div className="stat-value">{Number(sync?.fx_rate || 0).toFixed(4)}</div>
          <div className="stat-foot">每小时刷新</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">上次同步</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {sync ? formatDateTime(sync.started_at) : "—"}
          </div>
          <div className="stat-foot">{sync?.status || "未运行"}</div>
        </div>
      </div>

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>当前售价</h2>
            <p>官方价取模型目录，拿货价取下方成本表；Sub2API 后台金额显示 $，实际按人民币额度使用。</p>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>状态</th>
                <th>成本 $/1M</th>
                <th>输入 ¥/1M</th>
                <th>输出 ¥/1M</th>
                <th>毛利</th>
                <th>来源</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {prices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    还没有价格。先在下方录入成本，再点“立即同步”。
                  </td>
                </tr>
              ) : (
                prices.map((row) => (
                  <tr key={row.model_id}>
                    <td className="mono small">{row.model_id}</td>
                    <td>
                      <span
                        className={`badge ${
                          row.status === "active" ? "badge-green" : "badge-red"
                        }`}
                      >
                        {row.status === "active" ? "在售" : "暂停"}
                      </span>
                    </td>
                    <td className="mono small">
                      ${toNumber(row.cost_usd_per_mtok).toFixed(2)}
                    </td>
                    <td className="mono small">
                      {formatCny(toNumber(row.input_cny_per_mtok) * 1_000_000)}
                    </td>
                    <td className="mono small">
                      {formatCny(toNumber(row.output_cny_per_mtok) * 1_000_000)}
                    </td>
                    <td className="mono small">{(row.margin_bps / 100).toFixed(1)}%</td>
                    <td className="small muted">{row.cost_source}</td>
                    <td className="small muted">{row.pause_reason || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel mb-24">
        <div className="panel-head">
          <div>
            <h2>成本表</h2>
            <p>账号级成本优先，同一模型取最高成本，保证不亏。</p>
          </div>
          <Plus size={16} />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>平台</th>
                <th>账号</th>
                <th>来源</th>
                <th>输入 $</th>
                <th>输出 $</th>
                <th>缓存读 $</th>
                <th>记录时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {costs.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    还没有成本记录。
                  </td>
                </tr>
              ) : (
                costs.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono small">{row.model_id}</td>
                    <td className="small">{row.platform || "—"}</td>
                    <td className="mono small">{row.account_id || "—"}</td>
                    <td className="small muted">{row.source_name || "—"}</td>
                    <td className="mono small">
                      ${toNumber(row.input_usd_per_mtok).toFixed(2)}
                    </td>
                    <td className="mono small">
                      ${toNumber(row.output_usd_per_mtok).toFixed(2)}
                    </td>
                    <td className="mono small">
                      ${toNumber(row.cache_read_usd_per_mtok).toFixed(2)}
                    </td>
                    <td className="mono small nowrap">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="text-right">
                      <form action={deletePricingCostAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button className="btn btn-ghost btn-sm" type="submit">
                          <Trash2 size={13} />
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>录入成本</h2>
            <p>单位：美元 / 100 万 Token。填写真实拿货价；官方价由模型目录提供，不需要在这里重复录入。</p>
          </div>
          <Play size={16} />
        </div>
        <div className="panel-body">
          <form action={upsertPricingCostAction} className="form-stack">
            <div className="form-row">
              <div className="field">
                <label>模型 ID</label>
                <input className="input mono" name="modelId" placeholder="gpt-4.1-mini" required />
              </div>
              <div className="field">
                <label>平台</label>
                <select className="select" name="platform" defaultValue="openai">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="kimi">Kimi</option>
                  <option value="zhipu">GLM</option>
                  <option value="minimax">MiniMax</option>
                  <option value="grok">Grok</option>
                </select>
              </div>
              <div className="field">
                <label>账号 ID（可选）</label>
                <input className="input mono" name="accountId" placeholder="Sub2API account id" />
              </div>
              <div className="field">
                <label>来源备注</label>
                <input className="input" name="sourceName" placeholder="官方 / 经销商 A" />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>输入成本 $/1M</label>
                <input className="input" name="inputUsd" type="number" step="0.000001" min="0" defaultValue="0" />
              </div>
              <div className="field">
                <label>输出成本 $/1M</label>
                <input className="input" name="outputUsd" type="number" step="0.000001" min="0" defaultValue="0" />
              </div>
              <div className="field">
                <label>缓存读 $/1M</label>
                <input className="input" name="cacheReadUsd" type="number" step="0.000001" min="0" defaultValue="0" />
              </div>
              <div className="field">
                <label>缓存写 $/1M</label>
                <input className="input" name="cacheWriteUsd" type="number" step="0.000001" min="0" defaultValue="0" />
              </div>
              <div className="field">
                <label>按次成本 $</label>
                <input className="input" name="perRequestUsd" type="number" step="0.000001" min="0" defaultValue="0" />
              </div>
            </div>
            <button className="btn btn-dark" type="submit">
              <Plus size={14} /> 记录成本
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
