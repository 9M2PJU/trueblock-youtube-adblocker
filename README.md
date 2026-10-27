<div align="center">

# ▶ TrueBlock for YouTube

**The ultra-fast, privacy-first YouTube ad blocker — now with SponsorBlock-style crowdsourced skips & 18 enhancements.**

[![Version](https://img.shields.io/badge/version-1.5.5-red?style=flat-square)](https://github.com/9M2PJU/trueblock-youtube-adblocker/releases)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-green?style=flat-square&logo=googlechrome)](https://github.com/9M2PJU/trueblock-youtube-adblocker)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-yellow?style=flat-square)](LICENSE)
[![No tracking](https://img.shields.io/badge/tracking-none-blue?style=flat-square)](#-privacy)

*Skips video ads in ~50&nbsp;ms · kills banners, overlays & sponsored slots · bypasses anti-adblock walls — all running 100% locally.*

[⬇️ Install](#-install-30-seconds) · [✨ Features](#-what-it-does) · [🔒 Privacy](#-privacy) · [🙏 Credits](#-credits)

</div>

---

## 🚀 Install (30 seconds)

1. Download the latest **`trueblock-youtube-adblocker.zip`** from [Releases](https://github.com/9M2PJU/trueblock-youtube-adblocker/releases) and unzip it — or clone this repo.
2. Open `chrome://extensions` in Chrome / Edge / Brave.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the extension folder.
5. Open YouTube. Pin 📌 TrueBlock to your toolbar for toggles & stats.

> Updates: repeat steps 1 + 4 (or `git pull` + click ⟳ Reload on the extension card).

---

## 🛡️ What it does

### Ad blocking — 3 layers

| Layer | Where | What |
|---|---|---|
| **Network** | `rules/block_ads.json` | 15 MV3 `declarativeNetRequest` rules block `doubleclick`, `googlesyndication`, `googleadservices`, `stats/ads`, `ptracking`, `get_midroll_` before requests leave the browser |
| **Player patch** | `src/inject.js` (MAIN world) | Strips `adPlacements` / `playerAds` / `adSlots` from `ytInitialPlayerResponse` and `/youtubei/v1/player` responses via `JSON.parse` + `fetch` + `XHR` hooks |
| **Skip + clean** | `src/content.js` (ISOLATED world) | `requestAnimationFrame` skipper mutes + 16× + seeks ads to end, auto-clicks every Skip variant, removes banners/masthead/overlays/sponsored slots, kills the *“Ad blockers are not allowed”* wall and resumes playback |

- Pre-roll · mid-roll · post-roll · 6s bumpers · unskippable ads → gone in a <100 ms black flash
- Sidebar / masthead / overlay / companion / in-feed ads → removed
- Sponsored Shorts → auto-skipped
- Live badge counter on the toolbar icon + session/total stats in the popup

### ✨ Enhancements (all optional, all off except volume-memory & continue-skip)

| Group | Options |
|---|---|
| Playback | Auto theater · autoplay off (respects your clicks) · remember volume · remember speed · force quality 4K→360p · seek ±5–30 s buttons · speed −/+ buttons · scroll-wheel volume over player |
| Uninterrupted | Skip *“Video paused. Continue watching?”* · Shorts auto-scroll |
| Player tools | Loop toggle · copy timestamp link · screenshot frame → PNG |
| Declutter | Hide Shorts everywhere · hide end cards / live chat / paid banner · hide posts, playlists, member-only, playables · videos-per-row 1–8 · unwrap redirect links + strip tracker params · block 0–9 key seeking |
| Audio | Volume boost 150 / 200 / 300 % (WebAudio) |

### 🤝 SponsorBlock (crowdsourced, on by default)

Skips **in-video** sponsor reads, intros, outros and more using the community database — clean-room client of the public read API, no SponsorBlock code vendored:

- 8 categories: sponsor · intro · outro · subscribe-reminder · self-promo · off-topic music · recap/preview · filler (skip-type segments only)
- Auto-skips with a toast (`Skipped sponsor (12s) · via SponsorBlock`), per-video cache, never fights the ad-skipper, fails open offline
- Fetched through the background worker: page-origin requests are CORS-blocked by the API, the worker's host permission is not

> Privacy note: this sends the current **video ID** to `sponsor.ajayyy.com` to fetch segments (untick to disable). Everything else in TrueBlock stays fully local.

---

## 🗂️ Project layout

```
manifest.json          # MV3 manifest (min Chrome 116)
rules/block_ads.json   # network blocklist (15 DNR rules)
src/
  inject.js            # MAIN-world player-response cleaner
  content.js           # ad skipper + DOM cleaner + anti-adblock
  sponsorblock.js      # crowdsourced sponsor skipping, on by default (original API client)
  enhancements.js      # 18 optional enhancements (~30 KB vanilla JS)
  content.css          # cosmetic ad hiding
  background.js        # badge counter + stats
  popup.html/.css/.js  # control panel + About dialog
icons/                 # toolbar icons
```

Zero dependencies. Zero build step. Just load the folder.

---

## 🔒 Privacy

- **No servers, no analytics, no telemetry.** Everything runs on-device — except the **SponsorBlock** lookup (on by default), which sends only the video ID to `sponsor.ajayyy.com`.
- Settings live in `chrome.storage` only. Nothing ever leaves your browser.
- Permissions are minimal: ad/tracker hosts + `declarativeNetRequest` + `storage`. No `<all_urls>`, no tab reading, no history access.

---

## 🙏 Credits

## ☕ Support TrueBlock

Free forever, no ads, no tracking. If it saves your sanity, chip in:

[![PayPal](https://img.shields.io/badge/PayPal-9M2PJU-0070ba?style=flat-square&logo=paypal)](https://paypal.me/9M2PJU)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-9m2pju-ff813f?style=flat-square&logo=buymeacoffee)](https://buymeacoffee.com/9m2pju)
[![Wise](https://img.shields.io/badge/Wise-faizulz13-163300?style=flat-square&logo=wise)](https://wise.com/pay/me/faizulz13)

- Author & maintainer: **[9M2PJU](https://hamradio.my)** — <https://hamradio.my>
- Enhancement concepts: [YouTube-Enhancer/extension](https://github.com/YouTube-Enhancer/extension) (MIT) — re-implemented natively, no upstream code vendored.
- In-video sponsor skipping inspired by [ajayyy/SponsorBlock](https://github.com/ajayyy/SponsorBlock) (GPL-3.0) via its public read API — original client code, nothing copied.
- License: [GPL-3.0](LICENSE) — Copyright © 2026 9M2PJU. PRs welcome — especially updated selectors when YouTube moves things around (`SKIP_SELECTORS` in `src/content.js`).

## 📝 Changelog

- **v1.5.5** — Settings are the source of truth: theater enforced both ways (on puts it in, off keeps it out), quality re-applied persistently instead of giving up after retries
- **v1.5.4** — Unticking theater/autoplay-style modes now reverts YouTube back out (one-shot revert, no more stuck states)
- **v1.5.3** — Removed broken themes (use YouTube's native appearance settings)
- **v1.5.2** — SponsorBlock CORS fix: API fetched via background worker
- **v1.5.1** — Theme reliability: higher-specificity selectors, instant apply on setting change, toast confirmation, popup dropdowns no longer risk unticking their row
- **v1.5.0** — SponsorBlock on by default · donate buttons (PayPal · Coffee · Wise) + GitHub FUNDING.yml
- **v1.4.0** — SponsorBlock-style crowdsourced skips (8 categories, opt-in, original API client)
- **v1.3.0** — Lite themes (5 presets + accent) · seek/speed buttons · wheel volume · feed declutter · videos-per-row · link/key fixes
- **v1.2.0** — 12-feature pack: Shorts hiding, volume boost, loop/timestamp/screenshot buttons, distractions filter, remaining time, Shorts auto-scroll
- **v1.1.0** — First enhancement port: theater, autoplay-off, volume/speed memory, forced quality, continue-watching skip
- **v1.0.0** — Core MV3 ad blocker + anti-adblock bypass + About dialog
