// CokeAI 采购回填助手 —— 货源站页面脚本（zyanai.cc / ai-buy.vip）
//
// 只做一件事：在付款成功页把「卡密 / 兑换码 / 卡号 + 密码」等交付字段从
// 可见文本里启发式提取出来，交给扩展后台等待人工确认。
// 不读取 cookie、不读取 storage、不发送整页 HTML，抓不到就不打扰。

(() => {
  "use strict";

  const KEYWORDS = ["卡密", "兑换码", "CDK", "激活码", "卡号", "卡號", "密码"];
  const KEYWORD_RE = /(卡密|兑换码|CDK|激活码|卡号|卡號|密码)/i;
  const LABEL_VALUE_RE =
    /(卡密|兑换码|CDK|激活码|卡号|卡號|密码)\s*[：:]?\s*([A-Za-z0-9][A-Za-z0-9_-]{7,})/gi;
  // 允许带连字符的卡密（XXXX-XXXX-XXXX）；是否达标另按字母数字总数判断。
  const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9_-]{7,}/g;
  const COPY_RE = /复制|複製|copy/i;
  const ORDER_REF_RE =
    /(订单号|订单编号|訂單編號|訂單號|order\s*(?:no|id))\s*[：:#]?\s*([A-Za-z0-9-]{6,})/i;

  const MAX_FIELD_LEN = 300;
  const MAX_FIELDS = 12;
  const SCAN_DELAY_MS = 800;
  const DEDUPE_MS = 10 * 60 * 1000;
  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|INPUT|OPTION|SVG)$/;

  let lastSignature = "";
  let lastSentAt = 0;
  let scanTimer = 0;
  let scanning = false;
  let observer = null;

  // ---------- 基础工具 ----------

  function alnumCount(text) {
    const matches = String(text || "").match(/[A-Za-z0-9]/g);
    return matches ? matches.length : 0;
  }

  function visibleText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  // 从一段文本里取交付值：专用值容器（只读输入、code、单一值元素）保留完整
  // 文本（邮箱、带符号的密码不能截断）；其余文本只取连续 ≥8 个字母数字的片段。
  function pickValue(text, options) {
    const allowPunctuation = Boolean(options && options.allowPunctuation);
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw || raw.length > MAX_FIELD_LEN) return "";
    if (allowPunctuation && raw.length <= 120 && alnumCount(raw) >= 8) return raw;
    const tokens = raw.match(TOKEN_RE);
    if (tokens) {
      for (const token of tokens) {
        if (alnumCount(token) >= 8) return token;
      }
    }
    return "";
  }

  function valueFromNode(node) {
    if (!node) return "";
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return pickValue(node.value, { allowPunctuation: true });
    }
    const tag = node.tagName;
    const text = visibleText(node);
    if (!text || KEYWORD_RE.test(text)) return "";
    const strict = tag === "CODE" || tag === "PRE" || tag === "KBD" || tag === "SAMP";
    // 无空格、无中文的短元素基本就是值本身（邮箱、带符号密码），整段保留。
    const looksLikeSingleValue =
      text.length <= 120 && !/\s/.test(text) && !/[\u4e00-\u9fff]/.test(text) && alnumCount(text) >= 8;
    return pickValue(text, { allowPunctuation: strict || looksLikeSingleValue });
  }

  function labelOf(text) {
    const match = String(text || "").match(KEYWORD_RE);
    if (!match) return "";
    const word = match[1];
    if (/^cdk$/i.test(word)) return "CDK";
    return word === "卡號" ? "卡号" : word;
  }

  function addField(fields, label, value) {
    if (!label || !value) return;
    if (Object.keys(fields).length >= MAX_FIELDS) return;
    if (fields[label] === value) return;
    if (!fields[label]) {
      fields[label] = value;
      return;
    }
    let index = 2;
    while (fields[`${label} ${index}`] && index < 10) index += 1;
    if (index >= 10) return;
    fields[`${label} ${index}`] = value;
  }

  // ---------- 提取：标签 + 值 ----------

  function inlinePairs(text) {
    const clean = String(text || "").replace(/\s+/g, " ");
    const pairs = [];
    const re = new RegExp(LABEL_VALUE_RE.source, "gi");
    let match;
    while ((match = re.exec(clean)) && pairs.length < MAX_FIELDS) {
      const value = pickValue(match[2]);
      if (value) pairs.push({ label: labelOf(match[1]), value });
    }
    return pairs;
  }

  function valueNearLabel(el) {
    const inner = el.querySelector("input, textarea, code, pre, samp");
    const innerValue = valueFromNode(inner);
    if (innerValue) return innerValue;

    let sibling = el.nextElementSibling;
    for (let i = 0; i < 3 && sibling; i += 1) {
      const value =
        valueFromNode(sibling) ||
        valueFromNode(sibling.querySelector("input, textarea, code, pre, samp"));
      if (value) return value;
      sibling = sibling.nextElementSibling;
    }

    const parent = el.parentElement;
    if (!parent) return "";
    for (const child of parent.children) {
      if (child === el || child.contains(el)) continue;
      if (!(el.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const value =
        valueFromNode(child) ||
        valueFromNode(child.querySelector("input, textarea, code, pre, samp"));
      if (value) return value;
    }

    if (visibleText(parent).length <= 40) {
      const uncle = parent.nextElementSibling;
      const value = uncle
        ? valueFromNode(uncle) || valueFromNode(uncle.querySelector("input, textarea, code, pre, samp"))
        : "";
      if (value) return value;
    }

    // 值在标签左侧的布局（例如值列在前、标签列在后）
    let previous = el.previousElementSibling;
    for (let i = 0; i < 2 && previous; i += 1) {
      const value =
        valueFromNode(previous) ||
        valueFromNode(previous.querySelector("input, textarea, code, pre, samp"));
      if (value) return value;
      previous = previous.previousElementSibling;
    }
    return "";
  }

  function collectLabeled(fields) {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return KEYWORD_RE.test(node.nodeValue || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const seen = new Set();
    let node = walker.nextNode();
    while (node && seen.size < 200) {
      const el = node.parentElement;
      if (el) seen.add(el);
      node = walker.nextNode();
    }

    for (const el of seen) {
      if (!isVisible(el)) continue;
      const text = visibleText(el);
      if (!text) continue;
      const pairs = inlinePairs(text);
      if (pairs.length) {
        for (const pair of pairs) addField(fields, pair.label, pair.value);
        continue;
      }
      if (text.length > 40) continue;
      const label = labelOf(text);
      if (!label) continue;
      const value = valueNearLabel(el);
      if (value) addField(fields, label, value);
    }
  }

  // ---------- 提取：只读输入框 ----------

  function labelNear(el) {
    if (el.id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const label = explicit ? labelOf(visibleText(explicit)) : "";
        if (label) return label;
      } catch {
        // id 含特殊字符时跳过
      }
    }
    let node = el.parentElement;
    for (let depth = 0; depth < 4 && node; depth += 1) {
      const text = visibleText(node);
      if (text && text.length <= 120) {
        const label = labelOf(text);
        if (label) return label;
      }
      node = node.parentElement;
    }
    let previous = el.previousElementSibling;
    for (let i = 0; i < 2 && previous; i += 1) {
      const label = labelOf(visibleText(previous));
      if (label) return label;
      previous = previous.previousElementSibling;
    }
    return "";
  }

  function collectReadonlyInputs(fields) {
    const nodes = document.querySelectorAll(
      "input[readonly], input[disabled], textarea[readonly], textarea[disabled]",
    );
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const value = pickValue(node.value, { allowPunctuation: true });
      if (!value) continue;
      const label = labelNear(node);
      if (label) addField(fields, label, value);
    }
  }

  // ---------- 提取：复制按钮旁的值 ----------

  function copyTargetValue(btn) {
    const clipboardText = btn.getAttribute("data-clipboard-text");
    if (clipboardText) {
      const value = pickValue(clipboardText, { allowPunctuation: true });
      if (value) return value;
    }
    const clipboardTarget = btn.getAttribute("data-clipboard-target");
    if (clipboardTarget) {
      try {
        const value = valueFromNode(document.querySelector(clipboardTarget));
        if (value) return value;
      } catch {
        // 选择器非法时忽略
      }
    }

    const container = btn.parentElement;
    const scopes = [
      btn.previousElementSibling,
      btn.nextElementSibling,
      container ? container.previousElementSibling : null,
      container ? container.nextElementSibling : null,
    ];
    for (const scope of scopes) {
      if (!scope) continue;
      const value =
        valueFromNode(scope) ||
        valueFromNode(scope.querySelector("input, textarea, code, pre, samp"));
      if (value) return value;
    }
    if (container) {
      const inner = valueFromNode(container.querySelector("input, textarea, code, pre, samp"));
      if (inner) return inner;
      const containerText = visibleText(container).replace(visibleText(btn), " ");
      const value = pickValue(containerText);
      if (value) return value;
    }
    return "";
  }

  function collectCopyButtons(fields) {
    const nodes = document.querySelectorAll(
      "button, a, [role='button'], [data-clipboard-text]",
    );
    for (const node of nodes) {
      const text = visibleText(node);
      const aria = node.getAttribute("aria-label") || node.getAttribute("title") || "";
      const isCopy = node.hasAttribute("data-clipboard-text") || COPY_RE.test(text) || COPY_RE.test(aria);
      if (!isCopy) continue;
      if (!node.hasAttribute("data-clipboard-text") && text.length > 10) continue;
      if (!isVisible(node)) continue;
      const value = copyTargetValue(node);
      if (!value) continue;
      const label = labelNear(node) || labelOf(text) || "卡密";
      addField(fields, label, value);
    }
  }

  // ---------- 汇总与上报 ----------

  function findOrderRef() {
    const text = document.body ? (document.body.innerText || "").slice(0, 20000) : "";
    const match = text.match(ORDER_REF_RE);
    if (!match) return "";
    const value = match[2].trim();
    return alnumCount(value) >= 6 ? value : "";
  }

  function pageHasKeyword() {
    const text = document.body ? document.body.textContent || "" : "";
    if (!text) return false;
    const lower = text.toLowerCase();
    return KEYWORDS.some((word) => lower.includes(word.toLowerCase()));
  }

  function collectFields() {
    const fields = {};
    collectLabeled(fields);
    collectReadonlyInputs(fields);
    collectCopyButtons(fields);
    return fields;
  }

  async function scanOnce() {
    if (scanning || document.visibilityState === "hidden") return;
    if (!pageHasKeyword()) return;
    scanning = true;
    try {
      const fields = collectFields();
      if (Object.keys(fields).length === 0) return;
      const payload = { fields, pageUrl: location.href };
      const orderRef = findOrderRef();
      if (orderRef) payload.supplierOrderRef = orderRef;

      const signature = JSON.stringify(payload);
      if (signature === lastSignature && Date.now() - lastSentAt < DEDUPE_MS) return;

      const result = await chrome.runtime.sendMessage({ type: "CDK_FOUND", payload });
      if (result && result.ok) {
        lastSignature = signature;
        lastSentAt = Date.now();
      }
    } catch {
      // 扩展被重载后 context 失效：停掉观察，避免在页面上继续空转。
      // 刷新页面后浏览器会重新注入内容脚本。
      if (observer) observer.disconnect();
    } finally {
      scanning = false;
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      void scanOnce();
    }, SCAN_DELAY_MS);
  }

  // 首次渲染 + SPA 异步渲染都走同一套去抖扫描。
  scheduleScan();
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("hashchange", scheduleScan);
  window.addEventListener("popstate", scheduleScan);
})();
