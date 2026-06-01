chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ARG_SCOUT_GET_SELECTION") return;

  const text = String(window.getSelection?.() || "").trim();
  sendResponse({
    text,
    title: document.title,
    url: location.href
  });
});
