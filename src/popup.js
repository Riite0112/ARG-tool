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
const els = {};
const encodingMaps = new Map();
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
  setStatus("開発者を応援する導線は準備中です。公開後に案内先を追加できるようにしてあります。", false, true);
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

  addCandidate(candidates, original, "UTF-8 → Shift_JIS誤読", () => {
    return decodeBytes(encodeByMap(original, "shift_jis"), "utf-8");
  });
  addCandidate(candidates, original, "UTF-8 → Windows-1252誤読", () => {
    return decodeBytes(encodeByMap(original, "windows-1252"), "utf-8");
  });
  addCandidate(candidates, original, "Shift_JIS → Windows-1252誤読", () => {
    return decodeBytes(encodeByMap(original, "windows-1252"), "shift_jis");
  });
  addCandidate(candidates, original, "EUC-JP → Windows-1252誤読", () => {
    return decodeBytes(encodeByMap(original, "windows-1252"), "euc-jp");
  });
  addCandidate(candidates, original, "URLデコード", () => {
    if (!/%[0-9a-f]{2}/i.test(original)) return "";
    return decodeURIComponent(original.replace(/\+/g, "%20"));
  });
  addCandidate(candidates, original, "HTMLエンティティ解除", () => {
    if (!/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(original)) return "";
    const textarea = document.createElement("textarea");
    textarea.innerHTML = original;
    return textarea.value;
  });

  return candidates.sort((a, b) => japaneseScore(b.value) - japaneseScore(a.value));
}

function addCandidate(candidates, original, label, factory) {
  try {
    const value = String(factory() || "").trim();
    if (!value || value === original || value.includes("\uFFFD")) return;
    if (candidates.some((candidate) => candidate.value === value)) return;
    candidates.push({ label, value });
  } catch {
    // Unsupported encodings or invalid byte sequences are just skipped.
  }
}

function decodeBytes(bytes, label) {
  if (!bytes?.length) return "";
  return new TextDecoder(label, { fatal: true }).decode(bytes);
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

  const map = label === "shift_jis" ? buildShiftJisEncodeMap() : buildSingleByteEncodeMap(label);
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

function japaneseScore(value) {
  const japanese = value.match(/[\u3040-\u30ff\u3400-\u9fff]/g)?.length || 0;
  const ascii = value.match(/[A-Za-z0-9]/g)?.length || 0;
  return japanese * 3 + ascii;
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

  if (!("BarcodeDetector" in globalThis)) {
    renderResultMessage(els.qrResults, "このブラウザではQR読取に対応していません。");
    setStatus("QR読取に対応していない環境です。", true);
    return;
  }

  setBusy(true);
  setStatus("QRコードを読み取っています。");

  let bitmap = null;
  try {
    const formats = typeof BarcodeDetector.getSupportedFormats === "function"
      ? await BarcodeDetector.getSupportedFormats()
      : ["qr_code"];
    if (!formats.includes("qr_code")) {
      throw new Error("QRコード形式に対応していません。");
    }

    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    bitmap = await createImageBitmap(blob);
    const codes = await detector.detect(bitmap);

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
