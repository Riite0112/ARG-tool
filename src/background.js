const STORAGE_KEY = "argScoutState";
const MENU_SELECTION_ID = "arg-scout-selection";
const MANUAL_SOURCE = "manual-entry";
const STATE_VERSION = 7;
const DEFAULT_LAYOUT_VIEW = "all";
const LAYOUT_VIEWS = new Set(["all", "pages", "keywords"]);

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: "選択したテキストをARG探索ツールへ送る",
    contexts: ["selection"]
  });
  await updateBadge();
});

chrome.runtime.onStartup?.addListener(updateBadge);

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isSavableTab(tab)) return;

  const store = await loadState();
  const session = resolveSessionForUrl(store, tab.url, { create: false });
  if (session && isTrackedUrl(tab.url, session) && !isHiddenUrl(tab.url, session)) {
    await showLayout(tab, { rememberSite: false });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    updateBadge();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_SELECTION_ID || !info.selectionText) return;

  await chrome.storage.local.set({
    pendingSelection: {
      text: info.selectionText,
      title: tab?.title || "",
      url: tab?.url || "",
      createdAt: new Date().toISOString()
    }
  });

  await showLayout(tab, { rememberSite: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ARG_SCOUT_REFRESH_BADGE") {
    updateBadge()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ARG_SCOUT_SHOW_LAYOUT") {
    showLayout(message.tab || sender.tab, {
      rememberSite: Boolean(message.rememberSite),
      view: message.view
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ARG_SCOUT_OPEN_TOOL_VIEW") {
    openToolView(message.view)
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ARG_SCOUT_HIDE_TOOL") {
    hideActiveTool()
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ARG_SCOUT_GET_POPUP_STATE") {
    getActiveTab()
      .then(getPopupState)
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function openToolView(view) {
  const tab = await getActiveTab();
  if (!isSavableTab(tab)) {
    return { savable: false };
  }

  await showLayout(tab, {
    rememberSite: true,
    view: normalizeLayoutView(view)
  });
  await updateBadge();
  return getPopupState(tab);
}

async function hideActiveTool() {
  const tab = await getActiveTab();
  if (!isSavableTab(tab)) {
    return { savable: false };
  }

  await hideLayoutForTab(tab);
  await updateBadge();
  return getPopupState(tab);
}

async function hideLayoutForTab(tab) {
  if (!isSavableTab(tab) || tab.id == null) return;

  const store = await loadState();
  const session = resolveSessionForUrl(store, tab.url, { create: false });
  if (session) {
    addHiddenSiteFromUrl(session, tab.url);
    store.activeSessionId = session.id;
    await saveState(store);
  }

  await sendLayoutMessage(tab, { type: "ARG_SCOUT_HIDE_LAYOUT" });
  await forceHideLayout(tab);
}

async function sendLayoutMessage(tab, message) {
  if (!isSavableTab(tab) || tab.id == null) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (response?.ok === false) throw new Error(response.error || "Layout message failed");
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          globalThis.__ARG_SCOUT_SUPPRESS_AUTO_OPEN_ON_LOAD__ = true;
        }
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      // The current page may disallow extension scripts.
    }
  }
}

async function forceHideLayout(tab) {
  if (!isSavableTab(tab) || tab.id == null) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const host = document.querySelector("arg-scout-layout");
        if (host) {
          host.hidden = true;
          host.style.display = "none";
        }
        document.querySelectorAll("[data-arg-scout-fixed-offset]").forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.hasAttribute("data-arg-scout-fixed-style")) {
            const style = node.getAttribute("data-arg-scout-fixed-style") || "";
            if (style) {
              node.setAttribute("style", style);
            } else {
              node.removeAttribute("style");
            }
            node.removeAttribute("data-arg-scout-fixed-style");
            node.removeAttribute("data-arg-scout-fixed-bottom");
            node.removeAttribute("data-arg-scout-fixed-transform");
            node.removeAttribute("data-arg-scout-fixed-offset");
            return;
          }
          if (node.hasAttribute("data-arg-scout-fixed-bottom")) {
            node.style.bottom = node.getAttribute("data-arg-scout-fixed-bottom") || "";
            node.removeAttribute("data-arg-scout-fixed-bottom");
          }
          if (node.hasAttribute("data-arg-scout-fixed-transform")) {
            node.style.transform = node.getAttribute("data-arg-scout-fixed-transform") || "";
            node.removeAttribute("data-arg-scout-fixed-transform");
          }
          node.removeAttribute("data-arg-scout-fixed-offset");
        });
        document.documentElement.classList.remove("arg-scout-layout-active");
        document.getElementById("arg-scout-layout-style")?.remove();
      }
    });
  } catch {
    // Some browser pages do not allow injected scripts.
  }
}

