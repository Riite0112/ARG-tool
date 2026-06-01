const STORAGE_KEY = "argScoutState";
const DEFAULT_SESSION_TITLE = "ARG探索メモ";
const DEFAULT_COLORS = ["#1f7a5a", "#4c6fff", "#b45f06", "#8a3ffc", "#a8323a"];
const EXTRACT_LABELS = {
  urls: "URL",
  emails: "メールアドレス",
  numbers: "数字",
  caps: "大文字"
};

const initialState = {
  version: 1,
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

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  els.saveCurrentPage.addEventListener("click", addCurrentPageEntry);
  els.logForm.addEventListener("submit", addManualEntry);
  els.logSearch.addEventListener("input", renderLog);
  els.statusFilter.addEventListener("change", renderLog);

  els.keywordForm.addEventListener("submit", addKeywordFromForm);
  els.selectionToKeyword.addEventListener("click", () => {
    if (!pendingSelection?.text) return;
    addKeyword("primary", pendingSelection.text);
    clearPendingSelection();
    switchTab("keywords");
  });
  els.selectionToDecoder.addEventListener("click", () => {
    if (!pendingSelection?.text) return;
    els.decoderInput.value = pendingSelection.text;
    clearPendingSelection();
    renderDecoder();
    switchTab("decode");
  });
  els.clearSelection.addEventListener("click", clearPendingSelection);

  els.pullSelection.addEventListener("click", pullSelectionFromPage);
  els.decoderInput.addEventListener("input", renderDecoder);
  els.caesarShift.addEventListener("input", renderDecoder);
  els.extractPattern.addEventListener("change", renderDecoder);
  els.decodeToKeyword.addEventListener("click", () => {
    const text = els.decoderInput.value.trim();
    if (!text) return;
    addKeyword("primary", text);
    switchTab("keywords");
  });
  els.decodeToLog.addEventListener("click", () => {
    const text = els.decoderInput.value.trim();
    if (!text) return;
    addEntry({
      pageNo: suggestNextPageNo(),
      clue: trimOneLine(text),
      url: activeTab?.url || "",
      notes: "",
      status: "open"
    });
    switchTab("log");
  });

  els.exportJson.addEventListener("click", exportJson);
  els.importJson.addEventListener("change", importJson);
  els.resetData.addEventListener("click", resetData);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.pendingSelection?.newValue) return;
    pendingSelection = changes.pendingSelection.newValue;
    renderPendingSelection();
  });
}

async function loadState() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  state = sanitizeState(result[STORAGE_KEY]);
}

async function saveState() {
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  renderSummary();
}

function sanitizeState(raw) {
  const next = structuredClone(initialState);
  if (!raw || typeof raw !== "object") return next;

  next.version = 1;
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
  return {
    id: String(entry.id || crypto.randomUUID()),
    pageNo: parsePositiveInt(entry.pageNo) || suggestNextPageNo(),
    clue: String(entry.clue || ""),
    url: String(entry.url || ""),
    notes: String(entry.notes || ""),
    color: normalizeColor(entry.color) || pickColor(),
    status: ["open", "checked", "solved"].includes(entry.status) ? entry.status : "open",
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
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs.find((tab) => !tab.url?.startsWith("chrome-extension://")) || tabs[0] || null;
}

async function loadPendingSelection() {
  const result = await chrome.storage.local.get(["pendingSelection"]);
  pendingSelection = result.pendingSelection || null;
}

function renderAll() {
  els.sessionTitle.value = state.sessionTitle;
  renderActivePage();
  renderPendingSelection();
  renderLog();
  renderKeywords();
  renderDecoder();
  renderSummary();
}

function renderActivePage() {
  if (!activeTab?.url) {
    els.activePage.textContent = "現在のページなし";
    return;
  }

  const title = activeTab.title || "無題のページ";
  els.activePage.textContent = `${title} - ${activeTab.url}`;
}

function switchTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });
}

