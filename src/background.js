const STORAGE_KEY = "argScoutState";
const MENU_SELECTION_ID = "arg-scout-selection";
const BUTTON_SOURCE = "extension-button";

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
  const openPanel = tab?.windowId != null
    ? chrome.sidePanel.open({ windowId: tab.windowId })
    : Promise.resolve();
  if (tab?.windowId != null) {
    await openPanel;
  }

  await addPageFromAction(tab);
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

  if (tab?.windowId != null) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "ARG_SCOUT_ADD_CURRENT_PAGE") return;

  addPageFromAction(message.tab || sender.tab)
    .then(async (entry) => {
      await updateBadge();
      sendResponse({ ok: true, entry });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function addPageFromAction(tab) {
  if (!isSavableTab(tab)) return null;

  const state = await loadState();
  const now = new Date().toISOString();
  const existing = state.entries.find((entry) => entry.source === BUTTON_SOURCE && entry.url === tab.url);

  if (existing) {
    existing.clue = tab.title || existing.clue || "無題のページ";
    existing.title = tab.title || existing.title || "無題のページ";
    existing.updatedAt = now;
    await saveState(state);
    return existing;
  }

  const entry = {
    id: crypto.randomUUID(),
    pageNo: suggestNextButtonPageNo(state.entries),
    clue: tab.title || "無題のページ",
    title: tab.title || "無題のページ",
    url: tab.url,
    notes: "",
    color: "#5ff0b1",
    status: "open",
    source: BUTTON_SOURCE,
    createdAt: now,
    updatedAt: now
  };

  state.entries.push(entry);
  await saveState(state);
  return entry;
}

function isSavableTab(tab) {
  if (!tab?.url) return false;
  return !/^(chrome|chrome-extension|edge|about):/i.test(tab.url);
}

async function loadState() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return sanitizeState(result[STORAGE_KEY]);
}

async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function sanitizeState(raw) {
  const state = {
    version: 2,
    sessionTitle: "ARG探索メモ",
    entries: [],
    keywords: {
      primary: [],
      reserve: []
    },
    updatedAt: null
  };

  if (!raw || typeof raw !== "object") return state;

  state.version = 2;
  state.sessionTitle = typeof raw.sessionTitle === "string" && raw.sessionTitle.trim()
    ? raw.sessionTitle
    : state.sessionTitle;
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

function suggestNextButtonPageNo(entries) {
  return entries
    .filter((entry) => entry.source === BUTTON_SOURCE)
    .reduce((highest, entry) => Math.max(highest, Number(entry.pageNo) || 0), 0) + 1;
}

async function updateBadge() {
  const state = await loadState();
  const count = state.entries.filter((entry) => entry.source === BUTTON_SOURCE).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#1f7a5a" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}