async function showLayout(tab, options = {}) {
  if (!isSavableTab(tab) || tab.id == null) return;

  if (options.rememberSite) {
    const store = await loadState();
    let session = resolveSessionForUrl(store, tab.url, { create: false });
    if (!session) {
      session = createSession(tab);
      store.sessions.push(session);
    }
    addTrackedSiteFromUrl(session, tab.url);
    removeHiddenSiteFromUrl(session, tab.url);
    store.activeSessionId = session.id;
    await saveState(store);
  }

  const message = {
    type: "ARG_SCOUT_SHOW_LAYOUT",
    rememberSite: Boolean(options.rememberSite),
    view: normalizeLayoutView(options.view)
  };

  try {
    await sendLayoutMessage(tab, message);
  } catch {
    // The current page may disallow extension scripts.
  }
}

async function getPopupState(tab) {
  if (!isSavableTab(tab)) {
    return {
      savable: false,
      url: tab?.url || ""
    };
  }

  const store = await loadState();
  const session = resolveSessionForUrl(store, tab.url, { create: false });
  const currentEntry = session?.entries.find((entry) => entry.url === tab.url) || null;
  const keywordCount = (session?.keywords.primary.length || 0) + (session?.keywords.reserve.length || 0);
  const base = normalizeSiteBase(tab.url);
  const layoutState = await getTabLayoutState(tab);

  return {
    savable: true,
    url: tab.url,
    site: readableSite(base),
    tracked: Boolean(session && isTrackedUrl(tab.url, session)),
    hidden: Boolean(session && isHiddenUrl(tab.url, session)),
    visible: Boolean(layoutState.visible),
    view: layoutState.visible ? normalizeLayoutView(layoutState.view) : "",
    sessionTitle: session?.sessionTitle || defaultSessionTitle(tab.url),
    pageCount: session?.entries.length || 0,
    keywordCount,
    targetPages: session?.targetPages || 0,
    currentPageNo: currentEntry?.pageNo || null
  };
}

async function getTabLayoutState(tab) {
  if (!isSavableTab(tab) || tab.id == null) {
    return { visible: false, view: "" };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "ARG_SCOUT_GET_LAYOUT_STATE" });
    if (response?.ok) {
      return {
        visible: Boolean(response.visible),
        view: normalizeLayoutView(response.view)
      };
    }
  } catch {
    // The content script may not be available on the current page yet.
  }

  return { visible: false, view: "" };
}

function isSavableTab(tab) {
  if (!tab?.url) return false;
  return !/^(chrome|chrome-extension|edge|about):/i.test(tab.url);
}

function normalizeLayoutView(view) {
  const normalized = String(view || DEFAULT_LAYOUT_VIEW);
  return LAYOUT_VIEWS.has(normalized) ? normalized : DEFAULT_LAYOUT_VIEW;
}

async function loadState() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return sanitizeState(result[STORAGE_KEY]);
}

