# CHROMEWEBSTORE.md — store compliance tracker for TrueBlock

> Maintained per Chrome's agentic extension workflow: every permission and
> data practiceotype listed here must match `manifest.json` + PRIVACY.md.
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
| declarativeNetRequest | Enforces the built-in ad/tracker domain blocklist before requests leave the browser. |
| declarativeNetRequestFeedback | Counts blocked requests locally for the toolbar badge counter. Read-only, on-device, nothing transmitted. |
| Host: youtube.com, youtube-nocookie.com | Block ads and apply playback enhancements on YouTube pages. |
| Host: googlesyndication.com, doubleclick.net, googleadservices.com | Block ad and tracker requests. |
| Host: sponsor.ajayyy.com | Fetch crowdsourced sponsor-skip timestamps when that feature is enabled. |
| storage | Stores user toggles and block counters locally via chrome.storage. Never transmitted. |
| Remote code | None — all JavaScript ships inside the package. Only third-party data fetched is SponsorBlock skip timestamps (plain JSON numbers), never code. |

## Data disclosure

- Transmitted off-device: current YouTube **video ID → sponsor.ajayyy.com** (sponsor-skip, on by default, untick for fully offline).
- Everything else (toggles, counters, EQ curves): `chrome.storage` only.
- Policy URL: https://github.com/9M2PJU/trueblock-youtube-adblocker/blob/main/PRIVACY.md

## Review history

- CWS: host-permission permissions trimmed (removed unused googlevideo + google-analytics) to shrink review surface; manifest description cut to 106 chars (132 limit).
- AMO: `web-ext lint` 0 errors; gecko ID + data_collection_permissions declared; Android allowed.

## Pre-submit checklist

- [ ] `manifest.json` version bumped + README changelog entry
- [ ] `web-ext lint` 0 errors (Firefox) / headless load clean (Chrome)
- [ ] Permission list above still matches `manifest.json` exactly
- [ ] Screenshots current (no dashboard/placeholder shots)
- [ ] Release zips rebuilt via `build.sh`-equivalent zip commands
