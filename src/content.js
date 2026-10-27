/* TrueBlock content.js — runs in ISOLATED world at document_start.
 * Fast video-ad skipper + DOM cleaner + anti-adblock bypass.
 */
(() => {
  'use strict';
  if (window.__trueblock_content) return;
  window.__trueblock_content = true;

  const DEFAULTS = {
    enabled: true,
    blockVideoAds: true,
    blockBanners: true,
    blockSponsored: true,
    blockShortsAds: true,
    antiAdblock: true
  };
  let settings = { ...DEFAULTS };
  try {
    chrome.storage.sync.get(DEFAULTS, (v) => { settings = { ...DEFAULTS, ...v }; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    });
  } catch { /* storage may be unavailable very early */ }

  let blockedCount = 0;
  const reportBlocked = (n = 1) => {
    blockedCount += n;
    try { chrome.runtime.sendMessage({ type: 'tb-blocked', count: n }).catch(() => {}); }
    catch { try { chrome.runtime.sendMessage({ type: 'tb-blocked', count: n }); } catch {} }
  };

  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button-modern',
    'button[class*="skip-ad"]',
    '.ytp-ad-skip-button-container button'
  ];
  const OVERLAY_CLOSE = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-button-modern',
    'button.ytp-ad-button'
  ];
  const AD_PLAYER_SELECTORS = [
    '.html5-video-player.ad-showing',
    '.html5-video-player.ad-interrupting',
    '#player-ads',
    '.ytp-ad-player-overlay'
  ];

  function clickIfPresent(selectors) {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        try {
          if (el && el.offsetParent !== null) {
            el.click();
            // also dispatch pointer events for hardened buttons
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            reportBlocked(1);
            return true;
          }
        } catch { /* ignore */ }
      }
    }
    return false;
  }

  function playerIsShowingAd(player) {
    return player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
  }

  function skipVideoAds() {
    if (!settings.enabled || !settings.blockVideoAds) return;
    try {
      const videos = document.querySelectorAll('video.video-stream.html5-main-video, video.html5-main-video');
      let skipping = false;
      for (const video of videos) {
        const player = video.closest('.html5-video-player') || document.getElementById('movie_player');
        if (!playerIsShowingAd(player)) continue;
        skipping = true;
        try {
          // Mute + max speed so any unskippable ad burns through in ms
          video.muted = true;
          video.volume = 0;
          try { video.playbackRate = 16; } catch { try { video.playbackRate = 8; } catch {} }
          // Seek to end — this ends >95% of pre/mid/post-rolls instantly
          const dur = video.duration;
          if (Number.isFinite(dur) && dur > 0) {
            if (video.currentTime < dur - 0.15) {
              try { video.currentTime = dur - 0.05; } catch {}
              try { video.currentTime = dur; } catch {}
            }
          }
          // Fire ended event as a backstop for players waiting on it
          if (video.currentTime >= (dur || 0) - 0.2) {
            try { video.dispatchEvent(new Event('ended')); } catch {}
          }
          try { video.play().catch(() => {}); } catch {}
        } catch { /* never break playback */ }
      }
      // Click skip / close buttons whenever they exist
      if (clickIfPresent(SKIP_SELECTORS)) skipping = true;
      if (clickIfPresent(OVERLAY_CLOSE)) skipping = true;

      // Hide ad frame flash
      document.documentElement.classList.toggle('tb-skipping-ad', skipping);

      // Try the player's own API as a last resort
      if (skipping) {
        try {
          const mp = document.getElementById('movie_player');
          if (mp) {
            if (typeof mp.skipAd === 'function') { try { mp.skipAd(); } catch {} }
            else if (typeof mp.nextVideo === 'function' && mp.classList && mp.classList.contains('ad-interrupting') && mp.getDuration && mp.getCurrentTime) {
              // do NOT auto-next real content; only used when duration is an ad stub
            }
          }
        } catch {}
        reportBlocked(1);
      }
    } catch { /* ignore */ }
  }

  const BANNER_SELECTORS = [
    '#player-ads', '#masthead-ad',
    'ytd-ad-slot-renderer', 'ytd-display-ad-renderer',
    'ytd-promoted-video-renderer', 'ytd-compact-promoted-video-renderer',
    'ytd-action-companion-ad-renderer', 'ytd-promoted-sparkles-web-renderer',
    'ytd-masthead-ad-v3-renderer', 'ytd-video-masthead-ad-v3-renderer',
    'ytd-in-feed-ad-layout-renderer',
    '.ytp-ad-player-overlay', '.ytp-ad-text-overlay', '.ytp-ad-overlay-container',
    '.ytp-ad-image-overlay', 'ytd-player-ads'
  ];

  function removeBanners(root = document) {
    if (!settings.enabled) return;
    try {
      if (settings.blockBanners || settings.blockSponsored) {
        for (const sel of BANNER_SELECTORS) {
          let nodes;
          try { nodes = root.querySelectorAll ? root.querySelectorAll(sel) : []; } catch { continue; }
          for (const n of nodes) {
            // Never remove the main video container itself
            if (n.id === 'movie_player' || n.id === 'player') continue;
            try {
              // Sponsored toggle: only remove promoted renderers when enabled
              const html = (n.tagName || '').toLowerCase();
              const isSponsored = html.includes('promoted') || html.includes('in-feed-ad');
              if (isSponsored && !settings.blockSponsored) continue;
              n.remove();
              reportBlocked(1);
            } catch { try { n.style.display = 'none'; } catch {} }
          }
        }
      }
      // Sponsored Shorts: auto-advance past "Sponsored" shorts
      if (settings.blockShortsAds && location.pathname.startsWith('/shorts')) {
        try {
          const badge = document.querySelector('ytd-reel-video-renderer[is-active] [class*="sponsor"], ytd-reel-video-renderer[is-active] span:has(+ *)');
          const active = document.querySelector('ytd-reel-video-renderer[is-active]');
          if (active && /sponsored/i.test(active.textContent.slice(0, 500))) {
            const nextBtn = document.querySelector('#navigation-button-down button, ytd-shorts #navigation-button-down button');
            if (nextBtn) { nextBtn.click(); reportBlocked(1); }
          }
        } catch {}
      }
    } catch { /* ignore */ }
  }

  function bypassAntiAdblock() {
    if (!settings.enabled || !settings.antiAdblock) return;
    try {
      // YouTube's "Ad blockers are not allowed" enforcement dialog
      const dialogs = document.querySelectorAll('tp-yt-paper-dialog, ytd-enforcement-message-view-model, yt-playability-error-supported-renderers');
      for (const d of dialogs) {
        try {
          const text = (d.textContent || '').slice(0, 600);
          if (/ad[\s-]?block/i.test(text) && (/not allowed|violat|disable|allow ads|whitelist/i.test(text) || d.tagName.toLowerCase().includes('enforcement'))) {
            // Unblock the player first, then remove the nag
            try {
              const mp = document.getElementById('movie_player');
              if (mp && typeof mp.playVideo === 'function') mp.playVideo();
              const v = document.querySelector('video.html5-main-video');
              if (v) { try { v.play().catch(() => {}); } catch {} }
            } catch {}
            try { d.remove(); reportBlocked(1); } catch { d.style.display = 'none'; }
            // Remove modal backdrop
            for (const b of document.querySelectorAll('tp-yt-iron-overlay-backdrop.opened')) {
              try { b.remove(); } catch { b.style.display = 'none'; }
            }
            document.body.style.overflow = '';
          }
        } catch {}
      }
      // Player blocked overlay variant
      try {
        const errSub = document.querySelector('.ytp-error-content, .ytp-player-content.ytp-error');
        if (errSub && /ad[\s-]?block/i.test((errSub.textContent || '').slice(0, 400))) {
          const v = document.querySelector('video.html5-main-video');
          if (v) {
            const src = v.src;
            // force reload of the video element without full page reload
            if (src) { try { v.load(); v.play().catch(() => {}); } catch {} }
          }
        }
      } catch {}
    } catch { /* ignore */ }
  }

  // High-frequency fast path for video ads (every animation frame, throttled internally)
  let lastSkip = 0;
  function fastLoop(ts) {
    try {
      if (ts - lastSkip > 50) { // ~20 checks/sec: fast enough to catch 6s bumpers instantly
        lastSkip = ts;
        skipVideoAds();
      }
    } catch {}
    requestAnimationFrame(fastLoop);
  }

  // Observed DOM path for banners / dialogs (debounced)
  let pending = false;
  function scheduleSweep() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      try {
        removeBanners(document);
        bypassAntiAdblock();
        skipVideoAds();
      } catch {}
    });
  }

  function start() {
    try {
      skipVideoAds();
      removeBanners(document);
      bypassAntiAdblock();
      requestAnimationFrame(fastLoop);
      // 500ms interval backstop for SPA navigations where rAF throttles in background
      setInterval(() => { try { skipVideoAds(); bypassAntiAdblock(); } catch {} }, 500);
      // Slower cosmetic sweep
      setInterval(() => { try { removeBanners(document); } catch {} }, 1500);

      const obs = new MutationObserver((mutations) => {
        // Fast-path: if any added node looks ad-related, sweep immediately
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length) { scheduleSweep(); return; }
          if (m.type === 'attributes' && m.target && m.target.classList &&
            (m.target.classList.contains('ad-showing') || m.target.classList.contains('ad-interrupting'))) {
            skipVideoAds();
            return;
          }
        }
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'src', 'href']
      });

      // YouTube SPA navigation: re-sweep on URL change
      let lastUrl = location.href;
      setInterval(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          try { skipVideoAds(); removeBanners(document); bypassAntiAdblock(); } catch {}
        }
      }, 800);

      document.addEventListener('yt-navigate-finish', () => {
        try { skipVideoAds(); removeBanners(document); bypassAntiAdblock(); } catch {}
      });
    } catch { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    // still start early — video ads can appear before DOMContentLoaded
    start();
  } else {
    start();
  }
})();
