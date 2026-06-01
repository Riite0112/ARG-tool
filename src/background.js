const STORAGE_KEY = "argScoutState";
const MENU_SELECTION_ID = "arg-scout-selection";
const MANUAL_SOURCE = "manual-entry";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: "選択したテキストをARG探索ツールへ送る",
    contexts: ["selection"]
  });
  await updateBadge();
});

chrome.runtime.onStartup?.addListener(updateBadge);

chrome.action.onClicked.addListener(async (tab) => {
  await showLayout(tab);
  await updateBadge();
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

  await showLayout(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ARG_SCOUT_REFRESH_BADGE") {
    updateBadge()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ARG_SCOUT_SHOW_LAYOUT") {
    showLayout(message.tab || sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function showLayout(tab) {
  if (!isSavableTab(tab) || tab.id == null) return;

  const message = { type: "ARG_SCOUT_SHOW_LAYOUT" };

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    try {
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

function isSavableTab(tab) {
  if (!tab?.url) return false;
  return !/^(chrome|chrome-extension|edge|about):/i.test(tab.url);
}

async function loadState() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return sanitizeState(result[STORAGE_KEY]);
}

function sanitizeState(raw) {
  const state = {
    version: 3,
    sessionTitle: "ARG探索メモ",
    targetPages: 0,
    entries: [],
    keywords: {
      primary: [],
      reserve: []
    },
    updatedAt: null
  };

  if (!raw || typeof raw !== "object") return state;

  state.version = 3;
  state.sessionTitle = typeof raw.sessionTitle === "string" && raw.sessionTitle.trim()
    ? raw.sessionTitle
    : state.sessionTitle;
  state.targetPages = parsePositiveInt(raw.targetPages) || 0;
  state.entries = Array.isArray(raw.entries) ? raw.entries.map(sanitizeEntry).filter(Boolean) : [];
  state.keywords.primary = sanitizeKeywordArray(raw.keywords?.primary);
  state.keywords.reserve = sanitizeKeywordArray(raw.keywords?.reserve);
  state.updatedAt = raw.updatedAt || null;
  return state;
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

async function updateBadge() {
  const state = await loadState();
  const count = state.entries.length;
  await chrome.action.setBadgeBackgroundColor({ color: "#1f7a5a" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}
