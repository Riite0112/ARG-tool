const viewLabels = {
  all: "左パネルと下バーを表示しました。",
  pages: "左側にページ一覧を表示しました。",
  keywords: "下側にキーワードバーを表示しました。"
};

const themeLabels = {
  emerald: "緑",
  aqua: "青",
  violet: "紫",
  slate: "灰"
};

const DEFAULT_THEME = "emerald";
const THEMES = new Set(Object.keys(themeLabels));
const FEEDBACK_FORM_URL = String(globalThis.ARG_SCOUT_CONFIG?.feedbackFormUrl || "").trim();
const SUPPORT_URL = String(globalThis.ARG_SCOUT_CONFIG?.supportUrl || "").trim();
const els = {};
const encodingMaps = new Map();
const mojibakeGarbledEncodings = [
  { key: "utf-8", name: "UTF-8" },
  { key: "shift_jis", name: "Shift_JIS" },
  { key: "euc-jp", name: "EUC-JP" },
  { key: "windows-1252", name: "Windows-1252" },
  { key: "latin1", name: "Latin-1" }
];
const mojibakeOriginalEncodings = [
  { key: "utf-8", name: "UTF-8", decode: "utf-8" },
  { key: "shift_jis", name: "Shift_JIS", decode: "shift_jis" },
  { key: "euc-jp", name: "EUC-JP", decode: "euc-jp" },
  { key: "iso-2022-jp", name: "ISO-2022-JP", decode: "iso-2022-jp" }
];
const MAX_MOJIBAKE_CANDIDATES = 16;
const MAX_MOJIBAKE_CHAIN_CANDIDATES = 8;
let selectedPanels = new Set();
let timerState = {
  elapsedMs: 0,
  running: false,
  started: false
};
let popupSavable = true;
let autoStashCopy = false;
let timerTicker = 0;

document.addEventListener("DOMContentLoaded", () => {
  for (const node of document.querySelectorAll("[id]")) {
    els[node.id] = node;
  }

  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.addEventListener("click", () => togglePanel(button.dataset.panel));
  });

  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.theme));
  });

  document.querySelectorAll("[data-utility]").forEach((button) => {
    button.addEventListener("click", () => toggleUtility(button.dataset.utility));
  });

  els.feedbackButton.addEventListener("click", showFeedbackPlaceholder);
  els.supportPendingButton.addEventListener("click", showSupportPendingPlaceholder);
  els.hideButton.addEventListener("click", hideTool);
  els.hideToolButton.addEventListener("click", hideTool);
  els.timerToggleButton.addEventListener("click", toggleTimer);
  els.timerResetButton.addEventListener("click", resetTimer);
  els.autoCopyButton.addEventListener("click", toggleAutoStashCopy);
  els.mojibakePasteButton.addEventListener("click", pasteMojibakeText);
  els.mojibakeFixButton.addEventListener("click", restoreMojibakeInput);
  els.mojibakeClearButton.addEventListener("click", clearMojibakeTool);
  els.qrFileInput.addEventListener("change", readQrFile);
  els.qrClipboardButton.addEventListener("click", readQrClipboard);
  els.qrClearButton.addEventListener("click", clearQrTool);
  loadPopupState();
});

async function loadPopupState() {
  setStatus("読み込み中です。");
  try {
    const response = await chrome.runtime.sendMessage({ type: "ARG_SCOUT_GET_POPUP_STATE" });
    if (!response?.ok) throw new Error(response?.error || "状態を取得できませんでした。");
    renderState(response);
    setActiveView(response.visible ? response.view : "");
    setStatus(response.savable ? "ページとキーワードを個別に選択できます。" : "このページでは使用できません。", !response.savable);
  } catch (error) {
    setStatus(error.message || "状態を取得できませんでした。", true);
    setDisabled(true);
  }
}

async function togglePanel(panel) {
  const nextPanels = new Set(selectedPanels);
  if (nextPanels.has(panel)) {
    nextPanels.delete(panel);
  } else {
    nextPanels.add(panel);
  }

  if (!nextPanels.size) {
    await hideTool();
    return;
  }

  await openView(viewFromPanels(nextPanels));
}

