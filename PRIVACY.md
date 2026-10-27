# Privacy Policy — TrueBlock for YouTube

**Effective:** October 2026 · **Owner:** 9M2PJU ([hamradio.my](https://hamradio.my))

## Short version

TrueBlock runs entirely on your device. It has no accounts, no analytics,
no telemetry, and no servers of its own. Settings stay in your browser's
`chrome.storage` and never leave it.

## The one exception: SponsorBlock lookups (on by default)

To skip in-video sponsor segments, the extension sends the **current YouTube
video ID** to the public SponsorBlock API (`sponsor.ajayyy.com`) to fetch
community-submitted skip times. Nothing else is transmitted — no identity,
no history, no cookies. Turn the feature off in the popup to go fully
offline; the ad blocker and all other features keep working without it.

## Permissions — why each is needed

- **Ad/tracker hosts** (`youtube.com`, `googlevideo.com`, `googlesyndication.com`,
  `doubleclick.net`, `googleadservices.com`): blocking ad and tracking requests.
- **SponsorBlock API host** (`sponsor.ajayyy.com`): fetching skip segments.
- **declarativeNetRequest**: enforcing the network blocklist.
- **storage**: saving your toggles and counters locally.
- **alarms**: resetting the daily session counter.

## Contact

Issues or questions: [GitHub](https://github.com/9M2PJU/trueblock-youtube-adblocker) ·
[hamradio.my](https://hamradio.my)
