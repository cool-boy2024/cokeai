// CokeAI 采购回填助手 —— 后台服务脚本
//
// 数据边界：令牌只写 chrome.storage.session（浏览器会话内存），不落盘；
// 只有后台脚本会带着 Bearer 令牌访问本站 API。货源站页面脚本从不读取
// cookie，也不向任何服务器发送整页 HTML。

const DEFAULT_API_BASE = "https://cokeai.cc.cd";
const POLL_MS = 30 * 1000;
const TOKEN_HEADER_PREFIX = "coke-cap-";
const NOTIFY_ID = "capture-queue";
const SUPPLIER_HOSTS = ["zyanai.cc", "ai-buy.vip"];
const ADMIN_HOSTS = ["cokeai.cc.cd", "localhost"];
const MAX_FIELDS = 20;
const MAX_FIELD_KEY = 40;
const MAX_FIELD_VALUE = 2000;
const MAX_PAGE_URL = 500;
const MAX_ORDER_REF = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KEYS = {
  token: "captureToken",
  pending: "pendingCapture",
  queue: "queueCache",
  gate: "captureGate",
  status: "pollStatus",
  lastNotified: "lastNotifiedCount",
};

// ---------- 存储与状态 ----------

function normalizeBase(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  // https anywhere; plain http only for local development, so a mis-typed
  // base can never send the bearer token in cleartext.
  if (/^https:\/\/[^\s/]+$/i.test(value)) return value;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)) return value;
  return DEFAULT_API_BASE;
}

async function getApiBase() {
  try {
    const stored = await chrome.storage.sync.get("apiBase");
    return normalizeBase(stored.apiBase);
  } catch {
    return DEFAULT_API_BASE;
  }
}

async function readToken() {
  const stored = await chrome.storage.session.get(KEYS.token);
  const saved = stored[KEYS.token];
  if (!saved || typeof saved.token !== "string" || !saved.token.startsWith(TOKEN_HEADER_PREFIX)) {
    return null;
  }
  const expires = Date.parse(saved.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  return saved;
}

// 令牌失效时连同队列缓存一起清掉，避免弹窗展示上一轮的过期队列。
async function clearTokenAndQueue() {
  try {
    await chrome.storage.session.remove([KEYS.token, KEYS.queue]);
  } catch {
    // storage 不可用时无需处理，下一次轮询会再次失败并给出提示
  }
}

async function storeStatus(level, message) {
  try {
    await chrome.storage.session.set({
      [KEYS.status]: { level, message, at: new Date().toISOString() },
    });
  } catch {
    // 状态只是提示，写失败不影响主流程
  }
}

function senderHostname(sender) {
  const url = sender && typeof sender.url === "string" ? sender.url : "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isAdminSender(sender) {
  const host = senderHostname(sender);
  return ADMIN_HOSTS.includes(host);
}

function isSupplierSender(sender) {
  const host = senderHostname(sender);
  return SUPPLIER_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// ---------- 外部数据清洗 ----------

function sanitizeFields(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (typeof rawKey !== "string" || typeof rawValue !== "string") continue;
    const key = rawKey.trim().slice(0, MAX_FIELD_KEY);
    const value = rawValue.trim().slice(0, MAX_FIELD_VALUE);
    if (!key || !value) continue;
    out[key] = value;
    if (Object.keys(out).length >= MAX_FIELDS) break;
  }
  return out;
}

function normalizeQueueItem(item) {
  if (!item || typeof item !== "object") return null;
  if (!UUID_RE.test(String(item.id || ""))) return null;
  return {
    id: String(item.id),
    orderNo: String(item.orderNo || ""),
    productName: String(item.productName || ""),
    qty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : 1,
    amountLabel: String(item.amountLabel || ""),
    supplierTitle: typeof item.supplierTitle === "string" ? item.supplierTitle : "",
    supplierUrl: typeof item.supplierUrl === "string" ? item.supplierUrl : "",
    captureUntil: String(item.captureUntil || ""),
  };
}

// ---------- 角标与通知 ----------

async function updateBadge() {
  try {
    const stored = await chrome.storage.session.get([KEYS.queue, KEYS.pending]);
    const items = stored[KEYS.queue] && Array.isArray(stored[KEYS.queue].items)
      ? stored[KEYS.queue].items
      : [];
    if (stored[KEYS.pending]) {
      await chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
      await chrome.action.setBadgeText({ text: "填" });
      await chrome.action.setTitle({ title: "已抓到交付内容，打开扩展确认回填" });
      return;
    }
    if (items.length > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
      await chrome.action.setBadgeText({ text: String(Math.min(items.length, 99)) });
      await chrome.action.setTitle({ title: `有 ${items.length} 单等待回填` });
      return;
    }
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "CokeAI 采购回填助手" });
  } catch {
    // 图标更新失败不影响轮询
  }
}