async function openView(view) {
  setBusy(true);
  setActiveView(view);
  setStatus("表示を切り替えています。");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "ARG_SCOUT_OPEN_TOOL_VIEW",
      view
    });
    if (!response?.ok) throw new Error(response?.error || "表示できませんでした。");
    renderState(response);
    setStatus(viewLabels[view] || viewLabels.all, false, true);
  } catch (error) {
    setStatus(error.message || "表示できませんでした。", true);
  } finally {
    setBusy(false);
  }
}

function showFeedbackPlaceholder() {
  if (!FEEDBACK_FORM_URL) {
    setStatus("フィードバックフォームは準備中です。src/config.js にGoogleフォームURLを入れると開けるようになります。", false, true);
    return;
  }

  try {
    const url = new URL(FEEDBACK_FORM_URL);
    if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid feedback URL");
    chrome.tabs.create({ url: url.href });
    setStatus("フィードバックフォームを開きました。", false, true);
  } catch {
    setStatus("フィードバックフォームURLの形式を確認してください。", true);
  }
}

function showSupportPendingPlaceholder() {
  if (!SUPPORT_URL) {
    setStatus("応援リンクは準備中です。src/config.js にURLを入れると開けるようになります。", false, true);
    return;
  }

  try {
    const url = new URL(SUPPORT_URL);
    if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid support URL");
    chrome.tabs.create({ url: url.href });
    setStatus("応援ページを開きました。", false, true);
  } catch {
    setStatus("応援リンクの形式を確認してください。", true);
  }
}

async function hideTool() {
  setBusy(true);
  setStatus("非表示にしています。");

  try {
    const response = await chrome.runtime.sendMessage({ type: "ARG_SCOUT_HIDE_TOOL" });
    if (!response?.ok) throw new Error(response?.error || "非表示にできませんでした。");
    renderState(response);
    setActiveView("");
    setStatus("このサイトでは自動表示を止めました。", false, true);
  } catch (error) {
    setStatus(error.message || "非表示にできませんでした。", true);
  } finally {
    setBusy(false);
  }
}

function renderState(state) {
  popupSavable = Boolean(state.savable);
  els.siteLabel.textContent = state.site || state.url || "現在のページ";
  els.sessionTitle.textContent = state.sessionTitle || "ARG探索メモ";
  els.pageCount.textContent = String(state.pageCount || 0);
  els.keywordCount.textContent = String(state.keywordCount || 0);
  els.targetPages.textContent = state.targetPages ? String(state.targetPages) : "-";
  els.trackedState.textContent = state.hidden ? "非表示" : state.tracked ? "表示中" : "未登録";
  els.trackedState.classList.toggle("hidden", Boolean(state.hidden));
  renderThemeState(state.theme || DEFAULT_THEME);
  renderAutoStashCopyState(Boolean(state.autoStashCopy));
  renderTimerState(state);
  setDisabled(!state.savable);
}

function renderTimerState(state) {
  timerState = {
    elapsedMs: Number.isFinite(Number(state.timerElapsedMs)) ? Number(state.timerElapsedMs) : 0,
    running: Boolean(state.timerRunning),
    started: Boolean(state.timerStarted)
  };
  renderTimer();
  syncTimerTicker();
}

function renderTimer() {
  els.timerDisplay.textContent = formatElapsedMs(timerState.elapsedMs);
  els.timerToggleButton.textContent = timerState.running ? "Pause" : "Start";
  els.timerToggleButton.classList.toggle("running", timerState.running);
  els.timerResetButton.disabled = !timerState.started;
}

async function toggleTimer() {
  setBusy(true);
  setStatus(timerState.running ? "タイマーを一時停止しています。" : "タイマーを開始しています。");

  try {
    const response = await chrome.runtime.sendMessage({ type: "ARG_SCOUT_TOGGLE_TIMER" });
    if (!response?.ok) throw new Error(response?.error || "タイマーを操作できませんでした。");
    renderState(response);
    setActiveView(response.visible ? response.view : "");
    setStatus(response.timerRunning ? "タイマーを開始しました。" : "タイマーを一時停止しました。", false, true);
  } catch (error) {
    setStatus(error.message || "タイマーを操作できませんでした。", true);
  } finally {
    setBusy(false);
  }
}

