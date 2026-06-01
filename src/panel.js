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
let activeTab = null;
let selectedPageId = null;
let pendingSelection = null;

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  await loadState();
  await refreshActiveTab();
  await loadPendingSelection();
  renderAll();
});

function bindElements() {
  for (const el of document.querySelectorAll("[id]")) {
    els[el.id] = el;
  }
}

function bindEvents() {
  els.sessionTitle.addEventListener("input", () => {
    state.sessionTitle = els.sessionTitle.value.trim() || DEFAULT_SESSION_TITLE;
    saveState();
  });

  els.addCurrentPage.addEventListener("click", addCurrentPageFromPanel);
  els.deleteSelectedPage.addEventListener("click", deleteSelectedPage);
  els.detailNotes.addEventListener("change", () => {
    if (!selectedPageId) return;
    updateEntry(selectedPageId, { notes: els.detailNotes.value.trim() });
  });

  els.keywordForm.addEventListener("submit", addKeywordFromForm);
  els.selectionToKeyword.addEventListener("click", () => {
    if (!pendingSelection?.text) return;
    addKeyword(els.keywordTarget.value, pendingSelection.text);
    clearPendingSelection();
  });
  els.clearSelection.addEventListener("click", clearPendingSelection);

  els.exportJson.addEventListener("click", exportJson);
  els.importJson.addEventListener("change", importJson);
  els.resetData.addEventListener("click", resetData);

  if (!canUseExtensionApi) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes[STORAGE_KEY]?.newValue) {
      state = sanitizeState(changes[STORAGE_KEY].newValue);
      renderAll();
    }

    if (changes.pendingSelection) {
      pendingSelection = changes.pendingSelection.newValue || null;
      renderPendingSelection();
    }
  });
}

