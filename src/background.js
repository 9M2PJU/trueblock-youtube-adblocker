// TrueBlock background service worker (MV3 module)
'use strict';

const sessionStore = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session)
  ? chrome.storage.session
  : chrome.storage?.local;

let sessionBlocked = 0;
let totalBlocked = 0;
let isEnabled = true;

function storageGet(area, defaults) {
  return new Promise((resolve) => {
    try {
      if (!area) { resolve(defaults); return; }
      area.get(defaults, (v) => {
        void chrome.runtime?.lastError;
        resolve(v || defaults);
      });
    } catch {
      resolve(defaults);
    }
  });
}

function storageSet(area, obj) {
  return new Promise((resolve) => {
    try {
      if (!area) { resolve(); return; }
      area.set(obj, () => {
        void chrome.runtime?.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function syncRuleset(enabled) {
  try {
    if (!chrome.declarativeNetRequest?.updateEnabledRulesets) return;
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      enabled ? { enableRulesetIds: ['block_ads'] } : { disableRulesetIds: ['block_ads'] }
    );
  } catch {}
}

function updateBadge() {
  try {
    if (!isEnabled) {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#888888' });
      return;
    }
    const label = sessionBlocked > 999 ? `${Math.floor(sessionBlocked / 1000)}k` : `${sessionBlocked}`;
    chrome.action.setBadgeText({ text: sessionBlocked > 0 ? label : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e62117' });
  } catch {}
}

let persistTimer = 0;
async function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = 0;
  }
  updateBadge();
  await Promise.all([
    storageSet(chrome.storage.local, { totalBlocked }),
    storageSet(sessionStore, { sessionBlocked })
  ]);
}

function schedulePersist() {
  updateBadge();
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = 0;
    flushPersist();
  }, 300);
}

// Serialize initial load so MV3 worker cold-starts never overwrite stored totals.
const ready = (async () => {
  const [loc, ses, syn] = await Promise.all([
    storageGet(chrome.storage.local, { totalBlocked: 0 }),
    storageGet(sessionStore, { sessionBlocked: 0 }),
    storageGet(chrome.storage.sync, { enabled: true })
  ]);
  totalBlocked = Number.isFinite(loc.totalBlocked) ? loc.totalBlocked : 0;
  sessionBlocked = Number.isFinite(ses.sessionBlocked) ? ses.sessionBlocked : 0;
  isEnabled = (syn && 'enabled' in syn) ? !!syn.enabled : true;
  await syncRuleset(isEnabled);
  updateBadge();
})();

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) {
      isEnabled = !!changes.enabled.newValue;
      syncRuleset(isEnabled);
      updateBadge();
    }
  });
} catch {}

// Reset session counter daily (do not reset alarm timer on every worker wakeup).
try {
  if (chrome.alarms?.get) {
    chrome.alarms.get('tb-daily-reset', (existing) => {
      void chrome.runtime?.lastError;
      if (!existing) {
        try { chrome.alarms.create('tb-daily-reset', { periodInMinutes: 60 * 24 }); } catch {}
      }
    });
  } else {
    chrome.alarms?.create('tb-daily-reset', { periodInMinutes: 60 * 24 });
  }
  chrome.alarms?.onAlarm.addListener((a) => {
    if (a.name === 'tb-daily-reset') {
      ready.then(async () => {
        sessionBlocked = 0;
        await flushPersist();
      });
    }
  });
} catch {}

// SponsorBlock k-anonymous hash-prefix API proxy (4-hex-char SHA-256 prefix).
const SB_API = 'https://sponsor.ajayyy.com/api/skipSegments/';
const SB_TTL_MS = 15 * 60 * 1000;
const sbCache = new Map(); // "videoID|cat1,cat2" -> { at, segs }

async function sha256Prefix(text, hexLen = 4) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < Math.ceil(hexLen / 2); i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.slice(0, hexLen);
}

