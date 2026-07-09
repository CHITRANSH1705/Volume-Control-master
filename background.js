// VOLCTL background service worker
// Keeps the toolbar badge in sync with each tab's current volume/mute state.
// The content script is the source of truth; this just relays + displays it.

const BADGE_MUTED_COLOR = "#ff3d81";
const BADGE_BOOST_COLOR = "#ffb020"; // > 100%
const BADGE_NORMAL_COLOR = "#00e5b0"; // != 100% but not boosted... kept for clarity

function setBadge(tabId, volume, muted) {
  if (typeof tabId !== "number") return;
  const pct = Math.round(volume * 100);

  if (muted) {
    chrome.action.setBadgeText({ text: "MUT", tabId });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_MUTED_COLOR, tabId });
    return;
  }
  if (pct === 100) {
    chrome.action.setBadgeText({ text: "", tabId });
    return;
  }
  chrome.action.setBadgeText({ text: String(pct), tabId });
  chrome.action.setBadgeBackgroundColor({
    color: pct > 100 ? BADGE_BOOST_COLOR : BADGE_NORMAL_COLOR,
    tabId,
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "volumeChanged" && sender.tab && typeof sender.tab.id === "number") {
    setBadge(sender.tab.id, msg.volume, msg.muted);
  }
  // no sendResponse needed; return nothing so the channel closes immediately
});

// Clear the badge while a tab is (re)loading a new page — the content script
// will re-report the real state (default or restored-from-storage) once it
// runs on the new document, so a stale badge never lingers past navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});
