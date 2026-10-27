// TrueBlock background service worker (MV3 module)
const DEFAULTS = {
  enabled: true,
  blockVideoAds: true,
  blockBanners: true,
  blockSponsored: true,
  blockShortsAds: true,
  antiAdblock: true
};

let sessionBlocked = 0;
let totalBlocked = 0;

try {
  chrome.storage.local.get({ totalBlocked: 0 }, (v) => {
    totalBlocked = v.totalBlocked || 0;
    updateBadge();
  });
} catch {}

function updateBadge() {
  try {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      const enabled = (s && 'enabled' in s) ? s.enabled : true;
      if (!enabled) {
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#888888' });
        return;
      }
      const label = sessionBlocked > 999 ? `${Math.floor(sessionBlocked / 1000)}k` : `${sessionBlocked}`;
      chrome.action.setBadgeText({ text: sessionBlocked > 0 ? label : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#e62117' });
    });
  } catch {}
}

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'tb-blocked') {
      const n = Math.min(Math.max(1, msg.count | 0 || 1), 50);
      sessionBlocked += n;
      totalBlocked += n;
      try { chrome.storage.local.set({ totalBlocked }); } catch {}
      updateBadge();
    }
    if (msg && msg.type === 'tb-get-stats') {
      sendResponse({ sessionBlocked, totalBlocked });
      return true;
    }
    if (msg && msg.type === 'tb-reset-session') {
      sessionBlocked = 0;
      updateBadge();
      sendResponse({ ok: true });
      return true;
    }
  });
} catch {}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) updateBadge();
  });
} catch {}

// Reset session counter daily
try {
  chrome.alarms.create('tb-daily-reset', { periodInMinutes: 60 * 24 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === 'tb-daily-reset') {
      sessionBlocked = 0;
      updateBadge();
    }
  });
} catch {}

// Count network-level blocks from declarativeNetRequest as well
try {
  if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      sessionBlocked += 1;
      totalBlocked += 1;
      try { chrome.storage.local.set({ totalBlocked }); } catch {}
      updateBadge();
    });
  }
} catch {}

// SponsorBlock API proxy: content scripts fetch with the page's origin and get
// CORS-blocked, so the worker (covered by host_permissions) fetches instead.
const SB_API = 'https://sponsor.ajayyy.com/api/skipSegments';
const sbCache = new Map(); // "videoID|cat1,cat2" -> segs
async function sbFetch(videoID, cats) {
  const key = `${videoID}|${cats.join(',')}`;
  if (sbCache.has(key)) return sbCache.get(key);
  let segs = [];
  try {
    const url = `${SB_API}?videoID=${encodeURIComponent(videoID)}&categories=${encodeURIComponent(JSON.stringify(cats))}&actionTypes=${encodeURIComponent(JSON.stringify(['skip']))}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          segs = data
            .filter((d) => d && Array.isArray(d.segment) && Number.isFinite(d.segment[0]) && Number.isFinite(d.segment[1]))
            .map((d) => ({ cat: d.category, start: d.segment[0], end: d.segment[1] }))
            .sort((a, b) => a.start - b.start);
        }
      }
    } catch {
      segs = []; // 404 (no segments), offline, timeout — fail open
    } finally {
      clearTimeout(timer);
    }
  } catch {
    segs = [];
  }
  sbCache.set(key, segs);
  if (sbCache.size > 60) {
    const first = sbCache.keys().next().value;
    sbCache.delete(first);
  }
  return segs;
}
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'tb-sb-fetch' && typeof msg.videoID === 'string') {
      const cats = Array.isArray(msg.categories) ? msg.categories.filter((c) => typeof c === 'string') : [];
      sbFetch(msg.videoID.slice(0, 32), cats.slice(0, 12)).then((segs) => {
        try { sendResponse({ segs }); } catch {}
      });
      return true; // async response
    }
  });
} catch {}

updateBadge();
