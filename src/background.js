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

updateBadge();