async function addCurrentPageEntry() {
  await refreshActiveTab();
  if (!activeTab?.url) return;

  addEntry({
    pageNo: suggestNextPageNo(),
    clue: activeTab.title || "無題のページ",
    url: activeTab.url,
    notes: "",
    status: "open"
  });
}

function addManualEntry(event) {
  event.preventDefault();
  const clue = els.entryClue.value.trim();
  const url = els.entryUrl.value.trim();
  const notes = els.entryNotes.value.trim();

  if (!clue && !url && !notes) return;

  addEntry({
    pageNo: parsePositiveInt(els.entryPage.value) || suggestNextPageNo(),
    clue,
    url,
    notes,
    status: els.entryStatus.value
  });

  els.logForm.reset();
  els.entryStatus.value = "open";
  els.entryPage.value = suggestNextPageNo();
}

function addEntry(input) {
  const entry = sanitizeEntry({
    id: crypto.randomUUID(),
    pageNo: input.pageNo,
    clue: input.clue,
    url: input.url,
    notes: input.notes,
    color: input.color || pickColor(),
    status: input.status || "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  state.entries.push(entry);
  saveState();
  renderLog();
}

function renderLog() {
  els.entryPage.value ||= suggestNextPageNo();
  els.logList.textContent = "";

  const query = els.logSearch.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  const entries = [...state.entries]
    .sort((a, b) => a.pageNo - b.pageNo || a.createdAt.localeCompare(b.createdAt))
    .filter((entry) => status === "all" || entry.status === status)
    .filter((entry) => {
      if (!query) return true;
      return [entry.pageNo, entry.clue, entry.url, entry.notes, entry.status]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "ログはまだありません。";
    els.logList.append(empty);
  } else {
    entries.forEach((entry) => els.logList.append(renderEntry(entry)));
  }

  renderGapWarnings();
  renderSummary();
}

function renderEntry(entry) {
  const item = document.getElementById("entryTemplate").content.firstElementChild.cloneNode(true);
  item.style.borderLeftColor = entry.color;

  const page = item.querySelector(".entry-page");
  const status = item.querySelector(".entry-status");
  const color = item.querySelector(".entry-color");
  const clue = item.querySelector(".entry-clue");
  const url = item.querySelector(".entry-url");
  const notes = item.querySelector(".entry-notes");

  page.value = entry.pageNo;
  status.value = entry.status;
  color.value = entry.color;
  clue.value = entry.clue;
  url.value = entry.url;
  notes.value = entry.notes;

  page.addEventListener("change", () => updateEntry(entry.id, { pageNo: parsePositiveInt(page.value) || entry.pageNo }));
  status.addEventListener("change", () => updateEntry(entry.id, { status: status.value }));
  color.addEventListener("input", () => updateEntry(entry.id, { color: color.value }));
  clue.addEventListener("change", () => updateEntry(entry.id, { clue: clue.value.trim() }));
  url.addEventListener("change", () => updateEntry(entry.id, { url: url.value.trim() }));
  notes.addEventListener("change", () => updateEntry(entry.id, { notes: notes.value.trim() }));

  item.querySelector(".copy-entry").addEventListener("click", () => copyEntry(entry));
  item.querySelector(".delete-entry").addEventListener("click", () => deleteEntry(entry.id));

  return item;
}

function updateEntry(id, patch) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  saveState();
  renderLog();
}

function deleteEntry(id) {
  state.entries = state.entries.filter((entry) => entry.id !== id);
  saveState();
  renderLog();
}

async function copyEntry(entry) {
  const text = [
    `#${entry.pageNo} ${entry.clue}`.trim(),
    entry.url,
    entry.notes
  ].filter(Boolean).join("\n");
  await navigator.clipboard.writeText(text);
}

function renderGapWarnings() {
  els.gapWarnings.textContent = "";
  const pages = [...new Set(state.entries.map((entry) => entry.pageNo))]
    .filter((pageNo) => Number.isInteger(pageNo) && pageNo > 0)
    .sort((a, b) => a - b);

  for (let i = 1; i < pages.length; i += 1) {
    const gap = pages[i] - pages[i - 1];
    if (gap <= 1) continue;
    const missing = range(pages[i - 1] + 1, pages[i] - 1).join(", ");
    const warning = document.createElement("div");
    warning.className = "gap-warning";
    warning.textContent = `抜けているページ番号: ${missing}`;
    els.gapWarnings.append(warning);
  }
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
  renderKeywordList("primary", els.primaryKeywords);
  renderKeywordList("reserve", els.reserveKeywords);
  renderSummary();
}

function renderKeywordList(bucket, list) {
  list.textContent = "";
  const items = state.keywords[bucket];

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = bucket === "primary" ? "主力キーワードはまだありません。" : "保留キーワードはまだありません。";
    list.append(empty);
    return;
  }

  items.forEach((keyword) => list.append(renderKeyword(keyword, bucket)));
}

function renderKeyword(keyword, bucket) {
  const item = document.getElementById("keywordTemplate").content.firstElementChild.cloneNode(true);
  item.querySelector(".keyword-text").textContent = keyword.text;
  item.querySelector(".use-keyword").addEventListener("click", () => {
    addEntry({
      pageNo: suggestNextPageNo(),
      clue: keyword.text,
      url: activeTab?.url || "",
      notes: "",
      status: "open"
    });
    deleteKeyword(bucket, keyword.id);
    switchTab("log");
  });
  item.querySelector(".move-keyword").addEventListener("click", () => moveKeyword(bucket, keyword.id));
  item.querySelector(".delete-keyword").addEventListener("click", () => deleteKeyword(bucket, keyword.id));
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

  els.selectionPreview.textContent = trimText(pendingSelection.text, 220);
  els.selectionBanner.classList.remove("hidden");
}

async function clearPendingSelection() {
  pendingSelection = null;
  await chrome.storage.local.remove("pendingSelection");
  renderPendingSelection();
}

async function pullSelectionFromPage() {
  await refreshActiveTab();
  if (!activeTab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "ARG_SCOUT_GET_SELECTION" });
    if (response?.text) {
      els.decoderInput.value = response.text;
      renderDecoder();
    }
  } catch {
    // 一部のブラウザ内部ページではコンテンツスクリプトを呼び出せない。
  }
}

