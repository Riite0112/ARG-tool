const viewLabels = {
  all: "左パネルと下バーを表示しました。",
  pages: "左側にページ一覧を表示しました。",
  keywords: "下側にキーワードバーを表示しました。"
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  for (const node of document.querySelectorAll("[id]")) {
    els[node.id] = node;
  }

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => openView(button.dataset.view));
  });

  els.hideButton.addEventListener("click", hideTool);
  els.hideToolButton.addEventListener("click", hideTool);
  loadPopupState();
});

async function loadPopupState() {
  setStatus("読み込み中です。");
  try {
    const response = await chrome.runtime.sendMessage({ type: "ARG_SCOUT_GET_POPUP_STATE" });
    if (!response?.ok) throw new Error(response?.error || "状態を取得できませんでした。");
    renderState(response);
    setStatus(response.savable ? "表示したい項目を選択してください。" : "このページでは使用できません。", !response.savable);
  } catch (error) {
    setStatus(error.message || "状態を取得できませんでした。", true);
    setDisabled(true);
  }
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
  setDisabled(!state.savable);
}

function setDisabled(disabled) {
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = Boolean(disabled);
  });
}

function setBusy(busy) {
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = Boolean(busy);
  });
}

function setActiveView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function setStatus(text, isError = false, isOk = false) {
  els.statusText.textContent = text;
  els.statusText.classList.toggle("error", Boolean(isError));
  els.statusText.classList.toggle("ok", Boolean(isOk) && !isError);
}
