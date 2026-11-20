/* TrueBlock inject.js — runs in MAIN world at document_start.
 * Strips ads from YouTube player responses and handles MAIN-world player API commands.
 * No remote code, no data collection.
 */
(() => {
  'use strict';
  if (window.__trueblock_injected) return;
  window.__trueblock_injected = true;

  let tbEnabled = true;
  let tbBlockVideoAds = true;
  let tbBlockSponsored = true;
  try {
    if (sessionStorage.getItem('__tb_enabled') === '0') tbEnabled = false;
    if (sessionStorage.getItem('__tb_block_video') === '0') tbBlockVideoAds = false;
    if (sessionStorage.getItem('__tb_block_sponsored') === '0') tbBlockSponsored = false;
  } catch {}

  const VIDEO_AD_KEYS = new Set([
    'adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams',
    'adVideoId', 'adCpn', 'adLogData', 'reelAds', 'shortsAds'
  ]);
  const SPONSORED_KEYS = new Set([
    'adSlotRenderer', 'promotedVideoRenderer', 'compactPromotedVideoRenderer',
    'promotedSparklesWebRenderer', 'promotedSparklesTextSearchRenderer',
    'displayAdRenderer', 'inFeedAdLayoutRenderer', 'actionCompanionAdRenderer',
    'mastheadAdV3Renderer', 'videoMastheadAdV3Renderer'
  ]);

  function isAdArrayItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    for (const k of SPONSORED_KEYS) {
      if (k in item) return true;
    }
    const ric = item.richItemRenderer && item.richItemRenderer.content;
    if (ric && typeof ric === 'object') {
      for (const k of SPONSORED_KEYS) {
        if (k in ric) return true;
      }
    }
    return false;
  }

  function cleanPlayerResponse(obj, depth = 0, stats = null) {
    if (!tbEnabled || !obj || typeof obj !== 'object' || depth > 14) return obj;
    try {
      if (Array.isArray(obj)) {
        let write = 0;
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          if (tbBlockSponsored && isAdArrayItem(item)) {
            if (stats) stats.count++;
            continue;
          }
          if (item && typeof item === 'object') cleanPlayerResponse(item, depth + 1, stats);
          obj[write++] = item;
        }
        if (write !== obj.length) obj.length = write;
        return obj;
      }
      if (tbBlockVideoAds) {
        for (const k of VIDEO_AD_KEYS) {
          if (k in obj) {
            if (stats) stats.count++;
            try { delete obj[k]; } catch { obj[k] = undefined; }
          }
        }
      }
      if (tbBlockSponsored) {
        for (const k of SPONSORED_KEYS) {
          if (k in obj) {
            if (stats) stats.count++;
            try { delete obj[k]; } catch { obj[k] = undefined; }
          }
        }
      }

      for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (v && typeof v === 'object') cleanPlayerResponse(v, depth + 1, stats);
      }
    } catch { /* never break playback */ }
    return obj;
  }

  function reportMainBlocked(n) {
    if (!n || n <= 0) return;
    try {
      window.dispatchEvent(new CustomEvent('tb-main-blocked', { detail: String(Math.min(n, 5)) }));
    } catch {}
  }

  function looksLikePlayerResponse(text) {
    // cheap pre-check before expensive JSON.parse
    if (typeof text !== 'string' || text.length <= 200) return false;
    const hasVideoAds = tbBlockVideoAds && (
      text.includes('adPlacements') || text.includes('playerAds') ||
      text.includes('adSlots') || text.includes('reelAds') || text.includes('shortsAds')
    );
    const hasSponsored = tbBlockSponsored && (
      text.includes('adSlotRenderer') || text.includes('promotedVideoRenderer') ||
      text.includes('displayAdRenderer') || text.includes('inFeedAdLayoutRenderer') ||
      text.includes('promotedSparkles') || text.includes('mastheadAdV3Renderer')
    );
    if (!hasVideoAds && !hasSponsored) return false;
    return text.includes('streamingData') || text.includes('videoDetails') ||
      text.includes('playabilityStatus') || text.includes('contents') ||
      text.includes('reel') || text.includes('shorts');
  }

  function cleanJsonText(text) {
    try {
      if (!tbEnabled || !looksLikePlayerResponse(text)) return text;
      const parsed = JSON.parse(text);
      const stats = { count: 0 };
      cleanPlayerResponse(parsed, 0, stats);
      reportMainBlocked(stats.count);
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
        if (tbEnabled && typeof text === 'string' && looksLikePlayerResponse(text)) {
          const parsed = origParse.call(this, text, reviver);
          const stats = { count: 0 };
          const cleaned = cleanPlayerResponse(parsed, 0, stats);
          reportMainBlocked(stats.count);
          return cleaned;
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
        url.includes('/youtubei/v1/guide') ||
        url.includes('/youtubei/v1/reel/') ||
        url.includes('/youtubei/v1/shorts/')
      );
      const resp = await origFetch.apply(this, arguments);
      if (!tbEnabled || !isPlayerApi) return resp;
      try {
        const clone = resp.clone();
        const text = await clone.text();
        if (!looksLikePlayerResponse(text)) return resp;
        const cleaned = cleanJsonText(text);
        const headers = new Headers(resp.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(cleaned, {
          status: resp.status,
          statusText: resp.statusText,
          headers
        });
      } catch {
        return resp;
      }
    };
  } catch { /* ignore */ }

  // 3) Patch XHR — clean player/next/reel JSON and drop ad beacons without about:blank CORS errors
  try {
    const OrigXHR = window.XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    const origResponseText = Object.getOwnPropertyDescriptor(OrigXHR.prototype, 'responseText');

    OrigXHR.prototype.open = function (method, url, ...rest) {
      let u = '';
      try { u = typeof url === 'string' ? url : String(url); } catch {}
      this.__tb_url = u;
      this.__tb_blocked = tbEnabled && tbBlockVideoAds && (
        u.includes('/api/stats/ads') ||
        u.includes('/pagead/') ||
        u.includes('/ptracking') ||
        u.includes('doubleclick.net') ||
        u.includes('/get_midroll_')
      );
      if (this.__tb_blocked) return;
      return origOpen.call(this, method, url, ...rest);
    };

    OrigXHR.prototype.send = function (...args) {
      if (this.__tb_blocked) {
        reportMainBlocked(1);
        try {
          Object.defineProperties(this, {
            readyState: { value: 4, configurable: true },
            status: { value: 200, configurable: true },
            statusText: { value: 'OK', configurable: true },
            responseText: { value: '', configurable: true },
            response: { value: '', configurable: true }
          });
        } catch {}
        queueMicrotask(() => {
          try {
            this.dispatchEvent(new Event('readystatechange'));
            this.dispatchEvent(new ProgressEvent('load'));
            this.dispatchEvent(new ProgressEvent('loadend'));
          } catch {}
        });
        return;
      }
      return origSend.apply(this, args);
    };

    if (origResponseText && origResponseText.get) {
      Object.defineProperty(OrigXHR.prototype, 'responseText', {
        get: function () {
          try {
            const val = origResponseText.get.call(this);
            const url = this.__tb_url || '';
            if (tbEnabled && typeof val === 'string' && val.length > 200 &&
              (url.includes('/youtubei/v1/player') || url.includes('/youtubei/v1/next') || url.includes('/youtubei/v1/reel/') || url.includes('/youtubei/v1/browse')) &&
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
  } catch { /* ignore */ }

  // 4) Scrub ytInitialPlayerResponse / ytInitialData globals as early as possible
  function scrubGlobals() {
    if (!tbEnabled) return;
    try {
      const stats = { count: 0 };
      if (window.ytInitialPlayerResponse) cleanPlayerResponse(window.ytInitialPlayerResponse, 0, stats);
      if (window.ytInitialData) cleanPlayerResponse(window.ytInitialData, 0, stats);
      reportMainBlocked(stats.count);
    } catch { /* ignore */ }
  }
  scrubGlobals();
  try {
    document.addEventListener('DOMContentLoaded', scrubGlobals, { once: true });
  } catch {}

  // 5) Intercept ytInitialPlayerResponse assignment
  try {
    const existing = window.ytInitialPlayerResponse;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() { return this.__tb_playerResponse; },
      set(v) {
        try {
          if (!tbEnabled) { this.__tb_playerResponse = v; return; }
          const stats = { count: 0 };
          this.__tb_playerResponse = cleanPlayerResponse(v, 0, stats);
          reportMainBlocked(stats.count);
        } catch {
          this.__tb_playerResponse = v;
        }
      }
    });
    if (existing !== undefined) {
      window.ytInitialPlayerResponse = existing;
    }
  } catch {
    // property may be non-configurable on some navigations; scrubGlobals covers it
  }

  // 6) Sync config from ISOLATED world (JSON string avoids Firefox Xray restrictions)
  try {
    window.addEventListener('tb-config', (e) => {
      try {
        const cfg = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
        if (!cfg || typeof cfg !== 'object') return;
        if ('enabled' in cfg) tbEnabled = !!cfg.enabled;
        if ('blockVideoAds' in cfg) tbBlockVideoAds = !!cfg.blockVideoAds;
        if ('blockSponsored' in cfg) tbBlockSponsored = !!cfg.blockSponsored;
        try {
          sessionStorage.setItem('__tb_enabled', tbEnabled ? '1' : '0');
          sessionStorage.setItem('__tb_block_video', tbBlockVideoAds ? '1' : '0');
          sessionStorage.setItem('__tb_block_sponsored', tbBlockSponsored ? '1' : '0');
        } catch {}
        if (tbEnabled) scrubGlobals();
      } catch {}
    });
  } catch {}

  // 7) Execute MAIN-world player API calls requested by ISOLATED content scripts
  const QUALITY_ORDER = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  try {
    window.addEventListener('tb-player-cmd', (e) => {
      try {
        const cmd = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
        if (!cmd || typeof cmd !== 'object') return;
        const mp = document.getElementById('movie_player');
        if (cmd.action === 'setQuality' && mp) {
          const want = cmd.quality || 'hd1080';
          let target = want;
          try {
            if (typeof mp.getAvailableQualityLevels === 'function') {
              const avail = mp.getAvailableQualityLevels();
              if (Array.isArray(avail) && avail.length) {
                const wantIdx = QUALITY_ORDER.indexOf(want);
                const pick = avail.find((q) => {
                  const qi = QUALITY_ORDER.indexOf(q);
                  return qi !== -1 && (wantIdx === -1 || qi >= wantIdx);
                });
                if (pick) target = pick;
              }
            }
          } catch {}
          try {
            if (typeof mp.getPlaybackQuality === 'function' && mp.getPlaybackQuality() === target) return;
          } catch {}
          try { if (typeof mp.setPlaybackQualityRange === 'function') mp.setPlaybackQualityRange(target, target); } catch {}
          try { if (typeof mp.setPlaybackQuality === 'function') mp.setPlaybackQuality(target); } catch {}
        } else if (cmd.action === 'setAutonav' && mp) {
          const en = !!cmd.enabled;
          try {
            if (typeof mp.setAutonav === 'function') mp.setAutonav(en);
            else if (typeof mp.setAutonavState === 'function') mp.setAutonavState(en ? 2 : 1);
          } catch {}
        } else if (cmd.action === 'patchYouthere') {
          const w = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
          if (w && !w.__tb_patched && typeof w.youthereDataChanged_ === 'function') {
            w.__tb_origYouthere = w.youthereDataChanged_;
            w.youthereDataChanged_ = function () {};
            w.__tb_patched = true;
          }
        } else if (cmd.action === 'skipAd' && mp) {
          try { if (typeof mp.skipAd === 'function') mp.skipAd(); } catch {}
        } else if (cmd.action === 'playVideo' && mp) {
          try { if (typeof mp.playVideo === 'function') mp.playVideo(); } catch {}
        }
      } catch {}
    });
  } catch {}
})();