async function setTheme(theme) {
  const normalized = normalizeTheme(theme);
  renderThemeState(normalized);
  setBusy(true);
  setStatus("テーマを切り替えています。");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "ARG_SCOUT_SET_THEME",
      theme: normalized
    });
    if (!response?.ok) throw new Error(response?.error || "テーマを変更できませんでした。");
    renderState(response);
    setActiveView(response.visible ? response.view : "");
    setStatus(`テーマを${themeLabels[normalized]}にしました。`, false, true);
  } catch (error) {
    setStatus(error.message || "テーマを変更できませんでした。", true);
  } finally {
    setBusy(false);
  }
}

async function toggleAutoStashCopy() {
  const previous = autoStashCopy;
  const next = !previous;
  renderAutoStashCopyState(next);
  setBusy(true);
  setStatus(next ? "コピー自動保存をONにしています。" : "コピー自動保存をOFFにしています。");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "ARG_SCOUT_SET_AUTO_STASH_COPY",
      enabled: next
    });
    if (!response?.ok) throw new Error(response?.error || "コピー自動保存を変更できませんでした。");
    renderState(response);
    setActiveView(response.visible ? response.view : "");
    setStatus(
      response.autoStashCopy
        ? "コピーした文字を一時保存します。"
        : "コピー自動保存をOFFにしました。",
      false,
      true
    );
  } catch (error) {
    renderAutoStashCopyState(previous);
    setStatus(error.message || "コピー自動保存を変更できませんでした。", true);
  } finally {
    setBusy(false);
  }
}

async function resetTimer() {
  if (!timerState.started) return;
  if (!confirm("タイマーをリセットしますか？\n保存済みページに記録された時間は残ります。")) return;

  setBusy(true);
  setStatus("タイマーをリセットしています。");

  try {
    const response = await chrome.runtime.sendMessage({ type: "ARG_SCOUT_RESET_TIMER" });
    if (!response?.ok) throw new Error(response?.error || "タイマーをリセットできませんでした。");
    renderState(response);
    setActiveView(response.visible ? response.view : "");
    setStatus("タイマーをリセットしました。", false, true);
  } catch (error) {
    setStatus(error.message || "タイマーをリセットできませんでした。", true);
  } finally {
    setBusy(false);
  }
}

function setDisabled(disabled) {
  document.querySelectorAll("[data-panel], [data-theme], #hideButton, #hideToolButton, #timerToggleButton, #timerResetButton, #autoCopyButton").forEach((button) => {
    button.disabled = Boolean(disabled);
  });
  if (!disabled) {
    els.timerResetButton.disabled = !timerState.started;
  }
}

function setBusy(busy) {
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = Boolean(busy);
  });
  if (!busy) {
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
    });
    setDisabled(!popupSavable);
  }
}

