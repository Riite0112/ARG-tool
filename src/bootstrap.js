// Lightweight always-on content script. The full UI (src/content.js) is only
// injected by the background service worker when this page's site is tracked,
// so untracked pages never pay for parsing or running the main script.
(() => {
  if (globalThis.__ARG_SCOUT_CONTENT_LOADED__ || globalThis.__ARG_SCOUT_BOOTSTRAP_LOADED__) return;
  globalThis.__ARG_SCOUT_BOOTSTRAP_LOADED__ = true;

  if (typeof chrome === "undefined" || !chrome.storage?.local) return;

  const STORAGE_KEY = "argScoutState";
  const base = siteBase(location.href);
  if (!base) return;

  chrome.storage.local.get([STORAGE_KEY])
    .then((result) => {
      if (!shouldAutoOpen(result[STORAGE_KEY], base)) return;
      return chrome.runtime.sendMessage({ type: "ARG_SCOUT_SHOW_LAYOUT" });
    })
    .catch(() => {
      // Auto-open is a convenience; the toolbar button still opens the tool.
    });

  function shouldAutoOpen(state, origin) {
    if (!state || typeof state !== "object") return false;
    const sessions = Array.isArray(state.sessions) ? state.sessions : [state];
    return sessions.some((session) =>
      Array.isArray(session?.trackedSites)
      && session.trackedSites.includes(origin)
      && !(Array.isArray(session.hiddenSites) && session.hiddenSites.includes(origin))
    );
  }

  function siteBase(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.origin : "";
    } catch {
      return "";
    }
  }
})();
