// CokeAI 采购回填助手 —— 本站后台页脚本（https://cokeai.cc.cd/admin/*）
//
// 令牌接口要求管理员会话 cookie，只有同源页面能调用；扩展后台与弹窗都拿不到
// cookie。所以这里在同源下 POST 取牌，再把令牌和门槛数据转交给后台脚本。
// 未登录或不是管理员时接口返回 404，保持静默即可。

(() => {
  "use strict";

  const TOKEN_PATH = "/api/admin/shop/capture/token";
  const GATE_PATH = "/api/admin/shop/capture/enabled";
  const REFRESH_MS = 30 * 60 * 1000;
  const MIN_MINT_INTERVAL_MS = 5 * 60 * 1000;

  let lastMintAt = 0;
  let busy = false;
  let alive = true;
  let refreshTimer = 0;

  async function postJson(path) {
    try {
      const res = await fetch(`${location.origin}${path}`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        // Server-side defence-in-depth: the capture endpoints require this
        // custom header so a simple form post cannot mint tokens.
        headers: { accept: "application/json", "x-cokeai-capture": "1" },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function tell(message) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        alive = false;
        return null;
      }
      return await chrome.runtime.sendMessage(message);
    } catch {
      // 扩展被重载后本页脚本的 context 失效。必须停掉后续取牌：发牌会让
      // 服务端作废其它标签页手里的旧令牌。
      alive = false;
      return null;
    }
  }

  async function mintToken(force) {
    if (!force && Date.now() - lastMintAt < MIN_MINT_INTERVAL_MS) return;
    lastMintAt = Date.now();
    const data = await postJson(TOKEN_PATH);
    if (!data || typeof data.token !== "string" || typeof data.expiresAt !== "string") return;
    await tell({
      type: "CAPTURE_TOKEN",
      token: data.token,
      expiresAt: data.expiresAt,
      origin: location.origin,
    });
  }

  async function reportGate() {
    const gate = await postJson(GATE_PATH);
    if (!gate) return;
    await tell({
      type: "CAPTURE_GATE",
      gate: {
        enabled: gate.enabled === true,
        depth: Number(gate.depth) || 0,
        min: Number(gate.min) || 0,
      },
      origin: location.origin,
    });
  }

  // 只在页面可见时取牌：隐藏的后台标签不必刷新，避免和当前标签互相作废令牌。
  async function refresh(force) {
    if (!alive) {
      clearInterval(refreshTimer);
      return;
    }
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    try {
      await mintToken(force);
      await reportGate();
    } finally {
      busy = false;
    }
  }

  void refresh(false);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh(false);
  });

  // 令牌 12 小时有效；后台页常开时每 30 分钟续一张，过期后自动化不会停摆。
  refreshTimer = setInterval(() => {
    void refresh(true);
  }, REFRESH_MS);
})();