function setActiveView(view) {
  selectedPanels = panelsFromView(view);
  document.querySelectorAll("[data-panel]").forEach((button) => {
    const active = selectedPanels.has(button.dataset.panel);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderThemeState(theme) {
  const normalized = normalizeTheme(theme);
  document.body.dataset.theme = normalized;
  document.querySelectorAll("[data-theme]").forEach((button) => {
    const active = button.dataset.theme === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderAutoStashCopyState(enabled) {
  autoStashCopy = Boolean(enabled);
  els.autoCopyButton.textContent = autoStashCopy ? "ON" : "OFF";
  els.autoCopyButton.classList.toggle("active", autoStashCopy);
  els.autoCopyButton.setAttribute("aria-pressed", String(autoStashCopy));
}

function toggleUtility(utility) {
  const panel = utility === "qr" ? els.qrTool : els.mojibakeTool;
  const shouldOpen = panel.hidden;

  document.querySelectorAll(".utility-panel").forEach((node) => {
    node.hidden = true;
  });
  document.querySelectorAll("[data-utility]").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });

  if (!shouldOpen) return;

  panel.hidden = false;
  const active = document.querySelector(`[data-utility="${utility}"]`);
  active?.classList.add("active");
  active?.setAttribute("aria-pressed", "true");
}

function panelsFromView(view) {
  if (view === "all") return new Set(["pages", "keywords"]);
  if (view === "pages") return new Set(["pages"]);
  if (view === "keywords") return new Set(["keywords"]);
  return new Set();
}

function viewFromPanels(panels) {
  const hasPages = panels.has("pages");
  const hasKeywords = panels.has("keywords");
  if (hasPages && hasKeywords) return "all";
  if (hasPages) return "pages";
  if (hasKeywords) return "keywords";
  return "";
}

function setStatus(text, isError = false, isOk = false) {
  els.statusText.textContent = text;
  els.statusText.classList.toggle("error", Boolean(isError));
  els.statusText.classList.toggle("ok", Boolean(isOk) && !isError);
}

function normalizeTheme(value) {
  const normalized = String(value || DEFAULT_THEME);
  return THEMES.has(normalized) ? normalized : DEFAULT_THEME;
}

async function pasteMojibakeText() {
  try {
    const text = await navigator.clipboard.readText();
    els.mojibakeInput.value = text;
    restoreMojibakeInput();
  } catch {
    setStatus("クリップボードの文字を読めませんでした。", true);
  }
}

function restoreMojibakeInput() {
  const text = els.mojibakeInput.value.trim();
  els.mojibakeResults.textContent = "";

  if (!text) {
    renderResultMessage(els.mojibakeResults, "復元したい文字を入力してください。");
    return;
  }

  const candidates = restoreMojibake(text);
  if (!candidates.length) {
    renderResultMessage(els.mojibakeResults, "復元候補は見つかりませんでした。");
    return;
  }

  candidates.forEach((candidate) => {
    renderCopyResult(els.mojibakeResults, candidate.label, candidate.value);
  });
  setStatus("文字化け復元候補を表示しました。", false, true);
}

function clearMojibakeTool() {
  els.mojibakeInput.value = "";
  els.mojibakeResults.textContent = "";
}

function restoreMojibake(text) {
  const candidates = [];
  const original = text.trim();

  collectStructuredDecodeCandidates(candidates, original, original);
  collectEncodingRepairCandidates(candidates, original, original);

  const firstPass = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MOJIBAKE_CHAIN_CANDIDATES);

  firstPass.forEach((candidate) => {
    const prefix = `二重復元: ${candidate.label} / `;
    collectStructuredDecodeCandidates(candidates, original, candidate.value, prefix);
    collectEncodingRepairCandidates(candidates, original, candidate.value, prefix);
  });

  return candidates
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "ja"))
    .slice(0, MAX_MOJIBAKE_CANDIDATES)
    .map(({ label, value }) => ({ label, value }));
}

function collectEncodingRepairCandidates(candidates, original, source, prefix = "") {
  mojibakeGarbledEncodings.forEach((garbledEncoding) => {
    mojibakeOriginalEncodings.forEach((originalEncoding) => {
      if (garbledEncoding.key === originalEncoding.key) return;
      addCandidate(
        candidates,
        original,
        `${prefix}${originalEncoding.name} → ${garbledEncoding.name}誤読`,
        () => decodeBytes(encodeByLabel(source, garbledEncoding.key), originalEncoding.decode)
      );
    });
  });
}

function collectStructuredDecodeCandidates(candidates, original, source, prefix = "") {
  collectUrlDecodeCandidates(candidates, original, source, prefix);

  addCandidate(candidates, original, `${prefix}HTMLエンティティ解除`, () => {
    if (!/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.test(source)) return "";
    const textarea = document.createElement("textarea");
    textarea.innerHTML = source;
    return textarea.value;
  }, { always: true });

  addCandidate(candidates, original, `${prefix}Unicodeエスケープ解除`, () => {
    if (!/(?:\\u\{?[0-9a-f]{4,6}\}?|\\x[0-9a-f]{2}|%u[0-9a-f]{4})/i.test(source)) return "";
    return decodeUnicodeEscapes(source);
  }, { allowPlain: true });

  collectByteTextCandidates(candidates, original, source, prefix, "Base64", decodeBase64Bytes(source));
  collectByteTextCandidates(candidates, original, source, prefix, "16進", decodeHexBytes(source));
}

function collectUrlDecodeCandidates(candidates, original, source, prefix) {
  if (!/%(?:[0-9a-f]{2}|u[0-9a-f]{4})/i.test(source)) return;

  let current = source;
  for (let round = 1; round <= 3; round += 1) {
    let decoded = "";
    try {
      decoded = decodeURIComponent(current.replace(/\+/g, "%20"));
    } catch {
      decoded = "";
    }
    if (!decoded || decoded === current) break;
    addCandidate(
      candidates,
      original,
      `${prefix}${round === 1 ? "URLデコード" : `URLデコード x${round}`}`,
      () => decoded,
      { allowPlain: true }
    );
    current = decoded;
  }

  addCandidate(candidates, original, `${prefix}%u Unicode解除`, () => {
    if (!/%u[0-9a-f]{4}/i.test(source)) return "";
    return decodeUnicodeEscapes(source);
  }, { allowPlain: true });
}

function collectByteTextCandidates(candidates, original, source, prefix, sourceLabel, bytes) {
  if (!bytes?.length) return;
  mojibakeOriginalEncodings.forEach((encoding) => {
    addCandidate(
      candidates,
      original,
      `${prefix}${sourceLabel} ${encoding.name}`,
      () => decodeBytes(bytes, encoding.decode),
      { allowPlain: true }
    );
  });
}

function addCandidate(candidates, original, label, factory, options = {}) {
  try {
    const value = normalizeDecodedText(factory());
    if (!value || value === original || value.includes("\uFFFD")) return;
    if (hasInvalidControlCharacters(value)) return;
    if (candidates.some((candidate) => candidate.value === value)) return;
    const score = mojibakeScore(value, original);
    if (!options.always && score < 2 && !(options.allowPlain && isMostlyPrintableText(value))) return;
    candidates.push({ label, value, score });
  } catch {
    // Unsupported encodings or invalid byte sequences are just skipped.
  }
}

function decodeBytes(bytes, label) {
  if (!bytes?.length) return "";
  return new TextDecoder(label, { fatal: true }).decode(bytes);
}

function encodeByLabel(text, label) {
  if (label === "utf-8") return new TextEncoder().encode(text);
  if (label === "latin1") return encodeLatin1(text);
  return encodeByMap(text, label);
}

function encodeByMap(text, label) {
  const map = getEncodingMap(label);
  const bytes = [];

  for (const char of text) {
    const encoded = map.get(char);
    if (!encoded) return null;
    bytes.push(...encoded);
  }

  return new Uint8Array(bytes);
}

function getEncodingMap(label) {
  if (encodingMaps.has(label)) return encodingMaps.get(label);

  let map = null;
  if (label === "shift_jis") {
    map = buildShiftJisEncodeMap();
  } else if (label === "euc-jp") {
    map = buildEucJpEncodeMap();
  } else {
    map = buildSingleByteEncodeMap(label);
  }
  encodingMaps.set(label, map);
  return map;
}

function buildSingleByteEncodeMap(label) {
  const decoder = new TextDecoder(label, { fatal: true });
  const map = new Map();

  for (let byte = 0; byte <= 0xFF; byte += 1) {
    try {
      const char = decoder.decode(new Uint8Array([byte]));
      if (!map.has(char)) map.set(char, [byte]);
    } catch {
      // Some single-byte labels leave a few byte values undefined.
    }
  }

  return map;
}

function buildShiftJisEncodeMap() {
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const map = new Map();
  const add = (bytes) => {
    try {
      const char = decoder.decode(new Uint8Array(bytes));
      if (char && !map.has(char)) map.set(char, bytes);
    } catch {
      // Invalid Shift_JIS sequences are ignored.
    }
  };

  for (let byte = 0x00; byte <= 0x7F; byte += 1) add([byte]);
  for (let byte = 0xA1; byte <= 0xDF; byte += 1) add([byte]);

  const leadRanges = [
    [0x81, 0x9F],
    [0xE0, 0xFC]
  ];
  const trailRanges = [
    [0x40, 0x7E],
    [0x80, 0xFC]
  ];

  leadRanges.forEach(([leadStart, leadEnd]) => {
    for (let lead = leadStart; lead <= leadEnd; lead += 1) {
      trailRanges.forEach(([trailStart, trailEnd]) => {
        for (let trail = trailStart; trail <= trailEnd; trail += 1) {
          add([lead, trail]);
        }
      });
    }
  });

  return map;
}

function buildEucJpEncodeMap() {
  const decoder = new TextDecoder("euc-jp", { fatal: true });
  const map = new Map();
  const add = (bytes) => {
    try {
      const char = decoder.decode(new Uint8Array(bytes));
      if (char && !map.has(char)) map.set(char, bytes);
    } catch {
      // Invalid EUC-JP sequences are ignored.
    }
  };

  for (let byte = 0x00; byte <= 0x7F; byte += 1) add([byte]);
  for (let trail = 0xA1; trail <= 0xDF; trail += 1) add([0x8E, trail]);

  for (let lead = 0xA1; lead <= 0xFE; lead += 1) {
    for (let trail = 0xA1; trail <= 0xFE; trail += 1) {
      add([lead, trail]);
      add([0x8F, lead, trail]);
    }
  }

  return map;
}

function encodeLatin1(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code > 0xFF) return null;
    bytes.push(code);
  }
  return new Uint8Array(bytes);
}