function renderDecoder() {
  const input = els.decoderInput.value;
  els.decoderResults.textContent = "";

  if (!input.trim()) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "ここにデコード結果が表示されます。";
    els.decoderResults.append(empty);
    return;
  }

  const rows = buildDecoderRows(input);
  rows.forEach(([label, value]) => {
    const row = document.createElement("section");
    row.className = "result-row";

    const title = document.createElement("div");
    title.className = "result-label";
    title.textContent = label;

    const output = document.createElement("pre");
    output.className = "result-value";
    output.textContent = value || "(結果なし)";

    row.append(title, output);
    els.decoderResults.append(row);
  });
}

function buildDecoderRows(input) {
  const trimmed = input.trim();
  const shift = clamp(Number(els.caesarShift.value) || 0, -25, 25);

  return [
    ["文字数情報", textStats(input)],
    ["逆順", [...input].reverse().join("")],
    [`シーザー ${shift}`, caesar(input, shift)],
    ["ROT13", caesar(input, 13)],
    ["Atbash", atbash(input)],
    ["Base64デコード", safeBase64Decode(trimmed)],
    ["Base64エンコード", btoaUtf8(input)],
    ["URLデコード", safeDecodeURIComponent(trimmed)],
    ["URLエンコード", encodeURIComponent(input)],
    ["モールスデコード", morseDecode(trimmed)],
    ["モールスエンコード", morseEncode(input)],
    ["バイナリから文字列", binaryToText(trimmed)],
    ["16進数から文字列", hexToText(trimmed)],
    [`抽出: ${EXTRACT_LABELS[els.extractPattern.value] || "URL"}`, extractPattern(input, els.extractPattern.value)]
  ];
}

function textStats(input) {
  const chars = [...input];
  const words = input.trim() ? input.trim().split(/\s+/).length : 0;
  const unique = new Set(chars).size;
  return `文字数: ${chars.length}, 単語数: ${words}, 文字種: ${unique}`;
}

