(() => {
  if (globalThis.__ARG_SCOUT_CONTENT_LOADED__) return;
  globalThis.__ARG_SCOUT_CONTENT_LOADED__ = true;

  const STORAGE_KEY = "argScoutState";
  const MANUAL_SOURCE = "manual-entry";
  const DEFAULT_SESSION_TITLE = "ARG探索メモ";
  const LAYOUT_STYLE_ID = "arg-scout-layout-style";
  const ROOT_CLASS = "arg-scout-layout-active";
  const LEFT_WIDTH = 204;
  const BOTTOM_HEIGHT = 150;
  const canUseExtensionApi = typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

  const initialState = {
    version: 3,
    sessionTitle: DEFAULT_SESSION_TITLE,
    targetPages: 0,
    entries: [],
    keywords: {
      primary: [],
      reserve: []
    },
    updatedAt: null
  };

  let state = structuredClone(initialState);
  let layout = null;
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

      if (message?.type === "ARG_SCOUT_SHOW_LAYOUT") {
        showLayout();
        sendResponse({ ok: true });
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !layout) return;

      if (changes[STORAGE_KEY]?.newValue) {
        state = sanitizeState(changes[STORAGE_KEY].newValue);
        renderAll();
      }

      if (changes.pendingSelection?.newValue?.text) {
        showLayout();
      }
    });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showLayout);
  } else {
    showLayout();
  }

  async function showLayout() {
    ensureLayout();
    applyPageLayout();
    await loadState();
    await consumePendingSelection();
    layout.host.hidden = false;
    syncInputsWithCurrentPage();
    renderAll();
  }

  function ensureLayout() {
    if (layout) return;

    const host = document.createElement("arg-scout-layout");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${layoutStyles()}</style>
      <div class="layout-root" aria-live="polite">
        <aside class="side-panel">
          <header class="side-brand">
            <img class="brand-icon" src="${getIconUrl()}" alt="ARG探索ツール">
          </header>
          <div class="table-head">
            <span>#</span>
            <span>KEY</span>
          </div>
          <ol id="pageList" class="page-list"></ol>
          <footer class="progress">
            <div class="progress-label">
              <span>PROGRESS</span>
              <strong id="progressCount">0 / 0</strong>
            </div>
            <div class="progress-track"><span id="progressBar"></span></div>
          </footer>
        </aside>

        <section class="bottom-bar">
          <header class="bar-head">
            <span>KEYWORDS</span>
            <strong id="keywordCount">0</strong>
          </header>
          <form id="pageForm" class="page-form">
            <label>
              CURRENT
              <input id="currentPageInput" type="number" min="1" inputmode="numeric" placeholder="1">
            </label>
            <label>
              TARGET #
              <input id="targetPagesInput" type="number" min="1" inputmode="numeric" placeholder="46">
            </label>
            <label class="keyword-field">
              KEYWORD
              <input id="keywordInput" type="text" placeholder="このページへ行けたキーワード">
            </label>
            <button id="savePageButton" type="submit">保存</button>
          </form>
          <div class="url-row">
            <span>URL</span>
            <code id="urlPreview"></code>
            <span id="saveStatus" class="save-status"></span>
          </div>
          <ul id="keywordList" class="keyword-list"></ul>
        </section>
      </div>
    `;

    document.documentElement.append(host);
    layout = { host, shadow };
    bindLayoutElements();
  }

  function bindLayoutElements() {
    els = Object.fromEntries(
      [...layout.shadow.querySelectorAll("[id]")].map((node) => [node.id, node])
    );

    els.pageForm.addEventListener("submit", saveCurrentPage);
    els.targetPagesInput.addEventListener("change", updateTargetPages);
    els.currentPageInput.addEventListener("change", clearSaveStatus);
    els.keywordInput.addEventListener("input", clearSaveStatus);

    layout.shadow.querySelector(".side-panel").addEventListener("dragover", allowDrop);
    layout.shadow.querySelector(".side-panel").addEventListener("drop", handleKeywordDrop);
    layout.shadow.querySelector(".bottom-bar").addEventListener("dragover", allowDrop);
    layout.shadow.querySelector(".bottom-bar").addEventListener("drop", handleKeywordDrop);
  }

  function applyPageLayout() {
    document.documentElement.classList.add(ROOT_CLASS);

    let style = document.getElementById(LAYOUT_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = LAYOUT_STYLE_ID;
      document.documentElement.append(style);
    }

    style.textContent = `
      html.${ROOT_CLASS} body {
        box-sizing: border-box !important;
        margin-left: ${LEFT_WIDTH}px !important;
        margin-bottom: ${BOTTOM_HEIGHT}px !important;
        max-width: calc(100vw - ${LEFT_WIDTH}px) !important;
        min-height: calc(100vh - ${BOTTOM_HEIGHT}px) !important;
      }
      @media (max-width: 760px) {
        html.${ROOT_CLASS} body {
          margin-left: 170px !important;
          max-width: calc(100vw - 170px) !important;
          margin-bottom: 180px !important;
        }
      }
    `;
  }

  function renderAll() {
    if (!layout) return;
    renderPages();
    renderKeywords();
    renderProgress();
    renderCurrentUrl();
  }

  function renderPages() {
    const pages = savedPages();
    els.pageList.textContent = "";

    if (!pages.length) {
      const empty = document.createElement("li");
      empty.className = "drop-hint";
      empty.textContent = "ページ番号とキーワードを入力して保存";
      els.pageList.append(empty);
      return;
    }

    pages.forEach((page) => {
      const item = document.createElement("li");
      item.className = "page-row";
      item.classList.toggle("current", page.url === location.href);

      const button = document.createElement("button");
      button.type = "button";
      button.title = `${page.keyword || page.clue}\n${page.title}\n${page.url}`;
      button.innerHTML = `
        <span class="page-no">${String(page.pageNo).padStart(2, "0")}</span>
        <span class="page-main">
          <span class="page-key"></span>
          <span class="page-url"></span>
        </span>
      `;

      button.querySelector(".page-key").textContent = page.keyword || page.clue || page.title || "Unspecified";
      button.querySelector(".page-url").textContent = page.url;
      button.addEventListener("click", () => {
        location.href = page.url;
      });

      item.append(button);
      els.pageList.append(item);
    });
  }

  function renderKeywords() {
    const keywords = allKeywords();
    els.keywordCount.textContent = String(keywords.length);
    els.keywordList.textContent = "";

    if (!keywords.length) {
      const empty = document.createElement("li");
      empty.className = "keyword-empty";
      empty.textContent = "キーワードはまだありません";
      els.keywordList.append(empty);
      return;
    }

    keywords.forEach((keyword) => {
      const item = document.createElement("li");
      item.className = "keyword-chip";
      item.innerHTML = `
        <button class="keyword-use" type="button"></button>
        <button class="keyword-delete" type="button" aria-label="削除">×</button>
      `;
      item.querySelector(".keyword-use").textContent = keyword.text;
      item.querySelector(".keyword-use").addEventListener("click", () => {
        els.keywordInput.value = keyword.text;
        els.keywordInput.focus();
      });
      item.querySelector(".keyword-delete").addEventListener("click", () => deleteKeyword(keyword.bucket, keyword.id));
      els.keywordList.append(item);
    });
  }

  function renderProgress() {
    const total = parsePositiveInt(state.targetPages) || 0;
    const count = new Set(savedPages().map((page) => page.pageNo)).size;
    els.progressCount.textContent = `${count} / ${total || "-"}`;
    els.progressBar.style.width = total ? `${Math.min(100, (count / total) * 100)}%` : "0%";
    els.targetPagesInput.value = total || "";
  }

  function renderCurrentUrl() {
    els.urlPreview.textContent = location.href;
  }

  function syncInputsWithCurrentPage() {
    const current = state.entries.find((entry) => entry.url === location.href);
    els.currentPageInput.value = current?.pageNo || suggestNextPageNo();
    els.keywordInput.value = current?.keyword || "";
    els.targetPagesInput.value = state.targetPages || "";
  }

  async function updateTargetPages() {
    const target = parsePositiveInt(els.targetPagesInput.value);
    state.targetPages = target || 0;
    await saveState();
    renderProgress();
  }

  async function saveCurrentPage(event) {
    event.preventDefault();
    const pageNo = parsePositiveInt(els.currentPageInput.value);
    const targetPages = parsePositiveInt(els.targetPagesInput.value);
    const keyword = els.keywordInput.value.trim();

    if (!pageNo) {
      setSaveStatus("ページ番号を入力してください", true);
      return;
    }

    if (!keyword) {
      setSaveStatus("キーワードを入力してください", true);
      return;
    }

    if (targetPages) {
      state.targetPages = targetPages;
    }

    const now = new Date().toISOString();
    const existing = state.entries.find((entry) => entry.url === location.href || entry.pageNo === pageNo);
    const entry = {
      id: existing?.id || crypto.randomUUID(),
      pageNo,
      clue: keyword,
      title: document.title || keyword,
      keyword,
      url: location.href,
      notes: existing?.notes || "",
      color: existing?.color || "#5ff0b1",
      status: existing?.status || "open",
      source: MANUAL_SOURCE,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    if (existing) {
      Object.assign(existing, entry);
    } else {
      state.entries.push(entry);
    }

    addKeywordToState("primary", keyword);
    await saveState();
    await requestBadgeRefresh();
    setSaveStatus("保存しました", false);
    renderAll();
  }

  function allowDrop(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  async function handleKeywordDrop(event) {
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain").trim();
    if (!text) return;
    els.keywordInput.value = text;
    addKeywordToState("primary", text);
    await saveState();
    renderKeywords();
  }

  async function loadState() {
    if (!canUseExtensionApi) {
      state = sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
      return;
    }

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    state = sanitizeState(result[STORAGE_KEY]);
  }

  async function consumePendingSelection() {
    if (!canUseExtensionApi) return;

    const result = await chrome.storage.local.get(["pendingSelection"]);
    const text = result.pendingSelection?.text?.trim();
    if (!text) return;

    els.keywordInput.value = text;
    addKeywordToState("primary", text);
    await chrome.storage.local.remove("pendingSelection");
    await saveState();
  }

  async function saveState() {
    state.version = 3;
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

    next.version = 3;
    next.sessionTitle = typeof raw.sessionTitle === "string" && raw.sessionTitle.trim()
      ? raw.sessionTitle
      : DEFAULT_SESSION_TITLE;
    next.targetPages = parsePositiveInt(raw.targetPages) || 0;
    next.entries = Array.isArray(raw.entries) ? raw.entries.map(sanitizeEntry).filter(Boolean) : [];
    next.keywords.primary = sanitizeKeywordArray(raw.keywords?.primary);
    next.keywords.reserve = sanitizeKeywordArray(raw.keywords?.reserve);
    next.updatedAt = raw.updatedAt || null;
    return next;
  }

  function sanitizeEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const title = String(entry.title || entry.clue || "無題のページ");
    const keyword = String(entry.keyword || entry.clue || "").trim();

    return {
      id: String(entry.id || crypto.randomUUID()),
      pageNo: parsePositiveInt(entry.pageNo) || 1,
      clue: String(entry.clue || keyword || title),
      title,
      keyword,
      url: String(entry.url || ""),
      notes: String(entry.notes || ""),
      color: normalizeColor(entry.color) || "#5ff0b1",
      status: ["open", "checked", "solved"].includes(entry.status) ? entry.status : "open",
      source: MANUAL_SOURCE,
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

  function savedPages() {
    return [...state.entries]
      .filter((entry) => entry.url)
      .sort((a, b) => a.pageNo - b.pageNo || a.createdAt.localeCompare(b.createdAt));
  }

  function allKeywords() {
    return [
      ...state.keywords.primary.map((keyword) => ({ ...keyword, bucket: "primary" })),
      ...state.keywords.reserve.map((keyword) => ({ ...keyword, bucket: "reserve" }))
    ];
  }

  function addKeywordToState(bucket, text) {
    const target = bucket === "reserve" ? "reserve" : "primary";
    const normalized = text.trim();
    if (!normalized) return;

    const exists = [...state.keywords.primary, ...state.keywords.reserve]
      .some((keyword) => keyword.text.toLowerCase() === normalized.toLowerCase());
    if (exists) return;

    state.keywords[target].push({
      id: crypto.randomUUID(),
      text: normalized,
      createdAt: new Date().toISOString()
    });
  }

  async function deleteKeyword(bucket, id) {
    const target = bucket === "primary" ? "primary" : "reserve";
    state.keywords[target] = state.keywords[target].filter((keyword) => keyword.id !== id);
    await saveState();
    renderKeywords();
  }

  function suggestNextPageNo() {
    const used = new Set(savedPages().map((page) => page.pageNo));
    const target = parsePositiveInt(state.targetPages) || Math.max(used.size + 1, 1);
    for (let pageNo = 1; pageNo <= target + 1; pageNo += 1) {
      if (!used.has(pageNo)) return pageNo;
    }
    return used.size + 1;
  }

  function parsePositiveInt(value) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function normalizeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : null;
  }

  function getSelectionText() {
    return String(window.getSelection?.() || "").trim();
  }

  function getIconUrl() {
    if (canUseExtensionApi) return chrome.runtime.getURL("icons/icon-32.png");
    return "/icons/icon-32.png";
  }

  async function requestBadgeRefresh() {
    if (!canUseExtensionApi) return;
    try {
      await chrome.runtime.sendMessage({ type: "ARG_SCOUT_REFRESH_BADGE" });
    } catch {
      // Badge refresh is cosmetic.
    }
  }

  function setSaveStatus(text, isError) {
    els.saveStatus.textContent = text;
    els.saveStatus.classList.toggle("error", Boolean(isError));
  }

  function clearSaveStatus() {
    setSaveStatus("", false);
  }

  function layoutStyles() {
    return `
      :host {
        all: initial;
        color-scheme: dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      .layout-root {
        color: #dce8f2;
        font-size: 12px;
        line-height: 1.35;
        pointer-events: none;
      }

      button,
      input,
      select,
      code {
        font: inherit;
      }

      .side-panel,
      .bottom-bar {
        position: fixed;
        z-index: 2147483647;
        border: 1px solid rgba(72, 95, 127, 0.95);
        background: rgba(12, 20, 35, 0.98);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.34);
        pointer-events: auto;
      }

      .side-panel {
        left: 8px;
        top: 8px;
        bottom: ${BOTTOM_HEIGHT + 8}px;
        width: 188px;
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
        width: 31px;
        height: 31px;
        border-radius: 7px;
        object-fit: contain;
      }

      .table-head {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        border-bottom: 1px dashed rgba(72, 95, 127, 0.58);
        background: rgba(20, 31, 52, 0.72);
        color: #9daabe;
        font-size: 11px;
        font-weight: 850;
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
        min-height: 54px;
        border: 0;
        border-bottom: 1px solid rgba(72, 95, 127, 0.35);
        background: transparent;
        color: inherit;
        padding: 8px 10px;
        text-align: left;
        cursor: pointer;
      }

      .page-row button:hover,
      .page-row.current button {
        background: rgba(19, 209, 156, 0.09);
      }

      .page-no {
        color: #19d2a0;
        font-weight: 900;
      }

      .page-main {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .page-key,
      .page-url {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .page-key {
        color: #eff7f4;
        font-weight: 800;
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
      .bar-head {
        display: flex;
        align-items: center;
        color: #9daabe;
        font-size: 11px;
        font-weight: 900;
      }

      .progress-label::before,
      .bar-head::before {
        content: "";
        width: 12px;
        height: 12px;
        margin-right: 6px;
        border-radius: 50%;
        background: #19d2a0;
        box-shadow: 0 0 14px rgba(25, 210, 160, 0.65);
      }

      .progress-label span,
      .bar-head span {
        margin-right: auto;
      }

      .progress-label strong,
      .bar-head strong {
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

      .bottom-bar {
        left: 8px;
        right: 8px;
        bottom: 0;
        min-height: ${BOTTOM_HEIGHT}px;
        border-bottom: 0;
        border-radius: 6px 6px 0 0;
        display: grid;
        grid-template-rows: 30px auto auto minmax(34px, 1fr);
      }

      .bar-head {
        border-bottom: 1px solid rgba(72, 95, 127, 0.82);
        padding: 0 14px;
      }

      .bar-head strong {
        margin-left: auto;
      }

      .page-form {
        display: grid;
        grid-template-columns: 92px 92px minmax(180px, 1fr) 76px;
        gap: 8px;
        align-items: end;
        padding: 10px 12px 0;
      }

      .page-form label {
        display: grid;
        gap: 4px;
        color: #9daabe;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0;
      }

      .page-form input,
      .page-form button {
        min-height: 32px;
        border: 1px solid rgba(72, 95, 127, 0.9);
        border-radius: 5px;
        background: rgba(5, 10, 22, 0.88);
        color: #dce8f2;
        padding: 6px 9px;
      }

      .page-form input {
        min-width: 0;
      }

      .page-form button {
        border-color: rgba(25, 210, 160, 0.8);
        background: rgba(18, 146, 113, 0.92);
        color: #f7fffb;
        font-weight: 900;
        cursor: pointer;
      }

      .url-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        color: #7c8ca0;
        padding: 6px 12px 0;
      }

      .url-row code {
        overflow: hidden;
        color: #9daabe;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .save-status {
        min-width: 8em;
        color: #19d2a0;
        text-align: right;
      }

      .save-status.error {
        color: #ff6f91;
      }

      .keyword-list {
        display: flex;
        flex-wrap: wrap;
        align-content: start;
        gap: 7px;
        min-height: 0;
        margin: 0;
        padding: 9px 12px 12px;
        list-style: none;
        overflow: auto;
      }

      .keyword-empty {
        color: rgba(31, 206, 171, 0.64);
        font-style: italic;
      }

      .keyword-chip {
        display: inline-grid;
        grid-template-columns: minmax(0, auto) auto;
        align-items: center;
        gap: 5px;
        max-width: min(360px, 100%);
        border: 1px solid rgba(72, 95, 127, 0.9);
        border-radius: 999px;
        background: rgba(17, 28, 48, 0.95);
        padding: 4px 6px 4px 10px;
      }

      .keyword-use,
      .keyword-delete {
        border: 0;
        background: transparent;
        color: #eff7f4;
        cursor: pointer;
        padding: 0;
      }

      .keyword-use {
        overflow: hidden;
        max-width: 28ch;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .keyword-delete {
        color: #9daabe;
        padding: 0 5px;
      }

      @media (max-width: 760px) {
        .side-panel {
          width: 158px;
          bottom: 188px;
        }

        .bottom-bar {
          min-height: 180px;
        }

        .page-form {
          grid-template-columns: 1fr 1fr;
        }

        .keyword-field {
          grid-column: 1 / -1;
        }
      }
    `;
  }
})();