function decodeUnicodeEscapes(value) {
  return value
    .replace(/%u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64Bytes(value) {
  const compact = value.trim().replace(/\s+/g, "");
  if (compact.length < 8) return null;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;

  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (padded.length % 4 !== 0) return null;

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeHexBytes(value) {
  const trimmed = value.trim();
  const separatedHex = /^(?:0x)?[0-9a-f]{2}(?:[\s,;:_-]+(?:0x)?[0-9a-f]{2})+$/i;
  const plainHex = /^[0-9a-f]{6,}$/i;
  if (!separatedHex.test(trimmed) && !plainHex.test(trimmed)) return null;

  const hex = trimmed.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
  if (hex.length < 6 || hex.length % 2 !== 0) return null;

  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(parseInt(hex.slice(index, index + 2), 16));
  }
  return new Uint8Array(bytes);
}

function normalizeDecodedText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function hasInvalidControlCharacters(value) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000-\uF8FF]/.test(value);
}

function isMostlyPrintableText(value) {
  if (!/[A-Za-z0-9ぁ-んァ-ン一-龯]/.test(value)) return false;
  const printable = value.replace(/[\t\n\r ]/g, "").replace(/[\p{P}\p{S}]/gu, "");
  return printable.length >= Math.max(2, Math.floor(value.length * 0.35));
}

