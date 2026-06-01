const MENU_SELECTION_ID = "arg-scout-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: "選択したテキストをARG探索ツールへ送る",
    contexts: ["selection"]
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.windowId == null) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
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
