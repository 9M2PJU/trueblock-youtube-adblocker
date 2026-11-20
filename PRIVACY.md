# Privacy Policy — TrueBlock for YouTube

**Effective:** November 2026 · **Owner:** 9M2PJU ([hamradio.my](https://hamradio.my))

## Short version

TrueBlock runs entirely on your device. It has no accounts, no analytics,
no telemetry, and no servers of its own. Settings stay in your browser's
`chrome.storage` and never leave it.

## The exceptions: SponsorBlock + RYD lookups (on by default)

To skip in-video sponsor segments privately, the extension hashes the current
YouTube video ID locally with SHA-256 and sends only the first **4 hex
characters** of that hash to the public SponsorBlock API (`sponsor.ajayyy.com`)
to fetch community-submitted skip times. Your exact watched video ID is never
transmitted to SponsorBlock. Turn the feature off in the popup to go fully
offline; the ad blocker and all other features keep working without it.

To restore dislike counts, the extension sends the **current YouTube
video ID** to the public Return YouTube Dislike API
(`returnyoutubedislikeapi.com`) to fetch crowdsourced like/dislike totals.
Plain JSON counts come back, no code is executed, and nothing else is
transmitted. Turn it off in the popup to go fully offline.

## Permissions — why each is needed

- **YouTube hosts** (`youtube.com`, `youtube-nocookie.com`): blocking ads and
  applying playback enhancements on YouTube pages.
- **SponsorBlock API host** (`sponsor.ajayyy.com`): fetching skip segments by
  4-char hash prefix.
- **RYD API host** (`returnyoutubedislikeapi.com`): fetching dislike counts.
- **declarativeNetRequest**: enforcing the built-in YouTube-scoped network
  blocklist (ad trackers like `doubleclick.net` / `googlesyndication.com` are
  blocked strictly for YouTube initiators without requiring broad host access).
- **storage**: saving your toggles and counters locally.
- **alarms**: resetting the daily session counter.

## Contact

Issues or questions: [GitHub](https://github.com/9M2PJU/trueblock-youtube-adblocker) ·
[hamradio.my](https://hamradio.my)
