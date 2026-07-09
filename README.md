# VOLCTL — Per-Tab Volume Control

A Chrome (Manifest V3) extension that gives every open tab its own volume
control — independent of the OS mixer and independent of each other.

v2.0 is a full rewrite of the original proof of concept. The old version
could only turn a tab *down* (native `<video>`/`<audio>` volume caps at
100%) and forgot every setting the moment the popup closed. This version
adds real gain boosting, persistence, and a live-updating UI.

## Features

- **True volume boost, up to 300%.** Uses the Web Audio API
  (`MediaElementSource → GainNode → destination`) instead of the native
  `.volume` property, so quiet sites can actually be made louder, not just
  quieter.
- **Per-site memory.** Your chosen level is saved per hostname
  (`chrome.storage.local`) and reapplied automatically the next time you
  visit — no need to re-adjust every reload.
- **Survives dynamic pages.** A `MutationObserver` keeps watching for new
  `<video>`/`<audio>` elements (SPA players, ads, lazy-loaded embeds) and
  applies the current level to them automatically.
- **Mute, reset, mute-all, reset-all**, per tab or across every listed tab
  at once.
- **Live popup.** The tab list updates itself while the popup is open —
  no need to close and reopen it when a new tab starts playing audio.
- **Toolbar badge** shows the active percentage (or `MUT`) directly on the
  extension icon, per tab.
- **Graceful fallback.** DRM-protected streams (some Netflix/Prime
  playback) refuse to be wrapped by the Web Audio API — VOLCTL detects
  this and falls back to the native volume property automatically instead
  of breaking playback.
- **"Show all tabs" toggle** for controlling a tab before it's actually
  playing anything, not just currently-audible ones.

## Install (unpacked, for development/testing)

1. `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select this folder.
3. Pin the extension, open something with audio, click the icon.

## How it works

```
popup.js  ──sendMessage──▶  content.js (per frame, per tab)
   ▲                              │
   │                       Web Audio graph:
   │                       <video>/<audio> ─▶ GainNode ─▶ destination
   │                              │
   └──────── badge update ◀── background.js (relays volumeChanged → badge)
```

- **`content.js`** is injected into every frame of every page at
  `document_start`. It owns the actual audio graph and is the single
  source of truth for that frame's volume/mute state. It responds to
  `getVolume` / `setVolume` / `toggleMute` / `resetVolume` messages and
  persists per-hostname settings itself.
- **`background.js`** just listens for state changes and paints the
  toolbar badge — it holds no volume state of its own.
- **`popup.js`** lists candidate tabs (`chrome.tabs.query`), asks each
  tab's content script for its current state, and renders sliders wired
  straight back to those same messages. If a tab was already open before
  the extension was installed/reloaded (so it never got the declarative
  content script), the popup injects `content.js` into it on demand via
  `chrome.scripting.executeScript` before retrying.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | List tabs, read titles/favicons/audible state |
| `activeTab`, `scripting` | Inject `content.js` on demand into tabs that predate install |
| `storage` | Remember per-hostname volume/mute across visits |
| `host_permissions: <all_urls>` | The content script needs to run on any site for volume control to work universally |

## Known limitations

- Some DRM-protected video (certain Netflix/Prime Video playback) can't be
  routed through a `GainNode` — those tabs silently fall back to the
  native 0–100% range instead of the 0–300% boosted range.
- Browsers suspend new `AudioContext`s until a user gesture occurs on the
  page itself; if boost doesn't seem to apply instantly on a page you
  haven't interacted with yet, click into the page once first.
- Volume set via the Web Audio path is per-tab-session state layered on
  top of persisted per-hostname preference — clearing site data/storage
  for the extension resets everything back to 100%.

## File structure

```
manifest.json     MV3 manifest — permissions, content script registration
background.js     Badge painter, listens for volumeChanged messages
content.js        Per-frame audio graph, persistence, message handlers
popup.html/.css/.js   The toolbar popup UI
icons/            Generated toolbar icons (16/32/48/128)
tools/make_icons.py   Regenerates icons/ if you want to restyle them
```