async function sbFetch(videoID, cats) {
  const key = `${videoID}|${cats.join(',')}`;
  const cached = sbCache.get(key);
  if (cached && Date.now() - cached.at < SB_TTL_MS) {
    return { ok: true, segs: cached.segs };
  }
  let ok = false;
  let segs = [];
  try {
    const prefix = await sha256Prefix(videoID, 4);
    const url = `${SB_API}${prefix}?categories=${encodeURIComponent(JSON.stringify(cats))}&actionTypes=${encodeURIComponent(JSON.stringify(['skip']))}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 404) {
        ok = true;
        segs = [];
      } else if (res.ok) {
        const data = await res.json();
        ok = true;
        if (Array.isArray(data)) {
          const match = data.find((d) => d && d.videoID === videoID);
          const rawSegs = match && Array.isArray(match.segments) ? match.segments : [];
          segs = rawSegs
            .filter((d) => d && Array.isArray(d.segment) && Number.isFinite(d.segment[0]) && Number.isFinite(d.segment[1]) && d.segment[1] > d.segment[0])
            .map((d) => ({ cat: d.category, start: d.segment[0], end: d.segment[1] }))
            .sort((a, b) => a.start - b.start);
        }
      }
    } catch {
      ok = false;
      segs = [];
    } finally {
      clearTimeout(timer);
    }
  } catch {
    ok = false;
    segs = [];
  }
  if (ok) {
    sbCache.set(key, { at: Date.now(), segs });
    if (sbCache.size > 60) {
      const first = sbCache.keys().next().value;
      sbCache.delete(first);
    }
  }
  return { ok, segs };
}

// Return YouTube Dislike proxy: page-origin fetches are CORS-limited, so the
// worker (covered by host_permissions) fetches instead. Fail-open cache.
const RYD_API = 'https://returnyoutubedislikeapi.com/votes?videoId=';
const rydCache = new Map(); // videoID -> { at, likes, dislikes }

async function rydFetch(videoID) {
  const cached = rydCache.get(videoID);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
  let out = { likes: null, dislikes: null };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`${RYD_API}${encodeURIComponent(videoID)}`, { signal: ctl.signal });
      if (res.ok) {
        const data = await res.json();
        if (data && Number.isFinite(data.likes) && Number.isFinite(data.dislikes)) {
          out = { likes: data.likes, dislikes: data.dislikes };
        }
      }
    } catch {
      // offline / timeout / unknown video — fail open
    } finally {
      clearTimeout(timer);
    }
  } catch {}
  if (out.likes !== null) {
    rydCache.set(videoID, { at: Date.now(), ...out });
    if (rydCache.size > 100) {
      const first = rydCache.keys().next().value;
      rydCache.delete(first);
    }
    return rydCache.get(videoID);
  }
  return out;
}

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'tb-blocked') {
      ready.then(() => {
        const n = Math.min(Math.max(1, msg.count | 0 || 1), 50);
        sessionBlocked += n;
        totalBlocked += n;
        schedulePersist();
      });
      return;
    }
    if (msg.type === 'tb-get-stats') {
      ready.then(() => {
        try { sendResponse({ sessionBlocked, totalBlocked }); } catch {}
      });
      return true;
    }
    if (msg.type === 'tb-reset-session') {
      ready.then(async () => {
        sessionBlocked = 0;
        await flushPersist();
        try { sendResponse({ ok: true }); } catch {}
      });
      return true;
    }
    if (msg.type === 'tb-sb-fetch' && typeof msg.videoID === 'string') {
      const cats = Array.isArray(msg.categories) ? msg.categories.filter((c) => typeof c === 'string') : [];
      sbFetch(msg.videoID.slice(0, 32), cats.slice(0, 12)).then((res) => {
        try { sendResponse(res); } catch {}
      });
      return true;
    }
    if (msg.type === 'tb-ryd-fetch' && typeof msg.videoID === 'string' && msg.videoID) {
      rydFetch(msg.videoID.slice(0, 32)).then((v) => {
        try { sendResponse(v); } catch {}
      });
      return true;
    }
  });
} catch {}