async function saveState(state) {
  state.version = STATE_VERSION;
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function sanitizeState(raw) {
  const state = {
    version: STATE_VERSION,
    activeSessionId: null,
    sessions: [],
    updatedAt: null
  };

  if (!raw || typeof raw !== "object") return state;

  if (Array.isArray(raw.sessions)) {
    state.sessions = raw.sessions.map(sanitizeSession).filter(Boolean);
    state.activeSessionId = state.sessions.some((session) => session.id === raw.activeSessionId)
      ? raw.activeSessionId
      : state.sessions[0]?.id || null;
    state.updatedAt = raw.updatedAt || null;
    return state;
  }

  const legacySession = sanitizeSession(raw);
  if (legacySession && hasSessionData(legacySession)) {
    state.sessions = [legacySession];
    state.activeSessionId = legacySession.id;
    state.updatedAt = legacySession.updatedAt;
  }
  return state;
}

function sanitizeSession(raw) {
  const state = {
    version: STATE_VERSION,
    id: String(raw?.id || crypto.randomUUID()),
    sessionTitle: "ARG探索メモ",
    targetPages: 0,
    trackedSites: [],
    hiddenSites: [],
    entries: [],
    keywords: {
      primary: [],
      reserve: []
    },
    createdAt: raw?.createdAt || new Date().toISOString(),
    updatedAt: null
  };

  if (!raw || typeof raw !== "object") return state;

  state.version = STATE_VERSION;
  state.sessionTitle = typeof raw.sessionTitle === "string" && raw.sessionTitle.trim()
    ? raw.sessionTitle
    : state.sessionTitle;
  state.targetPages = parsePositiveInt(raw.targetPages) || 0;
  state.entries = Array.isArray(raw.entries) ? raw.entries.map(sanitizeEntry).filter(Boolean) : [];
  state.trackedSites = sanitizeTrackedSites(raw.trackedSites);
  state.hiddenSites = sanitizeTrackedSites(raw.hiddenSites);
  state.entries.forEach((entry) => addTrackedSiteFromUrl(state, entry.url));
  state.keywords.primary = sanitizeKeywordArray(raw.keywords?.primary);
  state.keywords.reserve = sanitizeKeywordArray(raw.keywords?.reserve);
  state.updatedAt = raw.updatedAt || null;
  return state;
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

function createSession(tab) {
  const now = new Date().toISOString();
  const session = sanitizeSession({
    id: crypto.randomUUID(),
    sessionTitle: defaultSessionTitle(tab?.url),
    createdAt: now,
    updatedAt: null
  });
  addTrackedSiteFromUrl(session, tab?.url);
  return session;
}

function resolveSessionForUrl(store, url, options = {}) {
  const base = normalizeSiteBase(url);
  const active = store.sessions.find((session) => session.id === store.activeSessionId);

  if (active && (!base || active.trackedSites.includes(base))) {
    return active;
  }

  const matched = base
    ? store.sessions.find((session) => session.trackedSites.includes(base))
    : null;
  if (matched) {
    store.activeSessionId = matched.id;
    return matched;
  }

  if (!options.create) return null;

  const session = createSession({ url });
  store.sessions.push(session);
  store.activeSessionId = session.id;
  return session;
}

function defaultSessionTitle(url) {
  const base = normalizeSiteBase(url);
  if (!base) return "ARG探索メモ";

  try {
    return `${new URL(base).hostname} ARG`;
  } catch {
    return "ARG探索メモ";
  }
}

function sanitizeTrackedSites(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeSiteBase).filter(Boolean))];
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const title = String(entry.title || entry.clue || "無題のページ");

  return {
    id: String(entry.id || crypto.randomUUID()),
    pageNo: parsePositiveInt(entry.pageNo) || 1,
    clue: String(entry.clue || entry.keyword || title),
    title,
    keyword: String(entry.keyword || entry.clue || "").trim(),
    url: String(entry.url || ""),
    notes: String(entry.notes || ""),
    color: /^#[0-9a-f]{6}$/i.test(String(entry.color || "")) ? entry.color : "#5ff0b1",
    status: ["open", "checked", "solved"].includes(entry.status) ? entry.status : "open",
    source: entry.source === MANUAL_SOURCE ? MANUAL_SOURCE : MANUAL_SOURCE,
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

function parsePositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
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

function readableSite(value) {
  if (!value) return "";

  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^https?:\/\//, "");
  }
}

function addTrackedSiteFromUrl(state, url) {
  const base = normalizeSiteBase(url);
  if (base && !state.trackedSites.includes(base)) {
    state.trackedSites.push(base);
  }
}

function addHiddenSiteFromUrl(state, url) {
  const base = normalizeSiteBase(url);
  if (base && !state.hiddenSites.includes(base)) {
    state.hiddenSites.push(base);
  }
}

function removeHiddenSiteFromUrl(state, url) {
  const base = normalizeSiteBase(url);
  if (!base) return;
  state.hiddenSites = state.hiddenSites.filter((site) => site !== base);
}

function isTrackedUrl(url, state) {
  const base = normalizeSiteBase(url);
  return Boolean(base && state.trackedSites.includes(base));
}

function isHiddenUrl(url, state) {
  const base = normalizeSiteBase(url);
  return Boolean(base && state.hiddenSites.includes(base));
}

async function updateBadge() {
  const store = await loadState();
  const active = store.sessions.find((session) => session.id === store.activeSessionId);
  const count = active?.entries.length || 0;
  await chrome.action.setBadgeBackgroundColor({ color: "#1f7a5a" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}
