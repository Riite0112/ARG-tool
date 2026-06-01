(() => {
  if (globalThis.__ARG_SCOUT_CONTENT_LOADED__) return;
  globalThis.__ARG_SCOUT_CONTENT_LOADED__ = true;

  const STORAGE_KEY = "argScoutState";
  const BUTTON_SOURCE = "extension-button";
  const DEFAULT_SESSION_TITLE = "ARG探索メモ";
  const canUseExtensionApi = typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

  const initialState = {
    version: 2,
    sessionTitle: DEFAULT_SESSION_TITLE,
    entries: [],
    keywords: {
      primary: [],
      reserve: []
    },
    updatedAt: null
  };

  let state = structuredClone(initialState);
  let selectedPageId = null;
  let overlay = null;
  let els = {};

  if (canUseExtensionApi) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "ARG_SCOUT_GET_SELECTION") {
        sendResponse({
          text: getSelectionText(),
          title: document.title,
          url: location.href
        });
        return;
      }

      if (message?.type === "ARG_SCOUT_SHOW_OVERLAY") {
        selectedPageId = message.selectedPageId || selectedPageId;
        showOverlay();
        sendResponse({ ok: true });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !overlay) return;

      if (changes[STORAGE_KEY]?.newValue) {
        state = sanitizeState(changes[STORAGE_KEY].newValue);
        render();
      }

      if (changes.pendingSelection?.newValue?.text) {
        showOverlay();
      }
    });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showOverlay);
  } else {
    showOverlay();
  }

  async function showOverlay() {
    ensureOverlay();
    await loadState();
    overlay.host.hidden = false;
    render();
  }

  function ensureOverlay() {
    if (overlay) return;

    const host = document.createElement("arg-scout-overlay");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${overlayStyles()}</style>
      <div class="overlay" aria-live="polite">
        <aside class="side-panel">
          <header class="side-brand">
            <img class="brand-icon" src="${getIconUrl()}" alt="">
          </header>
          <div class="table-head">
            <span>#</span>
            <span>KEY</span>
          </div>
          <ol id="pageList" class="page-list"></ol>
          <footer class="progress">
            <div class="progress-label">
              <span>PROGRESS</span>
              <strong id="progressCount">0</strong>
            </div>
            <div class="progress-track"><span id="progressBar"></span></div>
          </footer>
        </aside>

        <section class="keyword-bar">
          <header class="keyword-head">
            <span>KEYWORDS</span>
            <strong id="keywordCount">0</strong>
          </header>
          <form id="keywordForm" class="keyword-form">
            <input id="keywordInput" type="text" placeholder="キーワード、暗号、合言葉を保存">
            <select id="keywordTarget" aria-label="保存先">
              <option value="primary">主力</option>
              <option value="reserve">保留</option>
            </select>
            <button type="submit">保存</button>
          </form>
          <ul id="keywordList" class="keyword-list"></ul>
        </section>
      </div>
    `;

    document.documentElement.append(host);
    overlay = { host, shadow };
    bindOverlayElements();
  }

  function bindOverlayElements() {
    els = Object.fromEntries(
      [...overlay.shadow.querySelectorAll("[id]")].map((node) => [node.id, node])
    );

    els.keywordForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = els.keywordInput.value.trim();
      if (!text) return;
      addKeyword(els.keywordTarget.value, text);
      els.keywordInput.value = "";
    });

    overlay.shadow.querySelector(".side-panel").addEventListener("dragover", allowDrop);
    overlay.shadow.querySelector(".side-panel").addEventListener("drop", handleKeywordDrop);
    overlay.shadow.querySelector(".keyword-bar").addEventListener("dragover", allowDrop);
    overlay.shadow.querySelector(".keyword-bar").addEventListener("drop", handleKeywordDrop);
  }

  function render() {
    if (!overlay) return;
    renderPages();
    renderKeywords();
  }

  function renderPages() {
    const pages = buttonPages();
    els.pageList.textContent = "";
    els.progressCount.textContent = String(pages.length);
    els.progressBar.style.width = `${Math.min(100, pages.length * 8)}%`;

    if (!pages.length) {
      const empty = document.createElement("li");
      empty.className = "drop-hint";
      empty.textContent = "拡張ボタンでページ追加";
      els.pageList.append(empty);
      return;
    }

    pages.forEach((page) => {
      const item = document.createElement("li");
      item.className = "page-row";
      item.classList.toggle("active", page.id === selectedPageId);

      const button = document.createElement("button");
      button.type = "button";
      button.title = `${page.title || page.clue}\n${page.url}`;
      button.innerHTML = `
        <span class="page-no">${String(page.pageNo).padStart(2, "0")}</span>
        <span class="page-main">
          <span class="page-title"></span>
          <span class="page-url"></span>
        </span>
      `;

      button.querySelector(".page-title").textContent = page.title || page.clue || "無題のページ";
      button.querySelector(".page-url").textContent = page.url;
      button.addEventListener("click", () => {
        selectedPageId = page.id;
        location.href = page.url;
      });

      item.append(button);
      els.pageList.append(item);
    });
  }

  function renderKeywords() {
    const keywords = [
      ...state.keywords.primary.map((keyword) => ({ ...keyword, bucket: "primary" })),
      ...state.keywords.reserve.map((keyword) => ({ ...keyword, bucket: "reserve" }))
    ];

    els.keywordCount.textContent = String(keywords.length);
    els.keywordList.textContent = "";

    if (!keywords.length) {
      const empty = document.createElement("li");
      empty.className = "keyword-empty";
      empty.textContent = "ここにキーワードを保存";
      els.keywordList.append(empty);
      return;
    }

    keywords.forEach((keyword) => {
      const item = document.createElement("li");
      item.className = "keyword-chip";
      item.innerHTML = `
        <span class="bucket"></span>
        <span class="text"></span>
        <button class="delete" type="button" aria-label="削除">×</button>
      `;
      item.querySelector(".bucket").textContent = keyword.bucket === "primary" ? "主力" : "保留";
      item.querySelector(".text").textContent = keyword.text;
      item.querySelector(".delete").addEventListener("click", () => deleteKeyword(keyword.bucket, keyword.id));
      els.keywordList.append(item);
    });
  }

  async function addKeyword(bucket, text) {
    const target = bucket === "reserve" ? "reserve" : "primary";
    const normalized = text.trim();
    if (!normalized) return;

    state.keywords[target].push({
      id: crypto.randomUUID(),
      text: normalized,
      createdAt: new Date().toISOString()
    });

    await saveState();
    renderKeywords();
  }

  async function deleteKeyword(bucket, id) {
    const target = bucket === "primary" ? "primary" : "reserve";
    state.keywords[target] = state.keywords[target].filter((keyword) => keyword.id !== id);
    await saveState();
    renderKeywords();
  }

  function allowDrop(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleKeywordDrop(event) {
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain").trim();
    if (text) addKeyword("primary", text);
  }

  async function loadState() {
    if (!canUseExtensionApi) {
      state = sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
      return;
    }

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    state = sanitizeState(result[STORAGE_KEY]);

    const pending = await chrome.storage.local.get(["pendingSelection"]);
    if (pending.pendingSelection?.text) {
      await addKeyword("primary", pending.pendingSelection.text);
      await chrome.storage.local.remove("pendingSelection");
    }
  }

  async function saveState() {
    state.updatedAt = new Date().toISOString();
    if (!canUseExtensionApi) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return;
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function sanitizeState(raw) {
    const next = structuredClone(initialState);
    if (!raw || typeof raw !== "object") return next;

    next.version = 2;
    next.sessionTitle = typeof raw.sessionTitle === "string" && raw.sessionTitle.trim()
      ? raw.sessionTitle
      : DEFAULT_SESSION_TITLE;
    next.entries = Array.isArray(raw.entries) ? raw.entries.map(sanitizeEntry).filter(Boolean) : [];
    next.keywords.primary = sanitizeKeywordArray(raw.keywords?.primary);
    next.keywords.reserve = sanitizeKeywordArray(raw.keywords?.reserve);
    next.updatedAt = raw.updatedAt || null;
    return next;
  }

  function sanitizeEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const title = String(entry.title || entry.clue || "無題のページ");

    return {
      id: String(entry.id || crypto.randomUUID()),
      pageNo: Number.isInteger(Number(entry.pageNo)) && Number(entry.pageNo) > 0 ? Number(entry.pageNo) : 1,
      clue: String(entry.clue || title),
      title,
      url: String(entry.url || ""),
      notes: String(entry.notes || ""),
      color: /^#[0-9a-f]{6}$/i.test(String(entry.color || "")) ? entry.color : "#5ff0b1",
      status: ["open", "checked", "solved"].includes(entry.status) ? entry.status : "open",
      source: entry.source === BUTTON_SOURCE ? BUTTON_SOURCE : "manual",
      createdAt: entry.createdAt || new Date().toISOString(),
      updatedAt: entry.updatedAt || new Date().toISOString()
    };
  }

  function sanitizeKeywordArray(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => ({
        id: String(item?.id || crypto.randomUUID()),
        text: String(item?.text || "").trim(),
        createdAt: item?.createdAt || new Date().toISOString()
      }))
      .filter((item) => item.text);
  }

  function buttonPages() {
    return state.entries
      .filter((entry) => entry.source === BUTTON_SOURCE)
      .sort((a, b) => a.pageNo - b.pageNo || a.createdAt.localeCompare(b.createdAt));
  }

  function getSelectionText() {
    return String(window.getSelection?.() || "").trim();
  }

  function getIconUrl() {
    if (canUseExtensionApi) return chrome.runtime.getURL("icons/icon-32.png");
    return "/icons/icon-32.png";
  }

  function overlayStyles() {
    return `
      :host {
        all: initial;
        color-scheme: dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      .overlay {
        color: #dce8f2;
        font-size: 12px;
        line-height: 1.35;
        pointer-events: none;
      }

      button,
      input,
      select {
        font: inherit;
      }

      .side-panel,
      .keyword-bar {
        position: fixed;
        z-index: 2147483647;
        border: 1px solid rgba(72, 95, 127, 0.95);
        background: rgba(12, 20, 35, 0.97);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.34);
        pointer-events: auto;
      }

      .side-panel {
        left: 10px;
        top: 10px;
        bottom: 116px;
        width: 184px;
        display: grid;
        grid-template-rows: 58px auto minmax(0, 1fr) 58px;
        overflow: hidden;
        border-radius: 6px;
      }

      .side-brand {
        display: flex;
        align-items: center;
        padding: 0 18px;
        border-bottom: 1px solid rgba(72, 95, 127, 0.8);
      }

      .brand-icon {
        width: 28px;
        height: 28px;
        border-radius: 7px;
      }

      .table-head {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        gap: 0;
        border-bottom: 1px dashed rgba(72, 95, 127, 0.58);
        background: rgba(20, 31, 52, 0.72);
        color: #9daabe;
        font-size: 11px;
        font-weight: 800;
        padding: 7px 12px;
      }

      .page-list {
        margin: 0;
        padding: 0;
        list-style: none;
        overflow: auto;
      }

      .drop-hint {
        color: rgba(31, 206, 171, 0.72);
        font-size: 12px;
        font-style: italic;
        padding: 48px 18px;
      }

      .page-row button {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        width: 100%;
        min-height: 50px;
        border: 0;
        border-bottom: 1px solid rgba(72, 95, 127, 0.35);
        background: transparent;
        color: inherit;
        padding: 8px 10px;
        text-align: left;
        cursor: pointer;
      }

      .page-row button:hover,
      .page-row.active button {
        background: rgba(19, 209, 156, 0.09);
      }

      .page-no {
        color: #19d2a0;
        font-weight: 850;
      }

      .page-main {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .page-title,
      .page-url {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .page-title {
        color: #eff7f4;
        font-weight: 750;
      }

      .page-url {
        color: #7c8ca0;
        font-size: 10px;
      }

      .progress {
        display: grid;
        align-content: center;
        gap: 8px;
        border-top: 1px solid rgba(72, 95, 127, 0.8);
        padding: 10px 14px;
      }

      .progress-label,
      .keyword-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #9daabe;
        font-size: 11px;
        font-weight: 850;
      }

      .progress-label::before,
      .keyword-head::before {
        content: "";
        width: 12px;
        height: 12px;
        margin-right: 6px;
        border-radius: 50%;
        background: #19d2a0;
        box-shadow: 0 0 14px rgba(25, 210, 160, 0.65);
      }

      .progress-label span,
      .keyword-head span {
        margin-right: auto;
      }

      .progress-label strong,
      .keyword-head strong {
        color: #19d2a0;
      }

      .progress-track {
        height: 7px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(55, 75, 102, 0.62);
      }

      .progress-track span {
        display: block;
        height: 100%;
        width: 0;
        border-radius: inherit;
        background: linear-gradient(90deg, #19d2a0, #62f3ca);
      }

      .keyword-bar {
        left: 10px;
        right: 10px;
        bottom: 0;
        min-height: 112px;
        border-bottom: 0;
        border-radius: 6px 6px 0 0;
        display: grid;
        grid-template-rows: 30px auto minmax(36px, 1fr);
      }

      .keyword-head {
        justify-content: flex-start;
        gap: 6px;
        border-bottom: 1px solid rgba(72, 95, 127, 0.82);
        padding: 0 14px;
      }

      .keyword-head strong {
        margin-left: auto;
      }

      .keyword-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 90px 74px;
        gap: 8px;
        padding: 10px 12px 0;
      }

      .keyword-form input,
      .keyword-form select,
      .keyword-form button {
        min-height: 32px;
        border: 1px solid rgba(72, 95, 127, 0.9);
        border-radius: 5px;
        background: rgba(5, 10, 22, 0.88);
        color: #dce8f2;
        padding: 6px 9px;
      }

      .keyword-form button {
        border-color: rgba(25, 210, 160, 0.8);
        background: rgba(18, 146, 113, 0.92);
        color: #f7fffb;
        font-weight: 850;
        cursor: pointer;
      }

      .keyword-list {
        display: flex;
        flex-wrap: wrap;
        align-content: start;
        gap: 7px;
        min-height: 0;
        margin: 0;
        padding: 10px 12px 12px;
        list-style: none;
        overflow: auto;
      }

      .keyword-empty {
        color: rgba(31, 206, 171, 0.64);
        font-style: italic;
      }

      .keyword-chip {
        display: inline-grid;
        grid-template-columns: auto minmax(0, auto) auto;
        align-items: center;
        gap: 6px;
        max-width: min(360px, 100%);
        border: 1px solid rgba(72, 95, 127, 0.9);
        border-radius: 999px;
        background: rgba(17, 28, 48, 0.95);
        padding: 5px 7px;
      }

      .bucket {
        border-radius: 999px;
        background: rgba(19, 209, 156, 0.16);
        color: #19d2a0;
        font-size: 10px;
        font-weight: 850;
        padding: 2px 6px;
      }

      .text {
        overflow: hidden;
        color: #eff7f4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .delete {
        border: 0;
        background: transparent;
        color: #9daabe;
        cursor: pointer;
        padding: 0 5px;
      }

      @media (max-width: 700px) {
        .side-panel {
          width: 156px;
          bottom: 132px;
        }

        .keyword-bar {
          min-height: 128px;
        }

        .keyword-form {
          grid-template-columns: 1fr;
        }
      }
    `;
  }
})();