function mojibakeScore(value, original) {
  const hiragana = value.match(/[\u3040-\u309f]/g)?.length || 0;
  const katakana = value.match(/[\u30a0-\u30ff]/g)?.length || 0;
  const kanji = value.match(/[\u3400-\u9fff]/g)?.length || 0;
  const japanese = hiragana + katakana + kanji;
  const ascii = value.match(/[A-Za-z0-9]/g)?.length || 0;
  const readableSymbols = value.match(/[ 　。、・！？!?.,:;'"()[\]{}<>「」『』【】ー\-_/]/g)?.length || 0;
  const urlBonus = /https?:\/\/|www\.|[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value) ? 8 : 0;
  const mojibakeBefore = mojibakePenalty(original);
  const mojibakeAfter = mojibakePenalty(value);
  const cleanupBonus = mojibakeBefore > mojibakeAfter ? 8 : 0;
  const japaneseBonus = japanese > 0 ? 16 : 0;

  return (
    hiragana * 12
    + katakana * 8
    + kanji * 3
    + Math.min(ascii, 40) * 0.6
    + Math.min(readableSymbols, 30) * 0.2
    + urlBonus
    + cleanupBonus
    + japaneseBonus
    - mojibakeAfter * 6
  );
}

function mojibakePenalty(value) {
  const signatures = value.match(/(?:�|ã|Ã|Â|縺|繧|繝|譁|荳|莠|髯|隕|驥|邱|螟|蜿|逕|鬟|螢|裔|瘤|膰|鐔|[\u0080-\u009F\uFF61-\uFF9F\uE000-\uF8FF])/g);
  return signatures?.length || 0;
}

async function readQrFile() {
  const file = els.qrFileInput.files?.[0];
  if (!file) return;
  await decodeQrImage(file);
}

async function readQrClipboard() {
  if (!navigator.clipboard?.read) {
    setStatus("この環境では画像貼付に対応していません。画像ファイルを選択してください。", true);
    return;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((candidate) => candidate.startsWith("image/"));
      if (!type) continue;
      await decodeQrImage(await item.getType(type));
      return;
    }
    setStatus("クリップボードに画像がありません。", true);
  } catch {
    setStatus("クリップボード画像を読めませんでした。画像ファイルを選択してください。", true);
  }
}

async function decodeQrImage(blob) {
  els.qrResults.textContent = "";
  setBusy(true);
  setStatus("QRコードを読み取っています。");

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
    const codes = await detectQrCodes(bitmap);

    if (!codes.length) {
      renderResultMessage(els.qrResults, "QRコードを検出できませんでした。");
      setStatus("QRコードを検出できませんでした。", true);
      return;
    }

    codes.forEach((code, index) => {
      renderCopyResult(els.qrResults, `QR ${index + 1}`, code.rawValue || "");
    });
    setStatus("QRコードを読み取りました。", false, true);
  } catch (error) {
    renderResultMessage(els.qrResults, error.message || "QRコードを読み取れませんでした。");
    setStatus(error.message || "QRコードを読み取れませんでした。", true);
  } finally {
    bitmap?.close?.();
    setBusy(false);
  }
}

