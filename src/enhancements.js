/* TrueBlock enhancements.js — optional YouTube enhancements (ISOLATED world).
 *
 * Lean native re-implementation inspired by YouTube-Enhancer/extension (MIT):
 *   https://github.com/YouTube-Enhancer/extension
 * No upstream code is copied — only the same public DOM/player tricks:
 * theater via .ytp-size-button, autoplay via .ytp-autonav-toggle,
 * continue-watching via ytd-watch-flexy youthereDataChanged_ + confirm click,
 * quality via #movie_player.setPlaybackQualityRange, volume/speed via <video>.
 */
(() => {
  'use strict';
  if (window.__trueblock_enh) return;
  window.__trueblock_enh = true;

  const DEFAULTS = {
    enabled: true,
    enhTheater: false,
    enhAutoplayOff: false,
    enhRememberVolume: true,
    enhQuality: false,
    enhQualityValue: 'hd1080',
    enhSkipContinue: true,
    enhRememberSpeed: false
  };
  let s = { ...DEFAULTS };
  try {
    chrome.storage.sync.get(DEFAULTS, (v) => { s = { ...DEFAULTS, ...v }; });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(ch)) s[k] = ch[k].newValue;
    });
  } catch {}

  const on = () => s.enabled;
  const player = () => document.querySelector('#movie_player');
  const isWatch = () => location.pathname === '/watch';
  const isTheater = () => {
    const grid = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    return !!grid && grid.hasAttribute('theater');
  };

  /* 1) Automatic theater mode — click .ytp-size-button, throttled 1s like upstream */
  let lastTheaterClick = 0;
  function theaterSweep() {
    if (!on() || !s.enhTheater || !isWatch()) return;
    try {
      if (isTheater()) return;
      if (Date.now() - lastTheaterClick < 1000) return;
      const btn = document.querySelector('button.ytp-size-button');
      if (!btn || btn.offsetParent === null) return;
      lastTheaterClick = Date.now();
      btn.click();
    } catch {}
  }

  /* 2) Disable autoplay — click toggle off, respect real user clicks for the session */
  let userChoseAutoplay = false;
  let lastAutoplayClick = 0;
  try {
    document.addEventListener('click', (e) => {
      try {
        if (e.isTrusted && e.target && e.target.closest && e.target.closest('.ytp-autonav-toggle')) {
          userChoseAutoplay = true;
        }
      } catch {}
    }, true);
  } catch {}
  function autoplaySweep() {
    if (!on() || !s.enhAutoplayOff || !isWatch() || userChoseAutoplay) return;
    try {
      const toggle = document.querySelector('.ytp-autonav-toggle');
      if (!toggle) return;
      const checked = toggle.getAttribute('aria-checked') === 'true';
      if (!checked) return;
      if (Date.now() - lastAutoplayClick < 1000) return;
      if (toggle.style.display === 'none' || getComputedStyle(toggle).display === 'none') {
        // Folded toggle is inert — use player API like upstream does
        const p = player();
        try {
          if (p && typeof p.setAutonav === 'function') { p.setAutonav(false); return; }
          if (p && typeof p.setAutonavState === 'function') { p.setAutonavState(1); return; }
        } catch {}
        return;
      }
      lastAutoplayClick = Date.now();
      toggle.click();
    } catch {}
  }

  /* 3) Remember volume — save on change, restore on new video */
  let savedVolume = null, savedMuted = false;
  try { chrome.storage.local.get({ tbVolume: null, tbMuted: false }, (v) => { savedVolume = v.tbVolume; savedMuted = !!v.tbMuted; }); } catch {}
  try {
    document.addEventListener('volumechange', (e) => {
      try {
        if (!on() || !s.enhRememberVolume) return;
        const v = e.target;
        if (!(v instanceof HTMLVideoElement) || !v.classList.contains('html5-main-video')) return;
        const p = v.closest('.html5-video-player');
        if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return;
        savedVolume = v.volume;
        savedMuted = v.muted;
        chrome.storage.local.set({ tbVolume: v.volume, tbMuted: v.muted });
      } catch {}
    }, true);
  } catch {}
  function volumeSweep() {
    if (!on() || !s.enhRememberVolume || savedVolume === null) return;
    try {
      const v = document.querySelector('video.html5-main-video');
      if (!v) return;
      if (Math.abs(v.volume - savedVolume) > 0.01) { try { v.volume = savedVolume; } catch {} }
      if (v.muted !== savedMuted && !v.closest('.html5-video-player.ad-showing')) { try { v.muted = savedMuted; } catch {} }
    } catch {}
  }

  /* 4) Preferred quality — setPlaybackQualityRange with retries after navigation */
  let qualityTries = 0, lastQualityUrl = '';
  function qualitySweep() {
    if (!on() || !s.enhQuality || !isWatch()) return;
    try {
      if (location.href !== lastQualityUrl) { lastQualityUrl = location.href; qualityTries = 0; }
      if (qualityTries > 10) return;
      const p = player();
      if (!p || typeof p.setPlaybackQualityRange !== 'function' || typeof p.getPlaybackQuality !== 'function') { qualityTries++; return; }
      const want = s.enhQualityValue || 'hd1080';
      let cur = null;
      try { cur = p.getPlaybackQuality(); } catch {}
      if (cur === want) { qualityTries = 11; return; }
      qualityTries++;
      try { p.setPlaybackQualityRange(want, want); } catch {}
      try { if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(want); } catch {}
    } catch {}
  }

  /* 5) Skip "Video paused. Continue watching?" — patch youthereDataChanged_ + click Yes */
  function patchYouthere() {
    try {
      const w = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
      if (w && !w.__tb_patched && typeof w.youthereDataChanged_ === 'function') {
        w.__tb_origYouthere = w.youthereDataChanged_;
        w.youthereDataChanged_ = function () {};
        w.__tb_patched = true;
      }
    } catch {}
  }
  function continueSweep() {
    if (!on() || !s.enhSkipContinue) return;
    try {
      patchYouthere();
      const dlg = document.querySelector('yt-confirm-dialog-renderer');
      if (dlg && /continue watching|video (is )?paused/i.test(dlg.textContent.slice(0, 300))) {
        const yes = dlg.querySelector('#confirm-button button, yt-button-renderer#confirm-button button, button[aria-label*="Yes"]');
        if (yes) { try { yes.click(); } catch {} }
      }
    } catch {}
  }

  /* 6) Remember playback speed — save/restore, never fight the ad-skipper's 16x */
  let savedSpeed = 1;
  try { chrome.storage.local.get({ tbSpeed: 1 }, (v) => { savedSpeed = v.tbSpeed || 1; }); } catch {}
  try {
    document.addEventListener('ratechange', (e) => {
      try {
        if (!on() || !s.enhRememberSpeed) return;
        const v = e.target;
        if (!(v instanceof HTMLVideoElement)) return;
        const p = v.closest('.html5-video-player');
        if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return;
        if (v.playbackRate > 0 && v.playbackRate <= 4) {
          savedSpeed = v.playbackRate;
          chrome.storage.local.set({ tbSpeed: v.playbackRate });
        }
      } catch {}
    }, true);
  } catch {}
  function speedSweep() {
    if (!on() || !s.enhRememberSpeed || !savedSpeed || savedSpeed === 1) return;
    try {
      const v = document.querySelector('video.html5-main-video');
      if (!v) return;
      const p = v.closest('.html5-video-player');
      if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return;
      if (Math.abs(v.playbackRate - savedSpeed) > 0.01) { try { v.playbackRate = savedSpeed; } catch {} }
    } catch {}
  }

  function sweep() {
    try {
      theaterSweep();
      autoplaySweep();
      volumeSweep();
      qualitySweep();
      continueSweep();
      speedSweep();
    } catch {}
  }

  setInterval(sweep, 1000);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      userChoseAutoplay = false;
      qualityTries = 0;
      setTimeout(sweep, 500);
      setTimeout(sweep, 2000);
    }
  }, 800);
  try {
    document.addEventListener('yt-navigate-finish', () => {
      userChoseAutoplay = false;
      qualityTries = 0;
      setTimeout(sweep, 500);
    });
  } catch {}
  setTimeout(sweep, 1500);
})();
