const viewLabels = {
  all: "左パネルと下バーを表示しました。",
  pages: "左側にページ一覧を表示しました。",
  keywords: "下側にキーワードバーを表示しました。"
};

const els = {};
let selectedPanels = new Set();
let timerState = {
  elapsedMs: 0,
  running: false,
  started: false
};
let timerTicker = 0;

document.addEventListener("DOMContentLoaded", () => {
  for (const node of document.querySelectorAll("[id]")) {
    els[node.id] = node;
  }

  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.addEventListener("click", () => togglePanel(button.dataset.panel));
  });

  els.supportButton.addEventListener("click", showSupportPlaceholder);
  els.hideButton.addEventListener("click", hideTool);
  els.hideToolButton.addEventListener("click", hideTool);
  els.timerToggleButton.addEventListener("click", toggleTimer);
  els.timerResetButton.addEventListener("click", resetTimer);
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

function showSupportPlaceholder() {
  setStatus("開発の応援項目は準備中です。公開後に案内先を追加できるようにしてあります。", false, true);
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
  els.siteLabel.textContent = state.site || state.url || "現在のページ";
  els.sessionTitle.textContent = state.sessionTitle || "ARG探索メモ";
  els.pageCount.textContent = String(state.pageCount || 0);
  els.keywordCount.textContent = String(state.keywordCount || 0);
  els.targetPages.textContent = state.targetPages ? String(state.targetPages) : "-";
  els.trackedState.textContent = state.hidden ? "非表示" : state.tracked ? "表示中" : "未登録";
  els.trackedState.classList.toggle("hidden", Boolean(state.hidden));
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
  document.querySelectorAll("[data-panel], #hideButton, #hideToolButton, #timerToggleButton, #timerResetButton").forEach((button) => {
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
    els.timerResetButton.disabled = !timerState.started;
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