async function detectQrCodes(bitmap) {
  const nativeCodes = await detectQrWithBarcodeDetector(bitmap);
  if (nativeCodes.length) return nativeCodes;

  await ensureJsQrLoaded();
  const jsQrCode = detectQrWithJsQr(bitmap);
  return jsQrCode ? [jsQrCode] : [];
}

let jsQrLoadPromise = null;

// jsQR (~250KB) is only needed when BarcodeDetector is unavailable, so it is
// loaded on demand instead of on every popup open.
function ensureJsQrLoaded() {
  if (typeof globalThis.jsQR === "function") return Promise.resolve();

  jsQrLoadPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "src/vendor/jsQR.js";
    script.onload = () => resolve();
    script.onerror = () => {
      jsQrLoadPromise = null;
      script.remove();
      reject(new Error("QR読取ライブラリを読み込めませんでした。"));
    };
    document.head.append(script);
  });
  return jsQrLoadPromise;
}

async function detectQrWithBarcodeDetector(bitmap) {
  if (!("BarcodeDetector" in globalThis)) return [];

  try {
    const formats = typeof BarcodeDetector.getSupportedFormats === "function"
      ? await BarcodeDetector.getSupportedFormats()
      : ["qr_code"];
    if (!formats.includes("qr_code")) return [];

    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    return detector.detect(bitmap);
  } catch {
    return [];
  }
}

function detectQrWithJsQr(bitmap) {
  if (typeof globalThis.jsQR !== "function") {
    throw new Error("QR読取ライブラリを読み込めませんでした。");
  }

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("QR画像を解析できませんでした。");

  context.drawImage(bitmap, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = globalThis.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth"
  });
  return code?.data ? { rawValue: code.data } : null;
}

function clearQrTool() {
  els.qrFileInput.value = "";
  els.qrResults.textContent = "";
}

function renderResultMessage(list, text) {
  const item = document.createElement("li");
  item.className = "result-empty";
  item.textContent = text;
  list.append(item);
}

function renderCopyResult(list, label, value) {
  if (!value) return;

  const item = document.createElement("li");
  item.className = "result-item";
  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = `<small></small><strong></strong>`;
  button.querySelector("small").textContent = label;
  button.querySelector("strong").textContent = value;
  button.title = "クリックでコピー";
  button.addEventListener("click", () => copyUtilityText(value));
  item.append(button);
  list.append(item);
}

async function copyUtilityText(value) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus("コピーしました。", false, true);
  } catch {
    setStatus("コピーできませんでした。", true);
  }
}

function syncTimerTicker() {
  if (timerState.running) {
    if (!timerTicker) {
      timerTicker = window.setInterval(() => {
        timerState.elapsedMs += 1000;
        renderTimer();
      }, 1000);
    }
    return;
  }

  if (timerTicker) {
    window.clearInterval(timerTicker);
    timerTicker = 0;
  }
}

function formatElapsedMs(value) {
  const totalSeconds = Math.floor(Math.max(0, Number(value) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
