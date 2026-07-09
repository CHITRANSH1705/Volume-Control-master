const MAX_VOLUME = 3; // 300% ceiling
const els = {
  list: document.getElementById("tabs-list"),
  status: document.getElementById("status-line"),
  showAll: document.getElementById("show-all"),
  refresh: document.getElementById("refresh-btn"),
  muteAll: document.getElementById("mute-all-btn"),
  resetAll: document.getElementById("reset-all-btn"),
};

let refreshTimer = null;

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  );
}

async function queryTabState(tab) {
  if (isRestrictedUrl(tab.url)) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "getVolume" });
  } catch (e) {
    // content script likely wasn't present when the tab loaded (e.g. it was
    // already open before install/reload) — inject it once, then retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ["content.js"],
      });
      return await chrome.tabs.sendMessage(tab.id, { type: "getVolume" });
    } catch (e2) {
      return null;
    }
  }
}

function applySliderVisuals(row, volume, muted) {
  const pct = Math.round(volume * 100);
  const fillPct = Math.min(100, (volume / MAX_VOLUME) * 100);
  const slider = row.querySelector('input[type="range"]');
  const pctLabel = row.querySelector(".pct");

  slider.style.setProperty("--fill", `${fillPct}%`);
  row.classList.toggle("boosted", pct > 100 && !muted);
  row.classList.toggle("muted-row", muted);
  slider.style.setProperty(
    "--slider-color",
    muted ? "var(--magenta)" : pct > 100 ? "var(--amber)" : "var(--teal)"
  );
  pctLabel.textContent = muted ? "MUTE" : `${pct}%`;
}

function buildRow(tab, volState) {
  const controllable = volState !== null;
  const volume = controllable ? volState.volume : 1;
  const muted = controllable ? volState.muted : false;

  const row = document.createElement("div");
  row.className = "tab";
  row.dataset.tabId = String(tab.id);

  row.innerHTML = `
    <div class="tab-header">
      <img class="favicon" src="${tab.favIconUrl ? escapeHtml(tab.favIconUrl) : "icons/icon16.png"}"
           onerror="this.src='icons/icon16.png'">
      <span class="tab-title" title="${escapeHtml(tab.title || tab.url || "")}">${escapeHtml(
    tab.title || tab.url || "untitled tab"
  )}</span>
      <button class="mute-btn ${muted ? "muted" : ""}" data-action="mute" ${
    controllable ? "" : "disabled"
  } title="Mute/unmute">${muted ? "🔇" : "🔊"}</button>
    </div>
    <div class="tab-controls">
      <input type="range" min="0" max="${MAX_VOLUME}" step="0.05" value="${volume}" ${
    controllable ? "" : "disabled"
  }>
      <span class="pct">${Math.round(volume * 100)}%</span>
      <button class="reset-btn" data-action="reset" ${
        controllable ? "" : "disabled"
      } title="Reset to 100%">⟲</button>
    </div>
    ${
      controllable
        ? ""
        : `<div class="uncontrollable">// restricted page — cannot inject here_</div>`
    }
  `;

  applySliderVisuals(row, volume, muted);

  const slider = row.querySelector('input[type="range"]');
  slider.addEventListener("input", async () => {
    const v = parseFloat(slider.value);
    // optimistic visual update (always unmuted, since dragging implies audible intent)
    applySliderVisuals(row, v, false);
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "setVolume", volume: v });
      applySliderVisuals(row, res.volume, res.muted);
      row.querySelector(".mute-btn").classList.toggle("muted", res.muted);
      row.querySelector(".mute-btn").textContent = res.muted ? "🔇" : "🔊";
    } catch (e) {
      /* tab may have closed mid-drag */
    }
  });

  row.querySelector('[data-action="mute"]')?.addEventListener("click", async (e) => {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "toggleMute" });
      slider.value = res.volume;
      applySliderVisuals(row, res.volume, res.muted);
      e.currentTarget.classList.toggle("muted", res.muted);
      e.currentTarget.textContent = res.muted ? "🔇" : "🔊";
    } catch (err) {}
  });

  row.querySelector('[data-action="reset"]')?.addEventListener("click", async () => {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "resetVolume" });
      slider.value = res.volume;
      applySliderVisuals(row, res.volume, res.muted);
      const muteBtn = row.querySelector(".mute-btn");
      muteBtn.classList.remove("muted");
      muteBtn.textContent = "🔊";
    } catch (e) {}
  });

  return row;
}

async function render() {
  const queryOpts = els.showAll.checked ? {} : { audible: true };
  let tabs = await chrome.tabs.query(queryOpts);

  // keep a stable, readable order
  tabs = tabs.slice().sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  els.list.innerHTML = "";

  if (tabs.length === 0) {
    els.status.textContent = els.showAll.checked
      ? "// no open tabs_"
      : "// no audio playing right now_";
    els.list.innerHTML = `<div class="empty">${
      els.showAll.checked
        ? "nothing open."
        : "play something, or toggle \u201cshow all tabs\u201d above."
    }</div>`;
    return;
  }

  els.status.textContent = `// ${tabs.length} tab${tabs.length === 1 ? "" : "s"} listed_`;

  const states = await Promise.all(tabs.map((t) => queryTabState(t)));
  tabs.forEach((tab, i) => {
    els.list.appendChild(buildRow(tab, states[i]));
  });
}

function scheduleRender() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(render, 150);
}

els.showAll.addEventListener("change", render);
els.refresh.addEventListener("click", render);

els.muteAll.addEventListener("click", async () => {
  const rows = [...els.list.querySelectorAll(".tab[data-tab-id]")];
  await Promise.all(
    rows.map(async (row) => {
      const tabId = Number(row.dataset.tabId);
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: "toggleMute" });
        const slider = row.querySelector('input[type="range"]');
        const muteBtn = row.querySelector(".mute-btn");
        slider.value = res.volume;
        applySliderVisuals(row, res.volume, res.muted);
        muteBtn.classList.toggle("muted", res.muted);
        muteBtn.textContent = res.muted ? "🔇" : "🔊";
      } catch (e) {}
    })
  );
});

els.resetAll.addEventListener("click", async () => {
  const rows = [...els.list.querySelectorAll(".tab[data-tab-id]")];
  await Promise.all(
    rows.map(async (row) => {
      const tabId = Number(row.dataset.tabId);
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: "resetVolume" });
        const slider = row.querySelector('input[type="range"]');
        const muteBtn = row.querySelector(".mute-btn");
        slider.value = res.volume;
        applySliderVisuals(row, res.volume, res.muted);
        muteBtn.classList.remove("muted");
        muteBtn.textContent = "🔊";
      } catch (e) {}
    })
  );
});

// live-refresh the list while the popup stays open (e.g. a tab starts/stops
// playing audio, or a new tab is opened)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if ("audible" in changeInfo) scheduleRender();
});
chrome.tabs.onRemoved.addListener(scheduleRender);
chrome.tabs.onCreated.addListener(scheduleRender);

render();
