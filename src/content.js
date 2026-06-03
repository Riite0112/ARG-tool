(() => {
  if (globalThis.__ARG_SCOUT_CONTENT_LOADED__) return;
  globalThis.__ARG_SCOUT_CONTENT_LOADED__ = true;
  const suppressAutoOpenOnLoad = Boolean(globalThis.__ARG_SCOUT_SUPPRESS_AUTO_OPEN_ON_LOAD__);
  delete globalThis.__ARG_SCOUT_SUPPRESS_AUTO_OPEN_ON_LOAD__;

  const STORAGE_KEY = "argScoutState";
  const MANUAL_SOURCE = "manual-entry";
  const DEFAULT_SESSION_TITLE = "ARG探索メモ";
  const LAYOUT_STYLE_ID = "arg-scout-layout-style";
  const ROOT_CLASS = "arg-scout-layout-active";
  const FIXED_OFFSET_ATTR = "data-arg-scout-fixed-offset";
  const FIXED_BOTTOM_ATTR = "data-arg-scout-fixed-bottom";
  const FIXED_TRANSFORM_ATTR = "data-arg-scout-fixed-transform";
  const STATE_VERSION = 7;
  const LEFT_WIDTH = 204;
  const BOTTOM_HEIGHT = 190;
  const COMPACT_LEFT_WIDTH = 170;
  const COMPACT_BOTTOM_HEIGHT = 220;
  const PROTECTED_TAGS = new Set(["script", "style", "link", "meta", "title", "noscript"]);
  const canUseExtensionApi = typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

  const initialStore = {
    version: STATE_VERSION,
    activeSessionId: null,
    sessions: [],
    updatedAt: null
  };

  const initialState = {
    version: STATE_VERSION,
    id: "",
    sessionTitle: DEFAULT_SESSION_TITLE,
    targetPages: 0,
    trackedSites: [],
    hiddenSites: [],
    entries: [],
    keywords: {
      primary: [],
      reserve: []
    },
    createdAt: null,
    updatedAt: null
  };

  let store = structuredClone(initialStore);
  let state = structuredClone(initialState);
  let layout = null;
  let els = {};
  let fixedElementObserver = null;
  let fixedElementFrame = 0;

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
        showLayout({
          rememberSite: Boolean(message.rememberSite),
          clearHidden: message.clearHidden !== false
        })
          .then(() => sendResponse({ ok: true, visible: true }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }

      if (message?.type === "ARG_SCOUT_HIDE_LAYOUT") {
        hideLayout();
        sendResponse({ ok: true, visible: false });
        return;
      }

      if (message?.type === "ARG_SCOUT_TOGGLE_LAYOUT") {
        toggleLayout()
          .then((visible) => sendResponse({ ok: true, visible }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !layout) return;

      if (changes[STORAGE_KEY]?.newValue) {
        store = sanitizeStore(changes[STORAGE_KEY].newValue);
        state = resolveSessionForCurrentUrl(store, { create: false }) || state;
        if (isHiddenUrl(location.href)) {
          hideLayout();
          return;
        }
        renderAll();
      }

      if (changes.pendingSelection?.newValue?.text) {
        showLayout({ rememberSite: true, clearHidden: true });
      }
    });

    if (!suppressAutoOpenOnLoad) {
      checkAutoOpen();
    }
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showLayout);
  } else {
    showLayout();
  }

  async function showLayout(options = {}) {
    ensureLayout();
    applyPageLayout();
    await loadState({ create: true });
    if (options.clearHidden) {
      forgetHiddenCurrentSite();
    }
    if (options.rememberSite) {
      rememberCurrentSite();
    }
    await saveState();
    await consumePendingSelection();
    layout.host.hidden = false;
    layout.host.style.display = "";
    scheduleProtectFixedElements();
    window.setTimeout(scheduleProtectFixedElements, 350);
    syncInputsWithCurrentPage();
    renderAll();
  }

  async function toggleLayout() {
    if (isLayoutVisible()) {
      await loadState();
      rememberHiddenCurrentSite();
      await saveState();
      hideLayout();
      return false;
    }

    await showLayout({ rememberSite: true, clearHidden: true });
    return true;
  }

  function hideLayout() {
    if (layout) {
      layout.host.hidden = true;
      layout.host.style.display = "none";
    }
    resetPageLayout();
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
            <div class="brand-row">
              <img class="brand-icon" src="${getIconUrl()}" alt="ARG探索ツール">
              <select id="sessionSelect" title="ARGを切り替え"></select>
            </div>
            <input id="sessionTitleInput" class="session-title-input" type="text" placeholder="ARGタイトル">
            <div class="session-actions">
              <small id="sessionSite" class="session-site"></small>
              <button id="newArgButton" class="new-arg-button" type="button" title="現在のサイトを新しいARGとして追加">+ ARG</button>
              <button id="deleteArgButton" class="delete-arg-button" type="button" title="現在のARGを削除">削除</button>
            </div>
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
            <em id="saveStatus" class="save-status"></em>
            <button id="helpButton" class="help-button" type="button" title="説明書" aria-expanded="false">?</button>
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
            <button id="savePageButton" type="submit">ページ保存</button>
            <button id="stashKeywordButton" type="button">一時保存</button>
          </form>
          <ul id="keywordList" class="keyword-list"></ul>
        </section>

        <section id="helpPanel" class="help-panel" hidden aria-label="説明書">
          <header class="help-head">
            <strong>説明書</strong>
            <button id="closeHelpButton" class="help-close" type="button" title="閉じる">×</button>
          </header>
          <div class="help-body">
            <p>ARGごとにページ番号、到達キーワード、URLを手動で記録できます。</p>
            <ul>
              <li>右上の拡張機能アイコンで表示/非表示を切り替えます。</li>
              <li>別のARGは左上の <strong>+ ARG</strong> で追加し、セレクトで切り替えます。</li>
              <li><strong>CURRENT</strong> に現在ページ、<strong>TARGET #</strong> に総ページ数、<strong>KEYWORD</strong> に到達キーワードを入れて保存します。</li>
              <li>左のページを押すと登録URLを開き、<strong>×</strong> でページを削除します。</li>
              <li>下のキーワードはクリックでコピー、<strong>×</strong> で削除します。</li>
              <li>ページ右下のファイル番号などは、下バーに隠れないよう自動で上へ退避します。</li>
            </ul>
          </div>
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
    els.stashKeywordButton.addEventListener("click", stashCurrentKeyword);
    els.newArgButton.addEventListener("click", createArgSession);
    els.deleteArgButton.addEventListener("click", deleteCurrentArgSession);
    els.sessionSelect.addEventListener("change", switchSession);
    els.sessionTitleInput.addEventListener("change", updateSessionTitle);
    els.targetPagesInput.addEventListener("change", updateTargetPages);
    els.currentPageInput.addEventListener("change", clearSaveStatus);
    els.keywordInput.addEventListener("input", clearSaveStatus);
    els.helpButton.addEventListener("click", toggleHelpPanel);
    els.closeHelpButton.addEventListener("click", closeHelpPanel);

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
          margin-left: ${COMPACT_LEFT_WIDTH}px !important;
          max-width: calc(100vw - ${COMPACT_LEFT_WIDTH}px) !important;
          margin-bottom: ${COMPACT_BOTTOM_HEIGHT}px !important;
        }
      }
    `;
    startFixedElementProtection();
    scheduleProtectFixedElements();
  }

  function resetPageLayout() {
    stopFixedElementProtection();
    restorePageFixedElements();
    document.documentElement.classList.remove(ROOT_CLASS);
    document.getElementById(LAYOUT_STYLE_ID)?.remove();
  }

  function startFixedElementProtection() {
    window.removeEventListener("resize", scheduleProtectFixedElements);
    window.addEventListener("resize", scheduleProtectFixedElements, { passive: true });

    if (!document.body || fixedElementObserver) return;

    fixedElementObserver = new MutationObserver(scheduleProtectFixedElements);
    fixedElementObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function stopFixedElementProtection() {
    window.removeEventListener("resize", scheduleProtectFixedElements);
    if (fixedElementFrame) {
      cancelAnimationFrame(fixedElementFrame);
      fixedElementFrame = 0;
    }
    fixedElementObserver?.disconnect();
    fixedElementObserver = null;
  }

  function scheduleProtectFixedElements() {
    if (fixedElementFrame) return;
    fixedElementFrame = requestAnimationFrame(() => {
      fixedElementFrame = 0;
      protectFixedPageElements();
    });
  }

  function protectFixedPageElements() {
    if (!isLayoutVisible() || !document.body) return;

    restorePageFixedElements();

    const metrics = currentLayoutMetrics();
    const offset = metrics.bottom + 12;
    const candidates = [...document.body.querySelectorAll("*")];

    candidates.forEach((node) => {
      if (!shouldOffsetFixedElement(node, metrics)) return;
      offsetFixedElement(node, offset);
    });
  }

  function restorePageFixedElements() {
    document.querySelectorAll(`[${FIXED_OFFSET_ATTR}]`).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      if (node.hasAttribute(FIXED_BOTTOM_ATTR)) {
        node.style.bottom = node.getAttribute(FIXED_BOTTOM_ATTR) || "";
        node.removeAttribute(FIXED_BOTTOM_ATTR);
      }

      if (node.hasAttribute(FIXED_TRANSFORM_ATTR)) {
        node.style.transform = node.getAttribute(FIXED_TRANSFORM_ATTR) || "";
        node.removeAttribute(FIXED_TRANSFORM_ATTR);
      }

      node.removeAttribute(FIXED_OFFSET_ATTR);
    });
  }

  function shouldOffsetFixedElement(node, metrics) {
    if (!(node instanceof HTMLElement)) return false;
    if (node === layout?.host || node.closest("arg-scout-layout")) return false;
    if (PROTECTED_TAGS.has(node.localName)) return false;

    const style = getComputedStyle(node);
    if (style.position !== "fixed") return false;
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;

    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    if (rect.height > Math.min(window.innerHeight * 0.45, metrics.bottom + 80)) return false;
    if (rect.width > window.innerWidth * 0.8 && rect.height > metrics.bottom) return false;

    const overlapsBottomTool = rect.bottom > window.innerHeight - metrics.bottom - 4;
    const isNotCoveredByLeftPanelOnly = rect.right > metrics.left + 16;
    return overlapsBottomTool && isNotCoveredByLeftPanelOnly;
  }

  function offsetFixedElement(node, offset) {
    const style = getComputedStyle(node);
    const computedBottom = parsePixelValue(style.bottom);

    node.setAttribute(FIXED_OFFSET_ATTR, "true");
    node.setAttribute(FIXED_BOTTOM_ATTR, node.style.bottom || "");
    node.setAttribute(FIXED_TRANSFORM_ATTR, node.style.transform || "");

    if (computedBottom !== null) {
      node.style.bottom = `${computedBottom + offset}px`;
      return;
    }

    const originalTransform = node.style.transform.trim();
    node.style.transform = `${originalTransform} translateY(-${offset}px)`.trim();
  }

  function currentLayoutMetrics() {
    const compact = window.matchMedia?.("(max-width: 760px)").matches;
    const defaultLeft = compact ? COMPACT_LEFT_WIDTH : LEFT_WIDTH;
    const defaultBottom = compact ? COMPACT_BOTTOM_HEIGHT : BOTTOM_HEIGHT;
    const sideRect = layout?.shadow.querySelector(".side-panel")?.getBoundingClientRect();
    const bottomRect = layout?.shadow.querySelector(".bottom-bar")?.getBoundingClientRect();

    return {
      left: sideRect?.right ? Math.ceil(sideRect.right) : defaultLeft,
      bottom: bottomRect?.height ? Math.ceil(bottomRect.height) : defaultBottom
    };
  }

  function renderAll() {
    if (!layout) return;
    renderSession();
    renderPages();
    renderKeywords();
    renderProgress();
    scheduleProtectFixedElements();
  }

  function renderSession() {
    els.sessionSelect.textContent = "";
    store.sessions.forEach((session) => {
      const option = document.createElement("option");
      option.value = session.id;
      option.textContent = session.sessionTitle || DEFAULT_SESSION_TITLE;
      els.sessionSelect.append(option);
    });
    els.sessionSelect.value = state.id;
    els.sessionTitleInput.value = state.sessionTitle || DEFAULT_SESSION_TITLE;
    els.sessionSite.textContent = normalizeSiteBase(location.href).replace(/^https?:\/\//, "");
  }

  function renderPages() {
    const pages = savedPages();
    els.pageList.textContent = "";
    let currentItem = null;

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
      if (page.url === location.href) {
        currentItem = item;
      }

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "page-open";
      openButton.title = `${page.keyword || page.clue}\n${page.title}\n${page.url}`;
      openButton.innerHTML = `
        <span class="page-no">${String(page.pageNo).padStart(2, "0")}</span>
        <span class="page-main">
          <span class="page-key"></span>
          <span class="page-url"></span>
        </span>
      `;

      openButton.querySelector(".page-key").textContent = page.keyword || page.clue || page.title || "Unspecified";
      openButton.querySelector(".page-url").textContent = page.url;
      openButton.addEventListener("click", () => {
        location.href = page.url;
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "page-delete";
      deleteButton.title = "このページを削除";
      deleteButton.textContent = "×";
      deleteButton.addEventListener("click", () => deleteSavedPage(page.id));

      item.append(openButton, deleteButton);
      els.pageList.append(item);
    });

    if (currentItem) {
      requestAnimationFrame(() => {
        currentItem.scrollIntoView({
          block: "center",
          inline: "nearest"
        });
      });
    }
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
      item.querySelector(".keyword-use").title = "クリックでコピー";
      item.querySelector(".keyword-use").addEventListener("click", () => copyKeywordText(keyword.text));
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

    forgetHiddenCurrentSite();
    rememberCurrentSite();

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

  async function stashCurrentKeyword() {
    const keyword = els.keywordInput.value.trim();
    if (!keyword) {
      setSaveStatus("キーワードを入力してください", true);
      return;
    }

    addKeywordToState("primary", keyword);
    await saveState();
    setSaveStatus("一時保存しました", false);
    renderKeywords();
  }

  async function copyKeywordText(text) {
    const keyword = String(text || "").trim();
    if (!keyword) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(keyword);
      } else if (!fallbackCopyText(keyword)) {
        throw new Error("Clipboard API is unavailable.");
      }
      setSaveStatus("コピーしました", false);
    } catch {
      if (fallbackCopyText(keyword)) {
        setSaveStatus("コピーしました", false);
        return;
      }

      els.keywordInput.value = keyword;
      els.keywordInput.focus();
      setSaveStatus("コピーできないため入力欄へ入れました", true);
    }
  }

  function fallbackCopyText(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.documentElement.append(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }

  function toggleHelpPanel() {
    const shouldOpen = els.helpPanel.hidden;
    els.helpPanel.hidden = !shouldOpen;
    els.helpButton.setAttribute("aria-expanded", String(shouldOpen));
  }

  function closeHelpPanel() {
    els.helpPanel.hidden = true;
    els.helpButton.setAttribute("aria-expanded", "false");
  }

  async function createArgSession() {
    await loadStore();
    const session = createSession({ trackCurrent: true });
    store.sessions.push(session);
    store.activeSessionId = session.id;
    state = session;
    await saveState();
    syncInputsWithCurrentPage();
    renderAll();
    els.sessionTitleInput.focus();
    els.sessionTitleInput.select();
    setSaveStatus("新しいARGを追加しました", false);
  }

  async function deleteCurrentArgSession() {
    const title = state.sessionTitle || DEFAULT_SESSION_TITLE;
    if (!globalThis.confirm(`「${title}」を削除しますか？\n登録したページとキーワードも削除されます。`)) {
      return;
    }

    await loadStore();
    const nextSessions = store.sessions.filter((session) => session.id !== state.id);
    const base = normalizeSiteBase(location.href);
    const nextSession = nextSessions.find((session) => session.trackedSites.includes(base))
      || nextSessions[0]
      || createSession({ trackCurrent: true });

    store.sessions = nextSessions.includes(nextSession) ? nextSessions : [nextSession];
    store.activeSessionId = nextSession.id;
    state = nextSession;
    await saveState();
    await requestBadgeRefresh();
    syncInputsWithCurrentPage();
    renderAll();
    setSaveStatus("ARGを削除しました", false);
  }

  async function switchSession() {
    await loadStore();
    const selected = store.sessions.find((session) => session.id === els.sessionSelect.value);
    if (!selected) return;

    state = selected;
    rememberCurrentSite();
    forgetHiddenCurrentSite();
    store.activeSessionId = state.id;
    await saveState();
    syncInputsWithCurrentPage();
    renderAll();
    setSaveStatus("ARGを切り替えました", false);
  }

  async function updateSessionTitle() {
    const title = els.sessionTitleInput.value.trim();
    state.sessionTitle = title || defaultSessionTitle(location.href);
    await saveState();
    renderSession();
    setSaveStatus("タイトルを保存しました", false);
  }

  async function deleteSavedPage(id) {
    state.entries = state.entries.filter((entry) => entry.id !== id);
    await saveState();
    await requestBadgeRefresh();
    syncInputsWithCurrentPage();
    renderAll();
    setSaveStatus("ページを削除しました", false);
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

  async function loadState(options = {}) {
    if (!canUseExtensionApi) {
      store = sanitizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
      state = resolveSessionForCurrentUrl(store, { create: options.create }) || createSession({ trackCurrent: false });
      return Boolean(store.sessions.length);
    }

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    store = sanitizeStore(result[STORAGE_KEY]);
    const session = resolveSessionForCurrentUrl(store, { create: options.create });
    state = session || createSession({ trackCurrent: false });
    return Boolean(session);
  }

  async function loadStore() {
    if (!canUseExtensionApi) {
      store = sanitizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
      return;
    }

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    store = sanitizeStore(result[STORAGE_KEY]);
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
    state.version = STATE_VERSION;
    state.updatedAt = new Date().toISOString();
    upsertCurrentSession();
    store.version = STATE_VERSION;
    store.updatedAt = state.updatedAt;

    if (!canUseExtensionApi) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return;
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: store });
  }

  function sanitizeStore(raw) {
    const next = structuredClone(initialStore);
    if (!raw || typeof raw !== "object") return next;

    if (Array.isArray(raw.sessions)) {
      next.sessions = raw.sessions.map(sanitizeSession).filter(Boolean);
      next.activeSessionId = next.sessions.some((session) => session.id === raw.activeSessionId)
        ? raw.activeSessionId
        : next.sessions[0]?.id || null;
      next.updatedAt = raw.updatedAt || null;
      return next;
    }

    const legacySession = sanitizeSession(raw);
    if (legacySession && hasSessionData(legacySession)) {
      next.sessions = [legacySession];
      next.activeSessionId = legacySession.id;
      next.updatedAt = legacySession.updatedAt;
    }
    return next;
  }

  function sanitizeSession(raw) {
    const next = createSession({ trackCurrent: false });
    if (!raw || typeof raw !== "object") return next;

    next.version = STATE_VERSION;
    next.id = String(raw.id || crypto.randomUUID());
    next.sessionTitle = typeof raw.sessionTitle === "string" && raw.sessionTitle.trim()
      ? raw.sessionTitle
      : defaultSessionTitle(raw.trackedSites?.[0] || raw.entries?.[0]?.url || location.href);
    next.targetPages = parsePositiveInt(raw.targetPages) || 0;
    next.entries = Array.isArray(raw.entries) ? raw.entries.map(sanitizeEntry).filter(Boolean) : [];
    next.trackedSites = sanitizeTrackedSites(raw.trackedSites);
    next.hiddenSites = sanitizeTrackedSites(raw.hiddenSites);
    next.entries.forEach((entry) => addTrackedSiteFromUrl(next, entry.url));
    next.keywords.primary = sanitizeKeywordArray(raw.keywords?.primary);
    next.keywords.reserve = sanitizeKeywordArray(raw.keywords?.reserve);
    next.createdAt = raw.createdAt || next.createdAt;
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

  function sanitizeTrackedSites(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(normalizeSiteBase).filter(Boolean))];
  }

  function createSession(options = {}) {
    const now = new Date().toISOString();
    const session = structuredClone(initialState);
    session.id = crypto.randomUUID();
    session.sessionTitle = options.title || defaultSessionTitle(location.href);
    session.createdAt = now;
    session.updatedAt = null;
    if (options.trackCurrent !== false) {
      addTrackedSiteFromUrl(session, location.href);
    }
    return session;
  }

  function resolveSessionForCurrentUrl(targetStore, options = {}) {
    const base = normalizeSiteBase(location.href);
    const active = targetStore.sessions.find((session) => session.id === targetStore.activeSessionId);

    if (active && (!base || active.trackedSites.includes(base))) {
      return active;
    }

    const matched = base
      ? targetStore.sessions.find((session) => session.trackedSites.includes(base))
      : null;
    if (matched) {
      targetStore.activeSessionId = matched.id;
      return matched;
    }

    if (!options.create) return null;

    const session = createSession({ trackCurrent: true });
    targetStore.sessions.push(session);
    targetStore.activeSessionId = session.id;
    return session;
  }

  function upsertCurrentSession() {
    const index = store.sessions.findIndex((session) => session.id === state.id);
    if (index >= 0) {
      store.sessions[index] = state;
    } else {
      store.sessions.push(state);
    }
    store.activeSessionId = state.id;
  }

  function hasSessionData(session) {
    return Boolean(
      session.entries.length ||
      session.keywords.primary.length ||
      session.keywords.reserve.length ||
      session.trackedSites.length ||
      session.targetPages
    );
  }

  function defaultSessionTitle(url) {
    const base = normalizeSiteBase(url);
    if (!base) return DEFAULT_SESSION_TITLE;

    try {
      return `${new URL(base).hostname} ARG`;
    } catch {
      return DEFAULT_SESSION_TITLE;
    }
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

  function parsePixelValue(value) {
    if (!value || value === "auto") return null;
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
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

  async function checkAutoOpen() {
    try {
      const hasSession = await loadState({ create: false });
      if (hasSession && isTrackedUrl(location.href) && !isHiddenUrl(location.href)) {
        await showLayout({ rememberSite: false });
      }
    } catch {
      // Auto-open is a convenience; manual open still works.
    }
  }

  function rememberCurrentSite() {
    addTrackedSiteFromUrl(state, location.href);
  }

  function rememberHiddenCurrentSite() {
    addHiddenSiteFromUrl(state, location.href);
  }

  function forgetHiddenCurrentSite() {
    const base = normalizeSiteBase(location.href);
    if (!base) return;
    state.hiddenSites = state.hiddenSites.filter((site) => site !== base);
  }

  function addTrackedSiteFromUrl(targetState, url) {
    const base = normalizeSiteBase(url);
    if (base && !targetState.trackedSites.includes(base)) {
      targetState.trackedSites.push(base);
    }
  }

  function addHiddenSiteFromUrl(targetState, url) {
    const base = normalizeSiteBase(url);
    if (base && !targetState.hiddenSites.includes(base)) {
      targetState.hiddenSites.push(base);
    }
  }

  function isTrackedUrl(url) {
    const base = normalizeSiteBase(url);
    return Boolean(base && state.trackedSites.includes(base));
  }

  function isHiddenUrl(url) {
    const base = normalizeSiteBase(url);
    return Boolean(base && state.hiddenSites.includes(base));
  }

  function isLayoutVisible() {
    return Boolean(layout && !layout.host.hidden && document.documentElement.classList.contains(ROOT_CLASS));
  }

  function normalizeSiteBase(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) ? url.origin : "";
    } catch {
      return "";
    }
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
      select {
        font: inherit;
      }

      .side-panel,
      .bottom-bar,
      .help-panel {
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
        grid-template-rows: 128px auto minmax(0, 1fr) 58px;
        overflow: hidden;
        border-radius: 6px;
      }

      .side-brand {
        display: grid;
        align-content: center;
        gap: 6px;
        min-width: 0;
        padding: 10px;
        border-bottom: 1px solid rgba(72, 95, 127, 0.8);
      }

      .brand-row {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        align-items: center;
        gap: 7px;
        min-width: 0;
      }

      .brand-icon {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        object-fit: contain;
      }

      .session-site {
        overflow: hidden;
        color: #7c8ca0;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .session-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .new-arg-button,
      .delete-arg-button {
        min-height: 25px;
        border: 1px solid rgba(25, 210, 160, 0.76);
        border-radius: 5px;
        background: rgba(18, 146, 113, 0.86);
        color: #f7fffb;
        font-size: 10px;
        font-weight: 900;
        padding: 4px 6px;
        cursor: pointer;
      }

      .delete-arg-button {
        border-color: rgba(255, 111, 145, 0.72);
        background: rgba(128, 38, 67, 0.86);
      }

      .session-title-input,
      .brand-row select {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(72, 95, 127, 0.9);
        border-radius: 5px;
        background: rgba(5, 10, 22, 0.88);
        color: #dce8f2;
        font-size: 10px;
        font-weight: 800;
        padding: 6px 7px;
      }

      .session-title-input {
        font-size: 11px;
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

      .page-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px;
        border-bottom: 1px solid rgba(72, 95, 127, 0.35);
      }

      .page-open {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        width: 100%;
        min-height: 54px;
        border: 0;
        background: transparent;
        color: inherit;
        padding: 8px 10px;
        text-align: left;
        cursor: pointer;
      }

      .page-open:hover,
      .page-row.current .page-open {
        background: rgba(19, 209, 156, 0.09);
      }

      .page-delete {
        border: 0;
        border-left: 1px solid rgba(72, 95, 127, 0.28);
        background: transparent;
        color: #7c8ca0;
        font-size: 16px;
        font-weight: 800;
        cursor: pointer;
      }

      .page-delete:hover {
        background: rgba(255, 111, 145, 0.13);
        color: #ff8baa;
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
        left: ${LEFT_WIDTH}px;
        right: 8px;
        bottom: 0;
        height: ${BOTTOM_HEIGHT}px;
        max-height: ${BOTTOM_HEIGHT}px;
        min-height: 0;
        border-bottom: 0;
        border-radius: 6px 6px 0 0;
        display: grid;
        grid-template-rows: 30px auto minmax(92px, 1fr);
        overflow: hidden;
      }

      .bottom-bar > * {
        min-width: 0;
        min-height: 0;
      }

      .bar-head {
        border-bottom: 1px solid rgba(72, 95, 127, 0.82);
        gap: 8px;
        padding: 0 14px;
      }

      .bar-head strong {
        margin-left: 0;
        margin-right: 0;
      }

      .page-form {
        display: grid;
        grid-template-columns: 84px 92px minmax(220px, 1fr) 92px 92px;
        gap: 8px;
        align-items: end;
        min-height: 0;
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

      .save-status {
        min-width: min(18ch, 30vw);
        max-width: 28ch;
        overflow: hidden;
        color: #19d2a0;
        font-style: normal;
        font-weight: 700;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .save-status.error {
        color: #ff6f91;
      }

      .help-button,
      .help-close {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: 1px solid rgba(72, 95, 127, 0.9);
        border-radius: 5px;
        background: rgba(5, 10, 22, 0.88);
        color: #dce8f2;
        font-weight: 900;
        cursor: pointer;
      }

      .help-button:hover,
      .help-button[aria-expanded="true"],
      .help-close:hover {
        border-color: rgba(25, 210, 160, 0.85);
        color: #19d2a0;
      }

      .help-panel {
        right: 12px;
        bottom: ${BOTTOM_HEIGHT + 14}px;
        left: ${LEFT_WIDTH + 12}px;
        max-width: 620px;
        max-height: min(420px, calc(100vh - ${BOTTOM_HEIGHT + 34}px));
        overflow: auto;
        border-radius: 6px;
        pointer-events: auto;
      }

      .help-panel[hidden] {
        display: none;
      }

      .help-head {
        display: flex;
        align-items: center;
        gap: 10px;
        border-bottom: 1px solid rgba(72, 95, 127, 0.82);
        padding: 10px 12px;
      }

      .help-head strong {
        margin-right: auto;
        color: #eff7f4;
        font-size: 13px;
      }

      .help-body {
        display: grid;
        gap: 10px;
        padding: 12px 14px 14px;
        color: #b8c8d8;
      }

      .help-body p {
        margin: 0;
      }

      .help-body ul {
        display: grid;
        gap: 8px;
        margin: 0;
        padding-left: 18px;
      }

      .help-body strong {
        color: #f7fffb;
      }

      .keyword-list {
        display: flex;
        flex-wrap: wrap;
        align-content: start;
        gap: 7px;
        min-height: 0;
        max-height: 100%;
        margin: 0;
        padding: 12px;
        list-style: none;
        overflow: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
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
          left: ${COMPACT_LEFT_WIDTH}px;
          height: ${COMPACT_BOTTOM_HEIGHT}px;
          max-height: ${COMPACT_BOTTOM_HEIGHT}px;
        }

        .help-panel {
          left: ${COMPACT_LEFT_WIDTH + 8}px;
          bottom: ${COMPACT_BOTTOM_HEIGHT + 10}px;
          max-height: min(380px, calc(100vh - ${COMPACT_BOTTOM_HEIGHT + 24}px));
        }

        .page-form {
          grid-template-columns: 1fr 1fr;
        }

        .keyword-field {
          grid-column: 1 / -1;
        }

        #savePageButton,
        #stashKeywordButton {
          grid-column: auto;
        }
      }
    `;
  }
})();
