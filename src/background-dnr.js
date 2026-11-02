// TrueBlock background-dnr.js — Chrome-only network-block counting.
//
// Packaged in the Chrome zip and loaded via importScripts() from
// background.js (same worker global scope: sessionBlocked, totalBlocked
// and updateBadge() come from there). Excluded from the Firefox package
// because Firefox never implemented declarativeNetRequest.onRuleMatchedDebug;
// the import fails there by design and is caught by the caller.
try {
  if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(() => {
      sessionBlocked += 1;
      totalBlocked += 1;
      try { chrome.storage.local.set({ totalBlocked }); } catch {}
      updateBadge();
    });
  }
} catch {}
