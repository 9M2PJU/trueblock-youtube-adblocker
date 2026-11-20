# CHROMEWEBSTORE.md — store compliance tracker for TrueBlock

> Maintained per Chrome's agentic extension workflow: every permission and
> data practice listed here must match `manifest.json` + PRIVACY.md.
> Review before each store submission.

## Listing

- **Name:** TrueBlock for YouTube (≤45 chars, AMO rule)
- **Short description (≤132):** TrueBlock: adblock, sponsor skip & enhancer for YouTube. Blocks ads, skips sponsors. Private, local-first.
- **Category:** Productivity
- **Single purpose:** Block ads on YouTube and enhance video playback.
- **Store icon:** `icons/icon128.png` · **Screenshots:** 1280×800 (popup open, themed watch page, EQ+spectrum)

## Permission justifications (paste into Privacy practices tab)

| Permission | Justification |
|---|---|
| alarms | Resets the on-device blocked-ads session counter once per day. No data involved. |
| declarativeNetRequest | Enforces the built-in YouTube-scoped ad/tracker blocklist before requests leave the browser. |
| Host: youtube.com, youtube-nocookie.com | Block ads and apply playback enhancements on YouTube pages. |
| Host: sponsor.ajayyy.com | Fetch crowdsourced sponsor-skip timestamps (by 4-char SHA-256 hash prefix) when that feature is enabled. |
| Host: returnyoutubedislikeapi.com | Fetch crowdsourced like/dislike counts when that feature is enabled. |
| storage | Stores user toggles and block counters locally via chrome.storage. Never transmitted. |
| Remote code | None — all JavaScript ships inside the package. Only third-party data fetched is SponsorBlock skip timestamps + RYD vote counts (plain JSON numbers), never code. |

## Data disclosure

- Transmitted off-device: **4-char SHA-256 prefix of video ID → sponsor.ajayyy.com** (sponsor-skip, on by default, untick for fully offline) and **video ID → returnyoutubedislikeapi.com** (dislike counts, on by default, untick for fully offline).
- Everything else (toggles, counters, EQ curves): `chrome.storage` only.
- Policy URL: https://github.com/9M2PJU/trueblock-youtube-adblocker/blob/main/PRIVACY.md

## Review history

- CWS: host permissions trimmed (removed googlevideo, google-analytics, googlesyndication, doubleclick, googleadservices); dropped `declarativeNetRequestFeedback` and `web_accessible_resources`; DNR rules scoped to YouTube initiators; manifest description cut to 106 chars (132 limit).
- AMO: `web-ext lint` 0 errors; gecko ID + data_collection_permissions declared; Android allowed.
- AMO validation fixes: `strict_min_version` raised 140→142 (floor for `data_collection_permissions`); `minimum_chrome_version` stripped from Firefox manifest and `browser_specific_settings` stripped from Chrome manifest by `build.sh`.

## Pre-submit checklist

- [x] `manifest.json` version bumped + README changelog entry
- [x] `web-ext lint` 0 errors (Firefox)
- [x] Permission list above matches `manifest.json` exactly
- [ ] Screenshots current (no dashboard/placeholder shots)
- [x] Release zips rebuilt via `build.sh`
