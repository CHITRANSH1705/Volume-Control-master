// VOLCTL content script
// Runs in every frame of every page (document_start). Builds a persistent
// Web Audio graph per <video>/<audio> element so volume can be boosted past
// the native 100% ceiling, keeps applying the chosen level to elements added
// later by the page (SPA players swapping <video> tags, ads, etc.), and
// remembers the last level per hostname via chrome.storage.local.
(() => {
  if (window.__volctlActive) return; // already initialized in this frame
  window.__volctlActive = true;

  const STATE = {
    volume: 1,       // 1.0 == 100%. Range enforced by popup: 0 - 3 (0-300%)
    muted: false,
    audioCtx: null,
    wrapped: new WeakMap(), // media element -> { gain, fallback }
  };

  function getAudioContext() {
    if (!STATE.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      STATE.audioCtx = new Ctx();
    }
    if (STATE.audioCtx.state === "suspended") {
      STATE.audioCtx.resume().catch(() => {});
    }
    return STATE.audioCtx;
  }

  function effectiveGain() {
    return STATE.muted ? 0 : STATE.volume;
  }

  function wrap(el) {
    if (STATE.wrapped.has(el)) return STATE.wrapped.get(el);
    let entry;
    try {
      const ctx = getAudioContext();
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      source.connect(gain).connect(ctx.destination);
      gain.gain.value = effectiveGain();
      entry = { gain, fallback: false };
    } catch (err) {
      // DRM-protected streams (e.g. some Netflix/Prime playback) and a few
      // other cases refuse createMediaElementSource. Fall back to the
      // native volume property, which caps at 100% but never breaks playback.
      entry = { gain: null, fallback: true };
      el.volume = Math.min(effectiveGain(), 1);
    }
    STATE.wrapped.set(el, entry);
    return entry;
  }

  function applyToElement(el) {
    const entry = wrap(el);
    if (entry.fallback) {
      el.volume = Math.min(effectiveGain(), 1);
    } else if (entry.gain) {
      entry.gain.gain.value = effectiveGain();
    }
  }

  function applyAll() {
    document.querySelectorAll("video, audio").forEach(applyToElement);
  }

  // Catch elements added after initial load (SPA video swaps, ads, lazy players)
  const observer = new MutationObserver((mutations) => {
    let shouldApply = false;
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.("video, audio")) shouldApply = true;
        else if (node.querySelector?.("video, audio")) shouldApply = true;
      });
    }
    if (shouldApply) applyAll();
  });

  function startObserving() {
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    applyAll();
  }

  if (document.documentElement) {
    startObserving();
  } else {
    document.addEventListener("DOMContentLoaded", startObserving, { once: true });
  }

  // Restore the last level saved for this hostname, if any
  try {
    chrome.storage.local.get([location.hostname], (res) => {
      const saved = res && res[location.hostname];
      if (saved) {
        STATE.volume = saved.volume ?? 1;
        STATE.muted = !!saved.muted;
        applyAll();
        notifyBackground();
      }
    });
  } catch (e) {
    // storage unavailable in this context (rare); safe to ignore
  }

  function persist() {
    try {
      chrome.storage.local.set({
        [location.hostname]: { volume: STATE.volume, muted: STATE.muted },
      });
    } catch (e) {}
  }

  function notifyBackground() {
    try {
      chrome.runtime.sendMessage({
        type: "volumeChanged",
        volume: STATE.volume,
        muted: STATE.muted,
      });
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg?.type) {
      case "setVolume":
        STATE.volume = Math.max(0, Math.min(3, Number(msg.volume)));
        STATE.muted = false; // adjusting the level implies the user wants sound
        applyAll();
        persist();
        notifyBackground();
        sendResponse({ ok: true, volume: STATE.volume, muted: STATE.muted });
        break;
      case "toggleMute":
        STATE.muted = !STATE.muted;
        applyAll();
        persist();
        notifyBackground();
        sendResponse({ ok: true, volume: STATE.volume, muted: STATE.muted });
        break;
      case "resetVolume":
        STATE.volume = 1;
        STATE.muted = false;
        applyAll();
        try {
          chrome.storage.local.remove(location.hostname);
        } catch (e) {}
        notifyBackground();
        sendResponse({ ok: true, volume: STATE.volume, muted: STATE.muted });
        break;
      case "getVolume":
        sendResponse({ ok: true, volume: STATE.volume, muted: STATE.muted });
        break;
      default:
        return false;
    }
    return true; // keep the message channel open for async sendResponse
  });
})();
