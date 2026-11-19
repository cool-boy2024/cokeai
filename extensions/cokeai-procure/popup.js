// CokeAI 采购回填助手 —— 弹窗
// 所有来自后台/服务器的内容都用 textContent 渲染，弹窗里没有 innerHTML。
// 回填必须由运营点击确认，弹窗不会自动提交。

const DEFAULT_BASE = "https://cokeai.cc.cd";

let state = null;
let busy = false;
let baseDirty = false;
let lastPendingKey = "";
let countdownTimer = null;
let refreshTimer = null;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  els.confirm.addEventListener("click", () => void confirmCapture());
  els.saveBase.addEventListener("click", () => void saveBase());
  els.apiBase.addEventListener("input", () => {
    baseDirty = true;
    els.saveHint.textContent = "未保存";
  });
  countdownTimer = setInterval(updateCountdowns, 1000);
  refreshTimer = setInterval(() => void loadState(false), 15000);
  window.addEventListener("unload", () => {
    clearInterval(countdownTimer);
    clearInterval(refreshTimer);
  });
  void loadState(true);
});

function cacheElements() {
  for (const id of [
    "conn-line",
    "status-pill",
    "banner-token",
    "banner-gate",
    "banner-error",
    "queue-meta",
    "queue-list",
    "pending",
    "pending-note",
    "field-list",
    "pending-url",
    "order-select",
    "confirm",
    "result",
    "pending-empty",
    "api-base",
    "save-hint",
    "save-base",
  ]) {
    els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
  }
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return { ok: false, error: "扩展后台无响应，请在 chrome://extensions 重新加载扩展" };
  }
}

async function loadState(refresh) {
  const next = await sendMessage({ type: refresh ? "REFRESH_STATE" : "GET_STATE" });
  if (!next || typeof next !== "object" || !next.queue) {
    showErrorBanner(next && next.error ? next.error : "读取扩展状态失败，请重新加载扩展");
    return;
  }
  state = next;
  render();
}

// ---------- 渲染 ----------

function render() {
  if (!state) return;
  renderHeader();
  renderBanners();
  renderQueue();
  renderPending();
  renderOrderSelect();
  renderSettings();
}

