/* TrueBlock inject.js — runs in MAIN world at document_start.
 * Strips ads from YouTube player responses before the player ever sees them.
 * No remote code, no data collection.
 */
(() => {
  'use strict';
  if (window.__trueblock_injected) return;
  window.__trueblock_injected = true;

  const AD_KEYS = new Set([
    'adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams',
    'adVideoId', 'adCpn', 'adLogData'
  ]);

  function cleanPlayerResponse(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return obj;
    try {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          if (obj[i] && typeof obj[i] === 'object') cleanPlayerResponse(obj[i], depth + 1);
        }
        return obj;
      }
      for (const k of AD_KEYS) {
        if (k in obj) {
          try { delete obj[k]; } catch { obj[k] = undefined; }
        }
      }
      // streamingData.adaptiveFormats / formats can embed ad markers — leave video formats alone
      // messaging / overlays that force ad UI
      if (obj.playerAds !== undefined) delete obj.playerAds;
      if (obj.adPlacements !== undefined) delete obj.adPlacements;
      if (obj.adSlots !== undefined) delete obj.adSlots;

      for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (v && typeof v === 'object') cleanPlayerResponse(v, depth + 1);
      }
    } catch { /* never break playback */ }
    return obj;
  }

  function looksLikePlayerResponse(text) {
    // cheap pre-check before expensive JSON.parse
    return text.length > 200 &&
      (text.includes('adPlacements') || text.includes('playerAds')) &&
      (text.includes('streamingData') || text.includes('videoDetails') || text.includes('playabilityStatus'));
  }

  function cleanJsonText(text) {
    try {
      if (!looksLikePlayerResponse(text)) return text;
      const parsed = JSON.parse(text);
      cleanPlayerResponse(parsed);
      return JSON.stringify(parsed);
    } catch {
      return text;
    }
  }

  // 1) Patch JSON.parse — catches ytInitialPlayerResponse assignments
  try {
    const origParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      try {
        if (typeof text === 'string' && looksLikePlayerResponse(text)) {
          const parsed = origParse.call(this, text, reviver);
          return cleanPlayerResponse(parsed);
        }
      } catch { /* fall through */ }
      return origParse.call(this, text, reviver);
    };
    JSON.parse.toString = origParse.toString.bind(origParse);
  } catch { /* ignore */ }

  // 2) Patch fetch — strips /youtubei/v1/player, /next, /browse, /search ad payloads
  try {
    const origFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isPlayerApi = typeof url === 'string' && (
        url.includes('/youtubei/v1/player') ||
        url.includes('/youtubei/v1/next') ||
        url.includes('/youtubei/v1/browse') ||
        url.includes('/youtubei/v1/search') ||
        url.includes('/youtubei/v1/guide')
      );
      const resp = await origFetch.apply(this, arguments);
      if (!isPlayerApi) return resp;
      try {
        const clone = resp.clone();
        const text = await clone.text();
        if (!looksLikePlayerResponse(text) && !text.includes('adSlotRenderer') && !text.includes('promotedVideoRenderer')) {
          return resp;
        }
        const cleaned = cleanJsonText(text);
        return new Response(cleaned, {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers
        });
      } catch {
        return resp;
      }
    };
  } catch { /* ignore */ }

  // 3) Patch XHR — older YouTube ad calls still use XHR
  try {
    const OrigXHR = window.XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url, ...rest) {
      try { this.__tb_url = typeof url === 'string' ? url : String(url); } catch { this.__tb_url = ''; }
      return origOpen.call(this, method, url, ...rest);
    };
    const origResponseText = Object.getOwnPropertyDescriptor(OrigXHR.prototype, 'responseText');
    OrigXHR.prototype.send = function (...args) {
      this.addEventListener('readystatechange', function () {
        // no-op: cleaning happens via responseText getter below
      });
      return origSend.apply(this, args);
    };
    if (origResponseText && origResponseText.get) {
      Object.defineProperty(OrigXHR.prototype, 'responseText', {
        get: function () {
          try {
            const val = origResponseText.get.call(this);
            const url = this.__tb_url || '';
            if (typeof val === 'string' && val.length > 200 &&
              (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next')) &&
              looksLikePlayerResponse(val)) {
              return cleanJsonText(val);
            }
            return val;
          } catch {
            return origResponseText.get.call(this);
          }
        },
        configurable: true,
        enumerable: true
      });
    }
    // Block known ad beacons at the XHR layer as a backstop to DNR
    const origOpen2 = OrigXHR.prototype.open;
    OrigXHR.prototype.open = function (method, url, ...rest) {
      try {
        const u = String(url);
        if (u.includes('/api/stats/ads') || u.includes('/pagead/') || u.includes('/ptracking') || u.includes('doubleclick.net') || u.includes('/get_midroll_')) {
          this.__tb_blocked = true;
          // redirect to a harmless same-origin no-op (keep trailing args intact
          // so the async flag stays correct), only swapping method + URL
          return origOpen2.call(this, 'GET', 'about:blank', ...rest);
        }
      } catch { /* ignore */ }
      return origOpen2.call(this, method, url, ...rest);
    };
  } catch { /* ignore */ }

  // 4) Scrub ytInitialPlayerResponse / ytInitialData globals as early as possible
  function scrubGlobals() {
    try {
      if (window.ytInitialPlayerResponse) cleanPlayerResponse(window.ytInitialPlayerResponse);
      // ytInitialData carries promoted/sponsored renderers for home/search
      if (window.ytInitialData) cleanPlayerResponse(window.ytInitialData);
    } catch { /* ignore */ }
  }
  scrubGlobals();
  document.addEventListener('DOMContentLoaded', scrubGlobals, { once: true });

  // 5) Neutralize YouTube's adblock-detection config flags where present.
  // Seed from any value already assigned — replacing the property must not
  // lose the current player response for page scripts reading it.
  try {
    const existing = window.ytInitialPlayerResponse;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() { return this.__tb_playerResponse; },
      set(v) {
        try { this.__tb_playerResponse = cleanPlayerResponse(v); }
        catch { this.__tb_playerResponse = v; }
      }
    });
    if (existing !== undefined) {
      try { window.ytInitialPlayerResponse = cleanPlayerResponse(existing); }
      catch { try { window.__tb_playerResponse = existing; } catch {} }
    }
  } catch {
    // property may be non-configurable on some navigations; scrubGlobals covers it
  }
})();