async function maybeNotify(items) {
  try {
    const stored = await chrome.storage.session.get(KEYS.lastNotified);
    const last = Number(stored[KEYS.lastNotified] || 0);
    if (items.length === last) return;
    await chrome.storage.session.set({ [KEYS.lastNotified]: items.length });
    if (items.length === 0) {
      await chrome.notifications.clear(NOTIFY_ID);
      return;
    }
    const preview = items
      .slice(0, 3)
      .map((item) => item.orderNo)
      .filter(Boolean)
      .join("、");
    await chrome.notifications.create(NOTIFY_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `有 ${items.length} 单等待回填`,
      message: preview
        ? `${preview}${items.length > 3 ? " 等" : ""}，打开扩展确认订单。`
        : "打开扩展确认订单。",
      priority: 1,
    });
  } catch {
    // 通知权限或图标缺失时静默，页面内仍有角标与弹窗
  }
}

// ---------- 轮询队列 ----------

let pollInFlight = false;

async function pollQueue() {
  if (pollInFlight) return null;
  pollInFlight = true;
  try {
    const token = await readToken();
    if (!token) {
      await storeStatus("warn", "尚未取得本站令牌，请打开后台页");
      await updateBadge();
      return null;
    }
    const base = await getApiBase();
    let res;
    try {
      res = await fetch(`${base}/api/admin/shop/capture/queue`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token.token}`, accept: "application/json" },
        cache: "no-store",
      });
    } catch (error) {
      await storeStatus("error", `队列刷新失败：${error && error.message ? error.message : "网络错误"}`);
      await updateBadge();
      return null;
    }

    if (res.status === 401 || res.status === 404) {
      await clearTokenAndQueue();
      await storeStatus("warn", "令牌已失效，请重新打开本站后台页");
      await updateBadge();
      return null;
    }
    if (!res.ok) {
      await storeStatus("error", `队列刷新失败（HTTP ${res.status}）`);
      await updateBadge();
      return null;
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const rawItems = data && Array.isArray(data.items) ? data.items : [];
    const items = rawItems.map(normalizeQueueItem).filter(Boolean);
    await chrome.storage.session.set({
      [KEYS.queue]: {
        items,
        admin: data && typeof data.admin === "string" ? data.admin : "",
        fetchedAt: new Date().toISOString(),
      },
    });
    await storeStatus("ok", items.length ? `队列 ${items.length} 单待回填` : "队列为空");
    await updateBadge();
    await maybeNotify(items);
    return items;
  } catch (error) {
    await storeStatus("error", `队列刷新失败：${error && error.message ? error.message : "未知错误"}`);
    await updateBadge();
    return null;
  } finally {
    pollInFlight = false;
  }
}

// MV3 的 service worker 空闲会被回收。这里用 30 秒自续定时器，并在每次触发
// 时先调用 storage API（扩展事件会重置空闲计时）；worker 若仍被回收，下一次
// 打开弹窗、后台页或收到消息时会重新执行本文件并恢复轮询。
let pollTimer = null;

function schedulePoll(delay = POLL_MS) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    try {
      await chrome.storage.session.get(KEYS.token);
    } catch {
      // 忽略，轮询自己会给出错误状态
    }
    await pollQueue();
    schedulePoll();
  }, delay);
}

// ---------- 消息处理 ----------

async function handleToken(message, sender) {
  if (!isAdminSender(sender)) return { ok: false, error: "来源不允许" };
  const token = typeof message.token === "string" ? message.token.trim() : "";
  const expiresAt = typeof message.expiresAt === "string" ? message.expiresAt : "";
  const expires = Date.parse(expiresAt);
  if (!token.startsWith(TOKEN_HEADER_PREFIX) || token.length < 20 || token.length > 200) {
    return { ok: false, error: "令牌格式不对" };
  }
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return { ok: false, error: "令牌已过期" };
  }
  const origin = normalizeBase(message.origin || (sender && sender.origin));
  const previous = await readToken();
  // 多个后台标签同时发牌时，只保留有效期更晚的那张，避免被旧消息覆盖。
  if (previous && Date.parse(previous.expiresAt) > expires) {
    return { ok: true, ignored: true };
  }
  await chrome.storage.session.set({
    [KEYS.token]: {
      token,
      expiresAt,
      origin,
      receivedAt: new Date().toISOString(),
    },
  });
  await pollQueue();
  return { ok: true };
}

async function handleGate(message, sender) {
  if (!isAdminSender(sender)) return { ok: false, error: "来源不允许" };
  const gate = message.gate && typeof message.gate === "object" ? message.gate : null;
  if (!gate) return { ok: false, error: "缺少门槛数据" };
  const depth = Number(gate.depth);
  const min = Number(gate.min);
  await chrome.storage.session.set({
    [KEYS.gate]: {
      enabled: gate.enabled === true,
      depth: Number.isFinite(depth) ? Math.max(0, depth) : 0,
      min: Number.isFinite(min) ? Math.max(0, min) : 0,
      checkedAt: new Date().toISOString(),
    },
  });
  return { ok: true };
}

async function handleCdkFound(message, sender) {
  if (!isSupplierSender(sender)) return { ok: false, error: "来源不允许" };
  const payload = message.payload && typeof message.payload === "object" ? message.payload : null;
  if (!payload) return { ok: false, error: "内容为空" };
  const fields = sanitizeFields(payload.fields);
  if (Object.keys(fields).length === 0) return { ok: false, error: "没有可回填字段" };
  const pending = {
    fields,
    pageUrl: typeof payload.pageUrl === "string" ? payload.pageUrl.slice(0, MAX_PAGE_URL) : "",
    supplierOrderRef:
      typeof payload.supplierOrderRef === "string"
        ? payload.supplierOrderRef.trim().slice(0, MAX_ORDER_REF)
        : "",
    receivedAt: new Date().toISOString(),
    source: senderHostname(sender),
  };
  // 只保留最近一次抓取，回填时由运营在弹窗里确认订单。
  await chrome.storage.session.set({ [KEYS.pending]: pending });
  await updateBadge();
  return { ok: true };
}

async function handleConfirm(message, sender) {
  const senderUrl = sender && typeof sender.url === "string" ? sender.url : "";
  if (!senderUrl.startsWith("chrome-extension://")) return { ok: false, error: "来源不允许" };
  const orderId = typeof message.orderId === "string" ? message.orderId.trim() : "";
  if (!UUID_RE.test(orderId)) return { ok: false, error: "请选择要回填的订单" };
  const token = await readToken();
  if (!token) return { ok: false, error: "本站令牌已失效，请重新打开后台页" };
  const fields = sanitizeFields(message.fields);
  if (Object.keys(fields).length === 0) return { ok: false, error: "没有可回填的交付内容" };

  const kind =
    message.kind === "account" || message.kind === "manual_note" ? message.kind : "code";
  const body = {
    kind,
    fields,
    pageUrl: typeof message.pageUrl === "string" ? message.pageUrl.slice(0, MAX_PAGE_URL) : "",
  };
  if (typeof message.supplierOrderRef === "string" && message.supplierOrderRef.trim()) {
    body.supplierOrderRef = message.supplierOrderRef.trim().slice(0, MAX_ORDER_REF);
  }

  const base = await getApiBase();
  let res;
  try {
    res = await fetch(`${base}/api/admin/shop/capture/orders/${encodeURIComponent(orderId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        Authorization: `Bearer ${token.token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "网络错误，回填没有发送" };
  }

  if (res.status === 401 || res.status === 404) {
    await clearTokenAndQueue();
    await storeStatus("warn", "令牌已失效，请重新打开本站后台页");
    await updateBadge();
    return { ok: false, error: "令牌已失效，请重新打开后台页" };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.ok && data) {
    await chrome.storage.session.remove(KEYS.pending);
    await pollQueue();
    await updateBadge();
    return {
      ok: true,
      orderNo: typeof data.orderNo === "string" ? data.orderNo : "",
      orderDelivered: data.orderDelivered !== false,
    };
  }

  const reason =
    data && typeof data.error === "string" && data.error ? data.error : `HTTP ${res.status}`;
  await storeStatus("error", `回填失败：${reason}`);
  return { ok: false, error: reason };
}

async function buildState() {
  const [session, sync] = await Promise.all([
    chrome.storage.session.get([KEYS.token, KEYS.queue, KEYS.pending, KEYS.gate, KEYS.status]),
    chrome.storage.sync.get("apiBase"),
  ]);
  const savedToken = session[KEYS.token] || null;
  const expires = savedToken ? Date.parse(savedToken.expiresAt) : NaN;
  return {
    queue: session[KEYS.queue] || { items: [], admin: "", fetchedAt: null },
    pending: session[KEYS.pending] || null,
    gate: session[KEYS.gate] || null,
    status: session[KEYS.status] || null,
    apiBase: sync.apiBase || DEFAULT_API_BASE,
    token: savedToken
      ? {
          active: Number.isFinite(expires) && expires > Date.now(),
          expiresAt: savedToken.expiresAt,
          origin: savedToken.origin || "",
        }
      : null,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return false;
  }
  const run = async () => {
    switch (message.type) {
      case "CAPTURE_TOKEN":
        return handleToken(message, sender);
      case "CAPTURE_GATE":
        return handleGate(message, sender);
      case "CDK_FOUND":
        return handleCdkFound(message, sender);
      case "CONFIRM_CAPTURE":
        return handleConfirm(message, sender);
      case "REFRESH_STATE":
        await pollQueue();
        return buildState();
      case "GET_STATE":
        return buildState();
      default:
        return { ok: false, error: "未知消息" };
    }
  };
  run()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : "后台异常" }));
  return true;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId !== NOTIFY_ID) return;
  try {
    await chrome.action.openPopup();
  } catch {
    const base = await getApiBase();
    await chrome.tabs.create({ url: `${base}/admin/shop/queue` });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.apiBase) {
    void pollQueue();
  }
});

// service worker 每次唤醒都会执行到这里，顺带恢复轮询。
void pollQueue();
schedulePoll();
