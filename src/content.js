/* TrueBlock content.js — runs in ISOLATED world at document_start.
 * Event-driven video-ad skipper + DOM cleaner + anti-adblock bypass + MAIN bridge.
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

  function syncDomFlags() {
    try {
      const root = document.documentElement;
      if (root) {
        const en = !!settings.enabled;
        root.classList.toggle('tb-enabled', en);
        root.classList.toggle('tb-block-banners', en && !!settings.blockBanners);
        root.classList.toggle('tb-block-sponsored', en && !!settings.blockSponsored);
        root.classList.toggle('tb-anti-adblock', en && !!settings.antiAdblock);
      }
      window.dispatchEvent(new CustomEvent('tb-config', { detail: JSON.stringify(settings) }));
    } catch {}
  }

  function sendPlayerCmd(payload) {
    try {
      window.dispatchEvent(new CustomEvent('tb-player-cmd', { detail: JSON.stringify(payload) }));
    } catch {}
  }

  let blockedCount = 0;
  const reportBlocked = (n = 1) => {
    const k = Math.min(Math.max(1, n | 0 || 1), 50);
    blockedCount += k;
    try { chrome.runtime.sendMessage({ type: 'tb-blocked', count: k }).catch(() => {}); }
    catch { try { chrome.runtime.sendMessage({ type: 'tb-blocked', count: k }); } catch {} }
  };

  try {
    syncDomFlags();
    chrome.storage.sync.get(DEFAULTS, (v) => {
      settings = { ...DEFAULTS, ...v };
      syncDomFlags();
      try { skipVideoAds(); removeBanners(document); bypassAntiAdblock(); } catch {}
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
      syncDomFlags();
      if (!settings.enabled || !settings.blockVideoAds) {
        stopAdLoop();
        restoreAdState();
        document.documentElement?.classList.remove('tb-skipping-ad');
      }
    });
  } catch { /* storage may be unavailable very early */ }

  try {
    window.addEventListener('tb-main-blocked', (e) => {
      const n = parseInt(e.detail, 10);
      if (Number.isFinite(n) && n > 0) reportBlocked(n);
    });
  } catch {}

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
    '.ytp-ad-overlay-close-button-modern'
  ];

  function clickIfPresent(selectors) {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        try {
          if (el && el.offsetParent !== null) {
            el.click();
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

  // Stash of pre-ad playback state so mid-rolls never strand 16x/muted.
  const adStash = new Map(); // video -> { rate, muted, volume }
  function restoreAdState() {
    if (!adStash.size) return;
    for (const [video, st] of adStash) {
      try {
        if (!video.isConnected) { adStash.delete(video); continue; }
        const player = video.closest('.html5-video-player');
        if (playerIsShowingAd(player)) continue;
        try { if (video.playbackRate > 4) video.playbackRate = st.rate || 1; } catch {}
        try {
          if (video.muted && video.volume === 0) {
            video.muted = !!st.muted;
            video.volume = st.volume;
          }
        } catch {}
      } catch {}
      adStash.delete(video);
    }
  }

  function isAdActive() {
    return !!document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
  }

  function skipVideoAds() {
    if (!settings.enabled || !settings.blockVideoAds) {
      document.documentElement?.classList.remove('tb-skipping-ad');
      return false;
    }
    try {
      const adActive = isAdActive();
      if (!adActive) {
        restoreAdState();
        document.documentElement?.classList.remove('tb-skipping-ad');
        return false;
      }
      const videos = document.querySelectorAll('video.video-stream.html5-main-video, video.html5-main-video, ytd-reel-video-renderer video, #shorts-player video');
      let skipping = false;
      for (const video of videos) {
        const player = video.closest('.html5-video-player') || document.getElementById('movie_player');
        if (!playerIsShowingAd(player)) continue;
        skipping = true;
        try {
          if (!adStash.has(video)) {
            try {
              adStash.set(video, {
                rate: (Number.isFinite(video.playbackRate) && video.playbackRate <= 4) ? video.playbackRate : 1,
                muted: video.muted,
                volume: video.volume
              });
            } catch { adStash.set(video, { rate: 1, muted: true, volume: 0 }); }
          }
          video.muted = true;
          video.volume = 0;
          try { video.playbackRate = 16; } catch { try { video.playbackRate = 8; } catch {} }
          const dur = video.duration;
          if (Number.isFinite(dur) && dur > 0 && video.currentTime < dur - 0.15) {
            try { video.currentTime = dur - 0.05; } catch {}
            try { video.currentTime = dur; } catch {}
          }
          try { video.play().catch(() => {}); } catch {}
        } catch { /* never break playback */ }
      }
      if (clickIfPresent(SKIP_SELECTORS)) skipping = true;
      document.documentElement?.classList.toggle('tb-skipping-ad', skipping);
      if (skipping) {
        sendPlayerCmd({ action: 'skipAd' });
        reportBlocked(1);
      }
      return true;
    } catch { return false; }
  }

  const BANNER_SELECTORS = [
    '#player-ads', '#masthead-ad',
    'ytd-ad-slot-renderer', 'ytd-display-ad-renderer',
    'ytd-promoted-video-renderer', 'ytd-compact-promoted-video-renderer',
    'ytd-action-companion-ad-renderer', 'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-masthead-ad-v3-renderer', 'ytd-video-masthead-ad-v3-renderer',
    'ytd-in-feed-ad-layout-renderer',
    '.ytp-ad-player-overlay', '.ytp-ad-text-overlay', '.ytp-ad-overlay-container',
    '.ytp-ad-image-overlay', 'ytd-player-ads'
  ];

  function removeBanners(root = document) {
    if (!settings.enabled) return;
    try {
      if (settings.blockBanners) {
        clickIfPresent(OVERLAY_CLOSE);
      }
      if (settings.blockBanners || settings.blockSponsored) {
        for (const sel of BANNER_SELECTORS) {
          let nodes;
          try { nodes = root.querySelectorAll ? root.querySelectorAll(sel) : []; } catch { continue; }
          for (const n of nodes) {
            if (n.id === 'movie_player' || n.id === 'player') continue;
            try {
              const html = (n.tagName || '').toLowerCase();
              const isSponsored = html.includes('promoted') || html.includes('in-feed-ad') || html === 'ytd-ad-slot-renderer';
              if (isSponsored && !settings.blockSponsored) continue;
              if (!isSponsored && !settings.blockBanners) continue;
              n.remove();
              reportBlocked(1);
            } catch { try { n.style.display = 'none'; } catch {} }
          }
        }
      }
      // Sponsored Shorts: auto-advance past "Sponsored" shorts
      if (settings.blockShortsAds && location.pathname.startsWith('/shorts')) {
        try {
          const active = document.querySelector('ytd-reel-video-renderer[is-active]');
          if (active) {
            const badge = active.querySelector('[overlay-style="SPONSORED"], .badge-style-type-ad, ytd-badge-supported-renderer');
            const badgeText = (badge ? badge.textContent : '') || '';
            const fullText = active.textContent || '';
            const isAd = /sponsor/i.test(badgeText) || /sponsored/i.test(fullText.slice(0, 4000));
            const now = Date.now();
            if (isAd && (now - (removeBanners.__tb_shortsAt || 0) > 1000)) {
              removeBanners.__tb_shortsAt = now;
              const nextBtn = document.querySelector('#navigation-button-down button, ytd-shorts #navigation-button-down button, button[aria-label="Next"]');
              if (nextBtn) { nextBtn.click(); reportBlocked(1); }
            }
          }
        } catch {}
      }
    } catch { /* ignore */ }
  }

  function bypassAntiAdblock() {
    if (!settings.enabled || !settings.antiAdblock) return;
    try {
      const dialogs = document.querySelectorAll('tp-yt-paper-dialog, ytd-enforcement-message-view-model, yt-playability-error-supported-renderers');
      for (const d of dialogs) {
        try {
          const text = (d.textContent || '').slice(0, 600);
          if (/ad[\s-]?block/i.test(text) && (/not allowed|violat|disable|allow ads|whitelist/i.test(text) || d.tagName.toLowerCase().includes('enforcement'))) {
            sendPlayerCmd({ action: 'playVideo' });
            const v = document.querySelector('video.html5-main-video');
            if (v) { try { v.play().catch(() => {}); } catch {} }
            try { d.remove(); reportBlocked(1); } catch { d.style.display = 'none'; }
            for (const b of document.querySelectorAll('tp-yt-iron-overlay-backdrop.opened')) {
              try { b.remove(); } catch { b.style.display = 'none'; }
            }
            document.body.style.overflow = '';
          }
        } catch {}
      }
      try {
        const errSub = document.querySelector('.ytp-error-content, .ytp-player-content.ytp-error');
        if (errSub && /ad[\s-]?block/i.test((errSub.textContent || '').slice(0, 400))) {
          const v = document.querySelector('video.html5-main-video');
          if (v && v.src) {
            try { v.load(); v.play().catch(() => {}); } catch {}
          }
        }
      } catch {}
    } catch { /* ignore */ }
  }

  // Event-driven rAF ad-skipper: spins ONLY while an ad is actively showing.
  let adRaf = 0;
  let lastSkip = 0;
  function adTick(ts) {
    adRaf = 0;
    let keepRunning = false;
    try {
      if (settings.enabled && settings.blockVideoAds && isAdActive()) {
        if (ts - lastSkip >= 50) {
          lastSkip = ts;
          skipVideoAds();
        }
        keepRunning = isAdActive();
      }
      if (!keepRunning) {
        restoreAdState();
        document.documentElement?.classList.remove('tb-skipping-ad');
      }
    } catch {}
    if (keepRunning) adRaf = requestAnimationFrame(adTick);
  }
  function startAdLoop() {
    if (!adRaf && settings.enabled && settings.blockVideoAds && isAdActive()) {
      adRaf = requestAnimationFrame(adTick);
    }
  }
  function stopAdLoop() {
    if (adRaf) {
      cancelAnimationFrame(adRaf);
      adRaf = 0;
    }
  }

  let sweepTimer = 0;
  function scheduleSweep() {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = 0;
      try {
        removeBanners(document);
        bypassAntiAdblock();
        if (skipVideoAds()) startAdLoop();
      } catch {}
    }, 150);
  }

  let lastUrl = location.href;
  function emitNav() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      try { window.dispatchEvent(new CustomEvent('tb-nav')); } catch {}
      scheduleSweep();
    }
  }

  function start() {
    if (start.done) return;
    start.done = true;
    try {
      syncDomFlags();
      if (skipVideoAds()) startAdLoop();
      removeBanners(document);
      bypassAntiAdblock();

      // Low-frequency backstop for background tabs / missed mutations
      setInterval(() => {
        try {
          emitNav();
          if (skipVideoAds()) startAdLoop();
          bypassAntiAdblock();
          removeBanners(document);
        } catch {}
      }, 1500);

      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length) {
            if (isAdActive() && skipVideoAds()) startAdLoop();
            scheduleSweep();
            return;
          }
          if (m.type === 'attributes' && m.target && m.target.classList &&
            (m.target.classList.contains('ad-showing') || m.target.classList.contains('ad-interrupting'))) {
            if (skipVideoAds()) startAdLoop();
            return;
          }
        }
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });

      window.addEventListener('popstate', emitNav);
      document.addEventListener('yt-navigate-finish', () => {
        lastUrl = location.href;
        try { window.dispatchEvent(new CustomEvent('tb-nav')); } catch {}
        scheduleSweep();
      });
    } catch { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    start();
  } else {
    start();
  }
})();
