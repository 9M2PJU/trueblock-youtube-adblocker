# TrueBlock for YouTube — Ultimate Ad Blocker (Chrome MV3)

> By **[9M2PJU](https://hamradio.my)** · Version 1.2.0 · Official repo: <https://github.com/9M2PJU/trueblock-youtube-adblocker>

Ultra-fast, privacy-first YouTube ad blocker. No tracking, everything runs locally.

## What it blocks

- **Video ads:** pre-roll, mid-roll, post-roll, 6s bumpers, unskippable ads → auto-seek to end + auto-click Skip in ~50ms, muted + 16x so you never see/hear them
- **Overlays & banners:** overlay popups, masthead, sidebar, display ads, companion ads
- **Sponsored slots:** promoted videos, in-feed ads, sponsored Shorts (auto-advances)
- **Ad beacons:** `googleads / doubleclick / googlesyndication / stats/ads / ptracking / get_midroll_` blocked at network layer (declarativeNetRequest) + XHR/fetch backstop
- **Anti-adblock nag:** removes “Ad blockers are not allowed” dialog + backdrop and resumes playback

## How it works (3 layers)

1. `rules/block_ads.json` — MV3 `declarativeNetRequest` network blocking (fast, before request leaves browser)
2. `src/inject.js` (MAIN world, `document_start`) — strips `adPlacements` / `playerAds` / `adSlots` from `ytInitialPlayerResponse` and `/youtubei/v1/player|next` JSON via `JSON.parse`, `fetch`, `XHR` patches
3. `src/content.js` + `src/content.css` (ISOLATED world) — `requestAnimationFrame` ad-skipper, `MutationObserver` cosmetic cleaner, enforcement-dialog bypass, SPA-navigation handling

## Install (Load unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`ytblockext`)
4. Open YouTube — ads should skip instantly. Click the extension icon for toggles + counters.

## Test it

- Watch any monetized video: ad frame should flash black for <100ms then jump to content
- Check badge counter on extension icon increments
- Popup lets you toggle: video ads / banners / sponsored / Shorts ads / anti-adblock bypass

## Files

```
manifest.json
rules/block_ads.json
src/inject.js     # MAIN-world player-response cleaner
src/content.js    # ad skipper + DOM cleaner + anti-adblock
src/enhancements.js # optional enhancements (theater, quality, volume…)
src/content.css   # cosmetic hiding
src/background.js # badge counter + stats
src/popup.html/.css/.js
icons/
```

## Enhancements (ported ideas, lean native code)

Optional toggles in the popup, inspired by [YouTube-Enhancer/extension](https://github.com/YouTube-Enhancer/extension) (MIT) — re-implemented natively, no upstream code vendored, no build step added:

- Auto theater mode · Disable autoplay (respects your manual clicks)
- Remember volume · Remember playback speed (never fights the ad-skipper)
- Force quality (4K → 360p) · Skip “Video paused. Continue watching?”
- Hide Shorts everywhere (home · search · sidebar · channel · watch-next)
- Volume boost (150/200/300% via WebAudio gain)
- Player buttons: loop toggle · copy timestamp link · screenshot frame to PNG
- Hide distractions (end cards · live chat · paid-promo banner)
- Remaining time (rate-aware countdown) · Shorts auto-scroll (next on ended)

Credits: enhancement concepts by the YouTube-Enhancer contributors (MIT). See upstream repo for their full 69-feature suite.

## Privacy

No remote servers, no analytics, no data collection. Settings stored in `chrome.storage` only.

## About

- Author: [9M2PJU](https://hamradio.my)
- Website: <https://hamradio.my>
- GitHub: <https://github.com/9M2PJU/trueblock-youtube-adblocker>
- License: MIT — see [LICENSE](LICENSE)

## Notes

- Manifest V3, min Chrome 116 (uses `world: MAIN` content scripts).
- If YouTube changes selectors, update `SKIP_SELECTORS` / `BANNER_SELECTORS` in `src/content.js` and CSS.
- Respect creators: consider YouTube Premium / whitelisting channels you love (per-channel whitelist is a good next feature).