function renderHeader() {
  const token = state.token;
  if (!token || !token.active) {
    els.connLine.textContent = "未连接本站后台";
    els.statusPill.textContent = "未连接";
    els.statusPill.className = "pill warn";
    return;
  }
  const remainingHours = Math.max(0, (Date.parse(token.expiresAt) - Date.now()) / 3600000);
  const hoursText = remainingHours >= 1 ? `${Math.round(remainingHours)} 小时` : "不足 1 小时";
  els.connLine.textContent = `${stripSlash(state.apiBase)} · 令牌剩余 ${hoursText}`;
  if (state.status && state.status.level === "error") {
    els.statusPill.textContent = "刷新失败";
    els.statusPill.className = "pill error";
    return;
  }
  els.statusPill.textContent = "已连接";
  els.statusPill.className = "pill ok";
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function showBanner(node, text) {
  node.textContent = text;
  node.classList.toggle("hidden", !text);
}

function showErrorBanner(text) {
  showBanner(els.bannerError, text || "");
}

function renderBanners() {
  const token = state.token;
  const tokenOrigin = token && token.origin ? stripSlash(token.origin) : "";
  const apiBase = stripSlash(state.apiBase);
  if (!token || !token.active) {
    showBanner(
      els.bannerToken,
      "未连接本站：请打开 https://cokeai.cc.cd/admin 的任意后台页（需管理员登录），扩展会自动取 12 小时令牌。",
    );
  } else if (tokenOrigin && apiBase && tokenOrigin !== apiBase) {
    showBanner(
      els.bannerToken,
      `令牌来自 ${tokenOrigin}，但 API Base 是 ${apiBase}：请求可能失败，请在设置里把两者对齐。`,
    );
  } else {
    showBanner(els.bannerToken, "");
  }

  const gate = state.gate;
  if (gate && gate.enabled === false) {
    showBanner(
      els.bannerGate,
      `未达门槛 ${gate.depth}/${gate.min}：待采购单数还不到 ${gate.min} 单，请继续人工采购。`,
    );
  } else {
    showBanner(els.bannerGate, "");
  }

  let errorText = "";
  if (state.status && state.status.level === "error") {
    const time = state.status.at
      ? new Date(state.status.at).toLocaleTimeString("zh-CN", { hour12: false })
      : "";
    errorText = `${state.status.message}${time ? `（${time}）` : ""}`;
  }
  showErrorBanner(errorText);
}

function renderQueue() {
  const list = els.queueList;
  const items = Array.isArray(state.queue.items) ? state.queue.items : [];
  list.textContent = "";
  els.queueMeta.textContent = state.queue.fetchedAt
    ? `刷新于 ${new Date(state.queue.fetchedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
    : "";

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = state.token && state.token.active
      ? "暂无等待回填的订单。先在后台采购队列点「开始采购」。"
      : "尚未连接本站后台，无法读取队列。";
    list.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "queue-item";

    const head = document.createElement("div");
    head.className = "queue-head";
    const orderNo = document.createElement("strong");
    orderNo.textContent = item.orderNo;
    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = item.amountLabel;
    head.append(orderNo, amount);

    const product = document.createElement("div");
    product.className = "muted";
    product.textContent = `${item.productName} × ${item.qty}`;

    const supplier = document.createElement("div");
    supplier.className = "muted small";
    supplier.textContent = item.supplierTitle ? `货源：${item.supplierTitle}` : "货源：未绑定链接";

    const countdown = document.createElement("div");
    countdown.className = "countdown";
    countdown.dataset.until = item.captureUntil;
    countdown.textContent = formatRemaining(item.captureUntil);

    li.append(head, product, supplier, countdown);
    list.appendChild(li);
  }
  updateCountdowns();
}

function formatRemaining(iso) {
  const until = Date.parse(iso);
  if (!Number.isFinite(until)) return "回填窗口未知";
  const diff = until - Date.now();
  if (diff <= 0) return "回填窗口已过期";
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `剩 ${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
  }
  return `剩 ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateCountdowns() {
  for (const node of document.querySelectorAll(".countdown[data-until]")) {
    const until = Date.parse(node.dataset.until || "");
    if (!Number.isFinite(until)) {
      node.textContent = "回填窗口未知";
      continue;
    }
    const diff = until - Date.now();
    node.textContent = formatRemaining(node.dataset.until);
    node.classList.toggle("expired", diff <= 0);
    node.classList.toggle("urgent", diff > 0 && diff < 5 * 60 * 1000);
  }
}

function renderPending() {
  const pending = state.pending;
  const hasPending = Boolean(pending && pending.fields && Object.keys(pending.fields).length);
  els.pending.classList.toggle("hidden", !hasPending);
  els.pendingEmpty.classList.toggle("hidden", hasPending);
  els.fieldList.textContent = "";

  if (!hasPending) {
    lastPendingKey = "";
    return;
  }

  const pendingKey = `${pending.receivedAt || ""}|${pending.source || ""}`;
  if (pendingKey !== lastPendingKey) {
    lastPendingKey = pendingKey;
    // 新的抓取结果出现时，清掉上一次的提示，避免误以为刚回填成功
    els.result.textContent = "";
    els.result.className = "result hidden";
  }

  for (const [label, value] of Object.entries(pending.fields)) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    els.fieldList.append(dt, dd);
  }

  const meta = [];
  if (pending.source) meta.push(pending.source);
  if (pending.receivedAt) {
    meta.push(
      `${new Date(pending.receivedAt).toLocaleTimeString("zh-CN", { hour12: false })} 抓取`,
    );
  }
  if (pending.supplierOrderRef) meta.push(`货源单号 ${pending.supplierOrderRef}`);
  els.pendingNote.textContent = meta.join(" · ");

  els.pendingUrl.textContent = pending.pageUrl ? `来源页：${pending.pageUrl}` : "";
  els.pendingUrl.classList.toggle("hidden", !pending.pageUrl);
}

function renderOrderSelect() {
  const select = els.orderSelect;
  const items = Array.isArray(state.queue.items) ? state.queue.items : [];
  const previous = select.value;
  select.textContent = "";

  if (items.length === 0) {
    select.add(new Option("队列为空，先在后台点「开始采购」", ""));
    select.disabled = true;
    updateConfirm();
    return;
  }

  for (const item of items) {
    const label = `${item.orderNo} · ${item.productName}`.slice(0, 80);
    select.add(new Option(label, item.id));
  }
  select.disabled = false;
  if (items.some((item) => item.id === previous)) select.value = previous;
  updateConfirm();
}

function updateConfirm() {
  const hasPending = Boolean(state && state.pending && state.pending.fields);
  els.confirm.disabled = busy || !hasPending || !els.orderSelect.value;
}

function renderSettings() {
  if (!baseDirty && document.activeElement !== els.apiBase) {
    els.apiBase.value = state.apiBase || DEFAULT_BASE;
  }
}

// ---------- 操作 ----------

function inferKind(fields) {
  const keys = Object.keys(fields || {});
  return keys.some((key) => /密码|账号|帳號|邮箱|email/i.test(key)) ? "account" : "code";
}

function showResult(ok, message) {
  els.result.textContent = message;
  els.result.className = ok === null ? "result" : `result ${ok ? "ok" : "bad"}`;
}

async function confirmCapture() {
  if (busy || !state || !state.pending) return;
  const orderId = els.orderSelect.value;
  if (!orderId) {
    showResult(false, "请选择要回填的订单");
    return;
  }

  const pending = state.pending;
  busy = true;
  updateConfirm();
  showResult(null, "正在回填…");

  const result = await sendMessage({
    type: "CONFIRM_CAPTURE",
    orderId,
    kind: inferKind(pending.fields),
    fields: pending.fields,
    pageUrl: pending.pageUrl || "",
    supplierOrderRef: pending.supplierOrderRef || "",
  });

  busy = false;
  if (result && result.ok) {
    const suffix = result.orderDelivered
      ? "，订单已交付并通知客户"
      : "，后台仍显示采购中，请到后台确认";
    showResult(true, `已回填订单 ${result.orderNo || ""}${suffix}`);
  } else {
    showResult(false, `回填失败：${(result && result.error) || "未知错误"}`);
  }

  await loadState(false);
  updateConfirm();
}

async function saveBase() {
  const raw = els.apiBase.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+$/i.test(raw)) {
    els.saveHint.textContent = "地址要以 http:// 或 https:// 开头";
    return;
  }
  try {
    await chrome.storage.sync.set({ apiBase: raw });
    baseDirty = false;
    els.saveHint.textContent = "已保存";
    await loadState(true);
  } catch {
    els.saveHint.textContent = "保存失败，请检查扩展权限";
  }
}