async function loadState() {
  if (!canUseExtensionApi) {
    const stored = localStorage.getItem(STORAGE_KEY);
    state = sanitizeState(stored ? JSON.parse(stored) : null);
    return;
  }

  const result = await chrome.storage.local.get([STORAGE_KEY]);
  state = sanitizeState(result[STORAGE_KEY]);
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
    : next.sessionTitle;
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
    pageNo: parsePositiveInt(entry.pageNo) || 1,
    clue: String(entry.clue || title),
    title,
    url: String(entry.url || ""),
    notes: String(entry.notes || ""),
    color: normalizeColor(entry.color) || "#5ff0b1",
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

async function refreshActiveTab() {
  if (!canUseExtensionApi) {
    activeTab = {
      title: document.title || "プレビュー",
      url: location.href
    };
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs.find((tab) => !tab.url?.startsWith("chrome-extension://")) || tabs[0] || null;
}

async function loadPendingSelection() {
  if (!canUseExtensionApi) return;

  const result = await chrome.storage.local.get(["pendingSelection"]);
  pendingSelection = result.pendingSelection || null;
}

function renderAll() {
  els.sessionTitle.value = state.sessionTitle;
  renderActivePage();
  renderPages();
  renderKeywords();
  renderPendingSelection();
}

function renderActivePage() {
  if (!activeTab?.url || isBlockedUrl(activeTab.url)) {
    els.activePage.textContent = "拡張ボタンで現在ページを追加";
    return;
  }
  els.activePage.textContent = activeTab.title ? `${activeTab.title} - ${activeTab.url}` : activeTab.url;
}

function buttonPages() {
  return state.entries
    .filter((entry) => entry.source === BUTTON_SOURCE)
    .sort((a, b) => a.pageNo - b.pageNo || a.createdAt.localeCompare(b.createdAt));
}

function renderPages() {
  const pages = buttonPages();
  els.pageCount.textContent = String(pages.length);
  els.pageList.textContent = "";

  if (!selectedPageId || !pages.some((page) => page.id === selectedPageId)) {
    selectedPageId = pages[0]?.id || null;
  }

  if (!pages.length) {
    const empty = document.createElement("li");
    empty.className = "empty-list";
    empty.textContent = "まだ追加ページがありません。";
    els.pageList.append(empty);
    renderPageDetail(null);
    return;
  }

  pages.forEach((page) => {
    els.pageList.append(renderPageItem(page));
  });
  renderPageDetail(pages.find((page) => page.id === selectedPageId) || null);
}

function renderPageItem(page) {
  const item = document.getElementById("pageItemTemplate").content.firstElementChild.cloneNode(true);
  const button = item.querySelector(".page-select");
  const title = page.title || page.clue || "無題のページ";

  button.classList.toggle("active", page.id === selectedPageId);
  item.querySelector(".page-no").textContent = String(page.pageNo).padStart(2, "0");
  item.querySelector(".page-title").textContent = title;
  item.querySelector(".page-url").textContent = page.url;
  button.addEventListener("click", () => {
    selectedPageId = page.id;
    renderPages();
  });

  return item;
}

function renderPageDetail(page) {
  els.emptyDetail.classList.toggle("hidden", Boolean(page));
  els.pageDetail.classList.toggle("hidden", !page);
  if (!page) return;

  const title = page.title || page.clue || "無題のページ";
  els.detailNumber.textContent = `#${String(page.pageNo).padStart(2, "0")}`;
  els.detailTitle.textContent = title;
  els.detailUrl.textContent = page.url;
  els.detailUrl.href = page.url;
  els.detailNotes.value = page.notes || "";
}

async function addCurrentPageFromPanel() {
  await refreshActiveTab();
  if (!activeTab?.url || isBlockedUrl(activeTab.url)) return;

  const now = new Date().toISOString();
  const existing = state.entries.find((entry) => entry.source === BUTTON_SOURCE && entry.url === activeTab.url);

  if (existing) {
    existing.title = activeTab.title || existing.title || "無題のページ";
    existing.clue = existing.title;
    existing.updatedAt = now;
    selectedPageId = existing.id;
  } else {
    const entry = {
      id: crypto.randomUUID(),
      pageNo: suggestNextButtonPageNo(),
      clue: activeTab.title || "無題のページ",
      title: activeTab.title || "無題のページ",
      url: activeTab.url,
      notes: "",
      color: "#5ff0b1",
      status: "open",
      source: BUTTON_SOURCE,
      createdAt: now,
      updatedAt: now
    };
    state.entries.push(entry);
    selectedPageId = entry.id;
  }

  await saveState();
  renderAll();
}

function updateEntry(id, patch) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  saveState();
  renderPages();
}

async function deleteSelectedPage() {
  if (!selectedPageId) return;
  state.entries = state.entries.filter((entry) => entry.id !== selectedPageId);
  selectedPageId = null;
  renumberButtonPages();
  await saveState();
  renderPages();
}

function addKeywordFromForm(event) {
  event.preventDefault();
  const text = els.keywordInput.value.trim();
  if (!text) return;
  addKeyword(els.keywordTarget.value, text);
  els.keywordInput.value = "";
}

function addKeyword(bucket, text) {
  const target = bucket === "reserve" ? "reserve" : "primary";
  const normalized = text.trim();
  if (!normalized) return;

  state.keywords[target].push({
    id: crypto.randomUUID(),
    text: normalized,
    createdAt: new Date().toISOString()
  });

  saveState();
  renderKeywords();
}

function renderKeywords() {
  els.keywordList.textContent = "";
  const keywords = [
    ...state.keywords.primary.map((keyword) => ({ ...keyword, bucket: "primary" })),
    ...state.keywords.reserve.map((keyword) => ({ ...keyword, bucket: "reserve" }))
  ];

  els.keywordCount.textContent = String(keywords.length);

  if (!keywords.length) {
    const empty = document.createElement("li");
    empty.className = "empty-list";
    empty.textContent = "キーワードはまだ保存されていません。";
    els.keywordList.append(empty);
    return;
  }

  keywords.forEach((keyword) => els.keywordList.append(renderKeyword(keyword)));
}

function renderKeyword(keyword) {
  const item = document.getElementById("keywordTemplate").content.firstElementChild.cloneNode(true);
  item.querySelector(".keyword-bucket").textContent = keyword.bucket === "primary" ? "主力" : "保留";
  item.querySelector(".keyword-text").textContent = keyword.text;
  item.querySelector(".move-keyword").addEventListener("click", () => moveKeyword(keyword.bucket, keyword.id));
  item.querySelector(".delete-keyword").addEventListener("click", () => deleteKeyword(keyword.bucket, keyword.id));
  return item;
}

function moveKeyword(bucket, id) {
  const from = bucket === "primary" ? "primary" : "reserve";
  const to = from === "primary" ? "reserve" : "primary";
  const keyword = state.keywords[from].find((item) => item.id === id);
  if (!keyword) return;

  state.keywords[from] = state.keywords[from].filter((item) => item.id !== id);
  state.keywords[to].push(keyword);
  saveState();
  renderKeywords();
}

function deleteKeyword(bucket, id) {
  const target = bucket === "primary" ? "primary" : "reserve";
  state.keywords[target] = state.keywords[target].filter((item) => item.id !== id);
  saveState();
  renderKeywords();
}

function renderPendingSelection() {
  if (!pendingSelection?.text) {
    els.selectionBanner.classList.add("hidden");
    return;
  }

  els.selectionPreview.textContent = trimText(pendingSelection.text, 180);
  els.selectionBanner.classList.remove("hidden");
}

async function clearPendingSelection() {
  pendingSelection = null;
  if (canUseExtensionApi) {
    await chrome.storage.local.remove("pendingSelection");
  }
  renderPendingSelection();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${filenameSafe(state.sessionTitle)}-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importJson(event) {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const raw = await file.text();
    state = sanitizeState(JSON.parse(raw));
    selectedPageId = null;
    await saveState();
    renderAll();
  } catch (error) {
    alert(`読み込みに失敗しました: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

async function resetData() {
  if (!confirm("すべてのARG探索データをリセットしますか？")) return;
  state = structuredClone(initialState);
  selectedPageId = null;
  await saveState();
  renderAll();
}

function suggestNextButtonPageNo() {
  return buttonPages().reduce((highest, entry) => Math.max(highest, Number(entry.pageNo) || 0), 0) + 1;
}

function renumberButtonPages() {
  buttonPages().forEach((entry, index) => {
    entry.pageNo = index + 1;
  });
}

function parsePositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : null;
}

function isBlockedUrl(url) {
  return /^(chrome|chrome-extension|edge|about):/i.test(url);
}

function trimText(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function filenameSafe(text) {
  return text
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "") || "arg-tansaku";
}