function caesar(input, shift) {
  return input.replace(/[a-z]/gi, (char) => {
    const base = char >= "a" && char <= "z" ? 97 : 65;
    return String.fromCharCode(((char.charCodeAt(0) - base + shift + 26) % 26) + base);
  });
}

function atbash(input) {
  return input.replace(/[a-z]/gi, (char) => {
    const isLower = char >= "a" && char <= "z";
    const base = isLower ? 97 : 65;
    return String.fromCharCode(base + (25 - (char.charCodeAt(0) - base)));
  });
}

function safeBase64Decode(input) {
  try {
    return atobUtf8(input);
  } catch {
    return "";
  }
}

function btoaUtf8(input) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(input)));
}

function atobUtf8(input) {
  const bytes = Uint8Array.from(atob(input), (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function safeDecodeURIComponent(input) {
  try {
    return decodeURIComponent(input);
  } catch {
    return "";
  }
}

const MORSE = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.", h: "....",
  i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.", o: "---", p: ".--.",
  q: "--.-", r: ".-.", s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-",
  y: "-.--", z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-",
  5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----."
};

const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([key, value]) => [value, key]));

function morseEncode(input) {
  return input
    .toLowerCase()
    .split("")
    .map((char) => char === " " ? "/" : MORSE[char] || "")
    .filter(Boolean)
    .join(" ");
}

function morseDecode(input) {
  if (!/^[.\-/\s]+$/.test(input)) return "";
  return input
    .split(/\s+/)
    .map((token) => token === "/" ? " " : MORSE_REVERSE[token] || "")
    .join("");
}

function binaryToText(input) {
  const tokens = input.match(/[01]{8}/g);
  if (!tokens) return "";
  return tokens.map((token) => String.fromCharCode(parseInt(token, 2))).join("");
}

function hexToText(input) {
  const normalized = input.replace(/(?:0x|\\x|\s|,|-)/gi, "");
  if (!normalized || normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) return "";
  const chars = normalized.match(/.{2}/g).map((pair) => String.fromCharCode(parseInt(pair, 16)));
  return chars.join("");
}

function extractPattern(input, pattern) {
  const patterns = {
    urls: /https?:\/\/[^\s"'<>]+/gi,
    emails: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    numbers: /[-+]?\d*\.?\d+/g,
    caps: /[A-Z]/g
  };
  const matches = input.match(patterns[pattern] || patterns.urls);
  return matches ? matches.join("\n") : "";
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
  await saveState();
  renderAll();
}

function renderSummary() {
  const pages = new Set(state.entries.map((entry) => entry.pageNo)).size;
  const open = state.entries.filter((entry) => entry.status === "open").length;
  const checked = state.entries.filter((entry) => entry.status === "checked").length;
  const solved = state.entries.filter((entry) => entry.status === "solved").length;
  const keywords = state.keywords.primary.length + state.keywords.reserve.length;
  const updated = state.updatedAt ? new Date(state.updatedAt).toLocaleString("ja-JP") : "未保存";

  els.summary.innerHTML = "";
  [
    `調査名: ${state.sessionTitle}`,
    `ログ: ${state.entries.length}件 / ページ番号 ${pages}個`,
    `状態: 未確認 ${open}件、確認済み ${checked}件、解決済み ${solved}件`,
    `キーワード: ${keywords}件`,
    `最終更新: ${updated}`
  ].forEach((line) => {
    const item = document.createElement("div");
    item.textContent = line;
    els.summary.append(item);
  });
}

function suggestNextPageNo() {
  const max = state.entries.reduce((highest, entry) => Math.max(highest, parsePositiveInt(entry.pageNo) || 0), 0);
  return max + 1;
}

function parsePositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function pickColor() {
  return DEFAULT_COLORS[state.entries.length % DEFAULT_COLORS.length];
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : null;
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function trimText(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function trimOneLine(text) {
  return trimText(text.replace(/\s+/g, " ").trim(), 160);
}

function filenameSafe(text) {
  return text
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "") || "arg-tansaku";
}
