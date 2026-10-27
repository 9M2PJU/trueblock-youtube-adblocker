/* TrueBlock enhancements.js — optional YouTube enhancements (ISOLATED world).
 *
 * Lean native re-implementation inspired by YouTube-Enhancer/extension (MIT):
 *   https://github.com/YouTube-Enhancer/extension
 * No upstream code is copied — only the same public DOM/player tricks:
 * theater via .ytp-size-button, autoplay via .ytp-autonav-toggle,
 * continue-watching via ytd-watch-flexy youthereDataChanged_ + confirm click,
 * quality via #movie_player.setPlaybackQualityRange, volume/speed via <video>,
 * hide-shorts via body-class CSS, remaining-time via .ytp-time-contents span,
 * shorts-autoscroll via ended -> #navigation-button-down click,
 * loop via video.loop toggle, timestamp via youtu.be clipboard copy,
 * screenshot via canvas drawImage + download, volume-boost via WebAudio gain,
 * distractions via CSS (.ytp-ce-element, #chat, paid overlay).
 */
(() => {
  'use strict';
  if (window.__trueblock_enh) return;
  window.__trueblock_enh = true;

  const DEFAULTS = {
    enabled: true,
    enhTheater: false,    enhAutoplayOff: false,
    enhRememberVolume: true,
    enhQuality: false,
    enhQualityValue: 'hd1080',
    enhSkipContinue: true,
    enhRememberSpeed: false,
    enhHideShorts: false,
    enhVolumeBoost: false,
    enhBoostValue: '2',
    enhEQ: false,
    enhEqPreset: 'flat',
    enhEqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    enhEqPreamp: '0',
    enhEqQ: 'normal',
    enhLimiter: true,
    enhSpectrum: false,
    enhScreenshot: false,
    enhPlayerButtons: false,
    enhHideDistractions: false,
    enhRemaining: false,
    enhShortsScroll: false,
    enhTheme: false,
    enhThemePreset: 'pure-black',
    enhAccent: '',
    enhSeekButtons: false,
    enhSeekSecs: '10',
    enhSpeedButtons: false,
    enhWheelVolume: false,
    enhHideClutter: false,
    enhPerRow: false,
    enhPerRowValue: '4',
    enhLinkFix: false
  };
  let s = { ...DEFAULTS };
  try {
    chrome.storage.sync.get(DEFAULTS, (v) => { s = { ...DEFAULTS, ...v }; });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(ch)) s[k] = ch[k].newValue;
      try { setTimeout(sweep, 0); } catch {} // apply toggle changes immediately
    });
  } catch {}

  const on = () => s.enabled;
  const player = () => document.querySelector('#movie_player');
  const isWatch = () => location.pathname === '/watch';
  const isTheater = () => {
    const grid = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    return !!grid && grid.hasAttribute('theater');
  };

  /* 1) Automatic theater mode — the toggle is the source of truth, both ways.
   * ON: YouTube is put into theater. OFF: YouTube is kept out of theater.
   * Enforced every sweep (throttled) so SPA navigations and YouTube's own
   * remembered preference can't drift away from the setting. */
  let lastTheaterClick = 0;
  function theaterSweep() {
    if (!isWatch()) return;
    const wantTheater = on() && s.enhTheater;
    try {
      if (isTheater() === wantTheater) return;
      if (Date.now() - lastTheaterClick < 1000) return;
      const btn = document.querySelector('button.ytp-size-button');
      if (!btn || btn.offsetParent === null) return;
      lastTheaterClick = Date.now();
      btn.click();
    } catch {}
  }

  /* 2) Disable autoplay — the toggle is the source of truth, both ways.
   * ON: autoplay is forced off (your in-player clicks still win for the video).
   * OFF: if WE turned it off, it is restored — unticking never strands you
   * with a dead Up-Next. Manual player clicks always clear our claim. */
  let userChoseAutoplay = false;
  let lastAutoplayClick = 0;
  let autoplayTouched = false;
  try {
    document.addEventListener('click', (e) => {
      try {
        if (e.isTrusted && e.target && e.target.closest && e.target.closest('.ytp-autonav-toggle')) {
          userChoseAutoplay = true;
          autoplayTouched = false; // user's own click wins from here on
        }
      } catch {}
    }, true);
  } catch {}
  function setAutoplayOff(toggle) {
    if (toggle.style.display === 'none' || getComputedStyle(toggle).display === 'none') {
      // Folded toggle is inert — use player API like upstream does
      const p = player();
      try {
        if (p && typeof p.setAutonav === 'function') { p.setAutonav(false); autoplayTouched = true; return true; }
        if (p && typeof p.setAutonavState === 'function') { p.setAutonavState(1); autoplayTouched = true; return true; }
      } catch {}
      return false;
    }
    lastAutoplayClick = Date.now();
    toggle.click();
    autoplayTouched = true;
    return true;
  }
  function setAutoplayOn(toggle) {
    if (toggle.style.display === 'none' || getComputedStyle(toggle).display === 'none') {
      const p = player();
      try {
        if (p && typeof p.setAutonav === 'function') { p.setAutonav(true); return true; }
        if (p && typeof p.setAutonavState === 'function') { p.setAutonavState(2); return true; }
      } catch {}
      return false;
    }
    lastAutoplayClick = Date.now();
    toggle.click();
    return true;
  }
  function autoplaySweep() {
    if (!on() || !isWatch()) return;
    try {
      const toggle = document.querySelector('.ytp-autonav-toggle');
      if (!toggle) return;
      const checked = toggle.getAttribute('aria-checked') === 'true';
      if (s.enhAutoplayOff && !userChoseAutoplay) {
        if (!checked) return;
        if (Date.now() - lastAutoplayClick < 1000) return;
        setAutoplayOff(toggle);
        return;
      }
      // Setting off (or master off): restore only if we were the ones who killed it.
      if (!s.enhAutoplayOff && autoplayTouched && !checked) {
        if (Date.now() - lastAutoplayClick < 1000) return;
        if (setAutoplayOn(toggle)) autoplayTouched = false;
      }
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

  /* 4) Preferred quality — the toggle is the source of truth.
   * Re-applied every sweep while enabled, so neither YouTube's auto pick nor
   * mid-video changes can drift away from the setting. */
  function qualitySweep() {
    if (!on() || !s.enhQuality || !isWatch()) return;
    try {
      const p = player();
      if (!p || typeof p.setPlaybackQualityRange !== 'function' || typeof p.getPlaybackQuality !== 'function') return;
      const want = s.enhQualityValue || 'hd1080';
      let cur = null;
      try { cur = p.getPlaybackQuality(); } catch {}
      if (cur === want) return;
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
      shortsCssSweep();
      distractionsCssSweep();
      boostSweep();
      eqSweep();
      limiterSweep();
      if (!specRAF) { try { specRAF = requestAnimationFrame(spectrumTick); } catch {} }
      buttonsSweep();
      remainingSweep();
      shortsScrollSweep();
      themeSweep();
      seekSpeedSweep();
      clutterSweep();
      perRowSweep();
      linkFixSweep();
    } catch {}
  }

  /* 7) Hide Shorts everywhere — same selectors as upstream hideShorts/index.css */
  const SHORTS_CSS = `
html.tb-hide-shorts ytd-guide-entry-renderer:has(a[title="Shorts"]),
html.tb-hide-shorts ytd-mini-guide-entry-renderer:has(a[title="Shorts"]){display:none!important}
html.tb-hide-shorts ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has([is-shorts]){display:none!important}
html.tb-hide-shorts ytd-reel-shelf-renderer:has(#title-container),
html.tb-hide-shorts ytd-rich-shelf-renderer:has([is-shorts]),
html.tb-hide-shorts yt-tab-shape[tab-title="Shorts"]{display:none!important}
html.tb-hide-shorts ytd-video-renderer:has([overlay-style="SHORTS"]){display:none!important}
html.tb-hide-shorts ytd-watch-next-secondary-results-renderer ytd-reel-shelf-renderer:has(#title-container){display:none!important}
html.tb-hide-shorts a[href^="/shorts/"].yt-simple-endpoint{pointer-events:none}`;
  function shortsCssSweep() {
    try {
      const want = on() && s.enhHideShorts;
      document.documentElement.classList.toggle('tb-hide-shorts', !!want);
      let st = document.getElementById('tb-hide-shorts');
      if (want && !st) {
        st = document.createElement('style');
        st.id = 'tb-hide-shorts';
        st.textContent = SHORTS_CSS;
        (document.head || document.documentElement).appendChild(st);
      } else if (!want && st) {
        st.remove();
      }
      if (want) {
        for (const el of document.querySelectorAll('ytd-rich-shelf-renderer:has([is-shorts]), ytd-reel-shelf-renderer:has(#title-container)')) {
          try {
            const shelf = el.closest('ytd-rich-section-renderer, ytd-item-section-renderer');
            (shelf || el).remove();
          } catch {}
        }
      }
    } catch {}
  }

  /* 8) Hide distractions — end cards, live chat, paid-promo banner */
  const DISTRACT_CSS = `
html.tb-hide-distract .ytp-ce-element,html.tb-hide-distract .ytp-ce-covering-overlay,
html.tb-hide-distract .ytp-endscreen-content,html.tb-hide-distract .ytp-paid-content-overlay,
html.tb-hide-distract #chat,html.tb-hide-distract ytd-live-chat-frame{display:none!important}`;
  function distractionsCssSweep() {
    try {
      const want = on() && s.enhHideDistractions;
      document.documentElement.classList.toggle('tb-hide-distract', !!want);
      let st = document.getElementById('tb-hide-distract');
      if (want && !st) {
        st = document.createElement('style');
        st.id = 'tb-hide-distract';
        st.textContent = DISTRACT_CSS;
        (document.head || document.documentElement).appendChild(st);
      } else if (!want && st) {
        st.remove();
      }
    } catch {}
  }

  /* 9) Unified WebAudio graph — 10-band audiophile EQ + volume boost + limiter,
   * one graph per video element (a second MediaElementSource would break audio):
   * source -> preamp -> 10 biquads -> boost gain -> limiter -> analyser -> out.
   * The analyser is a pass-through tap feeding the spectrum overlay.
   * Disabled stages sit neutral so toggling never rebuilds mid-playback. */
  const EQ_BANDS = [
    { type: 'lowshelf', freq: 31 }, { type: 'peaking', freq: 62 },
    { type: 'peaking', freq: 125 }, { type: 'peaking', freq: 250 },
    { type: 'peaking', freq: 500 }, { type: 'peaking', freq: 1000 },
    { type: 'peaking', freq: 2000 }, { type: 'peaking', freq: 4000 },
    { type: 'peaking', freq: 8000 }, { type: 'highshelf', freq: 16000 }
  ];
  // Preset curves informed by SFX Engine's "7 Best Equalizer Settings for Music":
  // V-shape compensates equal-loudness contours; vocal centers 2.5-3.5kHz presence
  // with 100-250Hz de-mud and 6-8kHz de-ess; bass starts +3..+6dB at 60-120Hz with
  // a 200-400Hz mud cut; treble stays subtle (+2..+4 presence, +1..+2 air);
  // rock pushes 200-500Hz body + 3-5kHz bite. (Values adapted to our ISO bands.)
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [6, 6, 4, 0, -1, 0, 0, 0, 0, 0],
    treble: [0, 0, 0, 0, 0, 0, 2, 3, 2, 1],
    vocal: [-3, -2, -1, 1, 3, 4, 4, 2, -1, -1],
    vshape: [5, 4, 2, 0, -1, -2, -1, 1, 3, 5],
    loudness: [4, 3, 2, 0, 0, 0, 0, 1, 2, 3],
    rock: [2, 4, 2, 3, 1, 0, 1, 4, 2, 1]
  };
  const EQ_NAMES = { flat: 'Flat (neutral)', bass: 'Bass Boost', treble: 'Treble Boost', vocal: 'Vocal', vshape: 'V-Shape', loudness: 'Loudness', rock: 'Rock/Metal', custom: 'Custom' };
  let lastEqKey = '';
  let eqInit = false;
  let eqUnavailableToast = false;
  const audioGraphs = new WeakMap();
  function eqGains() {
    if (!(on() && s.enhEQ)) return EQ_PRESETS.flat;
    if (s.enhEqPreset === 'custom' && Array.isArray(s.enhEqGains) && s.enhEqGains.length === 10) {
      return s.enhEqGains.map((x) => Math.min(12, Math.max(-12, +x || 0)));
    }
    const base = EQ_PRESETS[s.enhEqPreset] || EQ_PRESETS.flat;
    // Dynamic loudness (Fletcher-Munson, per SFX Engine): full curve when quiet,
    // flattening to neutral at full volume — scaled from the live video volume.
    if (s.enhEqPreset === 'loudness') {
      try {
        const vv = document.querySelector('video.html5-main-video');
        const vol = vv && !vv.muted ? vv.volume : 1;
        const k = Math.min(1, Math.max(0, 1 - vol * 1.1));
        return base.map((x) => Math.round(x * k * 2) / 2);
      } catch {}
    }
    return base;
  }
  function ensureAudioGraph(video) {
    let g = audioGraphs.get(video);
    if (g) return g;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      const src = ctx.createMediaElementSource(video);
      const pre = ctx.createGain();
      pre.gain.value = 1;
      const filters = EQ_BANDS.map((b) => {
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.freq;
        f.Q.value = 1;
        f.gain.value = 0;
        return f;
      });
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -3;
      comp.knee.value = 0;
      comp.ratio.value = 20;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -30;
      let node = src;
      node.connect(pre); node = pre;
      for (const f of filters) { node.connect(f); node = f; }
      node.connect(gain);
      gain.connect(comp);
      comp.connect(analyser);
      analyser.connect(ctx.destination);
      g = { ctx, pre, filters, gain, comp, analyser };
      audioGraphs.set(video, g);
    } catch {
      return null; // already routed / unsupported — leave element alone
    }
    return g;
  }
  function boostSweep() {
    try {
      const v = document.querySelector('video.html5-main-video');
      if (!v) return;
      const want = on() && s.enhVolumeBoost ? parseFloat(s.enhBoostValue) || 2 : 1;
      if (want <= 1 && !audioGraphs.get(v)) return; // off + no graph: nothing to do
      const g = ensureAudioGraph(v);
      if (!g) return;
      try {
        if (g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
        if (Math.abs(g.gain.gain.value - want) > 0.01) g.gain.gain.value = want;
      } catch {}
    } catch {}
  }
  function eqSweep() {
    try {
      const enabled = on() && s.enhEQ;
      const gains = eqGains();
      const preDb = enabled ? (Math.min(6, Math.max(-12, +s.enhEqPreamp || 0))) : 0;
      const q = { narrow: 2, normal: 1, wide: 0.5 }[s.enhEqQ] || 1;
      const preGain = Math.pow(10, preDb / 20);
      // Key excludes live gains: dynamic loudness reshapes them on every volume
      // step, which must not re-toast (filters still follow every sweep).
      const key = `${enabled}|${s.enhEqPreset}|${preDb}|${q}`;
      const v = document.querySelector('video.html5-main-video');
      if (!v) return;
      const active = enabled && (gains.some((d) => d !== 0) || preDb !== 0);
      if (!active && !audioGraphs.get(v)) { lastEqKey = key; eqInit = true; return; }
      const g = ensureAudioGraph(v);
      if (!g) {
        if (!eqUnavailableToast) { eqUnavailableToast = true; toast('Equalizer unavailable in this browser'); }
        return;
      }
      try {
        if (g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
        const t = g.ctx.currentTime;
        if (Math.abs(g.pre.gain.value - preGain) > 0.005) g.pre.gain.setTargetAtTime(preGain, t, 0.03);
        for (let i = 0; i < 10; i++) {
          if (Math.abs(g.filters[i].gain.value - gains[i]) > 0.01) {
            g.filters[i].gain.setTargetAtTime(gains[i], t, 0.03);
          }
          if (Math.abs(g.filters[i].Q.value - q) > 0.01) g.filters[i].Q.setTargetAtTime(q, t, 0.03);
        }
        // Self-report on user-driven changes (silent on page load).
        if (key !== lastEqKey) {
          const first = !eqInit;
          lastEqKey = key;
          eqInit = true;
          if (!first && enabled) {
            const peak = Math.max(...gains.map(Math.abs));
            let msg = peak === 0 && preDb === 0
              ? `EQ on (${EQ_NAMES[s.enhEqPreset] || 'Flat'} = neutral — pick Bass/V-Shape to hear it)`
              : `EQ: ${EQ_NAMES[s.enhEqPreset] || s.enhEqPreset} (±${peak} dB, pre ${preDb >= 0 ? '+' : ''}${preDb} dB)`;
            if (g.ctx.state === 'suspended') msg += ' — tap page once to unlock audio';
            toast(msg);
          }
        }
      } catch {}
    } catch {}
  }

  /* 9b) Limiter (clip safety net) + spectrum overlay tap. */
  function limiterSweep() {
    try {
      const v = document.querySelector('video.html5-main-video');
      const g = v ? audioGraphs.get(v) : null;
      if (!g) return;
      const wantOn = on() && s.enhLimiter;
      try {
        if (g.ctx.state === 'suspended') g.ctx.resume().catch(() => {});
        const t = g.ctx.currentTime;
        const th = wantOn ? -3 : 0, ra = wantOn ? 20 : 1;
        if (Math.abs(g.comp.threshold.value - th) > 0.01) g.comp.threshold.setTargetAtTime(th, t, 0.03);
        if (Math.abs(g.comp.ratio.value - ra) > 0.01) g.comp.ratio.setTargetAtTime(ra, t, 0.03);
      } catch {}
    } catch {}
  }
  let specRAF = 0;
  function spectrumTick() {
    specRAF = 0;
    let want = false;
    try {
      const v = on() && s.enhSpectrum ? document.querySelector('video.html5-main-video') : null;
      const g = v ? audioGraphs.get(v) : null;
      const box = v ? v.closest('.html5-video-player') : null;
      let cv = document.getElementById('tb-spectrum');
      if (!g || !box || v.paused || v.muted) {
        if (cv) cv.style.display = 'none';
      } else {
        if (!cv || cv.__tb_box !== box) {
          try { cv?.remove(); } catch {}
          cv = document.createElement('canvas');
          cv.id = 'tb-spectrum';
          cv.width = 132; cv.height = 44;
          cv.__tb_box = box;
          cv.setAttribute('style', 'position:absolute;right:8px;bottom:48px;width:132px;height:44px;z-index:30;pointer-events:none;opacity:.85');
          try {
            if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
            box.appendChild(cv);
          } catch {}
        }
        cv.style.display = 'block';
        try {
          const c2d = cv.getContext('2d');
          const data = new Uint8Array(g.analyser.frequencyBinCount);
          g.analyser.getByteFrequencyData(data);
          const W = cv.width, H = cv.height, N = 28;
          c2d.clearRect(0, 0, W, H);
          const grad = c2d.createLinearGradient(0, H, 0, 0);
          grad.addColorStop(0, '#00adee');
          grad.addColorStop(1, '#e62117');
          c2d.fillStyle = grad;
          for (let i = 0; i < N; i++) {
            const idx = Math.min(data.length - 1, Math.floor(Math.pow(i / N, 1.7) * data.length * 0.72));
            const h = Math.max(1, (data[idx] / 255) * H);
            c2d.fillRect(i * (W / N) + 1, H - h, W / N - 2, h);
          }
        } catch {}
        want = true;
      }
    } catch {}
    if (want) specRAF = requestAnimationFrame(spectrumTick);
  }

  /* 10) Player buttons — loop toggle, copy-timestamp, screenshot */
  function toast(msg) {
    try {
      let t = document.getElementById('tb-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'tb-toast';
        t.setAttribute('style', 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;font:500 13px system-ui;padding:8px 14px;border-radius:8px;z-index:99999;pointer-events:none');
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.display = 'block';
      clearTimeout(t.__tb_timer);
      t.__tb_timer = setTimeout(() => { t.style.display = 'none'; }, 1600);
    } catch {}
  }
  function mkBtn(id, glyph, title) {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'ytp-button tb-enh-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.setAttribute('style', 'font-size:15px;width:36px;opacity:.9');
    b.textContent = glyph;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); handleEnhBtn(id); });
    return b;
  }
  function handleEnhBtn(id) {
    try {
      const v = document.querySelector('video.html5-main-video');
      if (id === 'tb-btn-loop' && v) {
        if (v.hasAttribute('loop')) { v.removeAttribute('loop'); toast('Loop off'); }
        else { v.setAttribute('loop', ''); toast('Loop on'); }
        syncLoopBtn();
      } else if (id === 'tb-btn-stamp') {
        if (!v) return;
        const vid = new URLSearchParams(location.search).get('v') || '';
        const t = Math.floor(v.currentTime);
        const url = `https://youtu.be/${vid}?t=${t}s`;
        try { navigator.clipboard.writeText(url).then(() => toast('Timestamp link copied'), () => toast(url)); }
        catch { toast(url); }
      } else if (id === 'tb-btn-shot') {
        takeScreenshot(v);
      } else if (id === 'tb-btn-rw' || id === 'tb-btn-ff') {
        if (!v) return;
        const secs = parseInt(s.enhSeekSecs, 10) || 10;
        try { v.currentTime = Math.max(0, v.currentTime + (id === 'tb-btn-ff' ? secs : -secs)); } catch {}
      } else if (id === 'tb-btn-sdown' || id === 'tb-btn-sup') {
        if (!v) return;
        const step = id === 'tb-btn-sup' ? 0.25 : -0.25;
        const nr = Math.min(4, Math.max(0.25, Math.round((v.playbackRate + step) * 100) / 100));
        try { v.playbackRate = nr; } catch {}
        toast(`Speed ${nr}×`);
      }
    } catch {}
  }
  function takeScreenshot(v) {
    if (!v || !v.videoWidth) { toast('Video not ready'); return; }
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      if (!ctx) { toast('Screenshot failed'); return; }
      ctx.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        if (!blob) { toast('Screenshot blocked on this video'); return; }
        try {
          const vid = new URLSearchParams(location.search).get('v') || 'video';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `trueblock-${vid}-${Math.floor(v.currentTime)}s.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          toast('Screenshot saved');
        } catch { toast('Screenshot failed'); }
      }, 'image/png');
    } catch { toast('Screenshot blocked on this video'); }
  }
  function syncLoopBtn() {
    try {
      const v = document.querySelector('video.html5-main-video');
      const b = document.getElementById('tb-btn-loop');
      if (b && v) { b.style.opacity = v.hasAttribute('loop') ? '1' : '.9'; b.style.textShadow = v.hasAttribute('loop') ? '0 0 6px #3ea6ff' : 'none'; }
    } catch {}
  }
  function buttonsSweep() {
    try {
      const want = on() && (s.enhPlayerButtons || s.enhScreenshot);
      for (const id of ['tb-btn-loop', 'tb-btn-stamp', 'tb-btn-shot']) {
        const el = document.getElementById(id);
        if (el && !want) el.remove();
      }
      if (!want) return;
      const bar = document.querySelector('.ytp-right-controls');
      if (!bar) return;
      const showLoopStamp = on() && s.enhPlayerButtons;
      const showShot = on() && s.enhScreenshot;
      if (showLoopStamp && !document.getElementById('tb-btn-loop')) bar.prepend(mkBtn('tb-btn-loop', '⟳', 'Loop video'));
      if (showLoopStamp && !document.getElementById('tb-btn-stamp')) {
        const loop = document.getElementById('tb-btn-loop');
        (loop ? loop.after.bind(loop) : bar.prepend.bind(bar))(mkBtn('tb-btn-stamp', '🔗', 'Copy link with timestamp'));
      }
      if (showShot && !document.getElementById('tb-btn-shot')) bar.prepend(mkBtn('tb-btn-shot', '📷', 'Screenshot frame'));
      if (!showLoopStamp) { document.getElementById('tb-btn-loop')?.remove(); document.getElementById('tb-btn-stamp')?.remove(); }
      if (!showShot) document.getElementById('tb-btn-shot')?.remove();
      syncLoopBtn();
    } catch {}
  }

  /* 11) Remaining time — span in .ytp-time-contents, rate-aware like upstream */
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    const parts = d ? [d, h, m, x] : h ? [h, m, x] : [m, x];
    return parts.map((n, i) => i === 0 ? String(n) : String(n).padStart(2, '0')).join(':');
  }
  function remainingSweep() {
    try {
      const want = on() && s.enhRemaining;
      let el = document.getElementById('tb-time-remaining');
      if (!want) { el?.remove(); return; }
      const box = document.querySelector('#movie_player .ytp-time-contents');
      const v = document.querySelector('#movie_player video.html5-main-video');
      if (!box || !v) return;
      if (!el) {
        el = document.createElement('span');
        el.id = 'tb-time-remaining';
        el.setAttribute('style', 'opacity:.85');
        box.appendChild(el);
      }
      if (!Number.isFinite(v.duration) || !Number.isFinite(v.currentTime)) { el.textContent = ''; return; }
      const left = (v.duration - v.currentTime) / (v.playbackRate || 1);
      el.textContent = ` (-${fmtTime(left)})`;
    } catch {}
  }

  /* 12) Shorts auto-scroll — advance on ended (upstream uses timeupdate; ended is cheaper) */
  function shortsScrollSweep() {
    try {
      if (!on() || !s.enhShortsScroll || !location.pathname.startsWith('/shorts')) return;
      const v = document.querySelector('ytd-reel-video-renderer[is-active] video, #shorts-player video');
      if (!v || v.__tb_scrollHooked) return;
      v.__tb_scrollHooked = true;
      v.addEventListener('ended', () => {
        try {
          if (!on() || !s.enhShortsScroll) return;
          if (v.hasAttribute('loop')) return;
          const next = document.querySelector('#navigation-button-down button');
          if (next) next.click();
        } catch {}
      });
    } catch {}
  }

  /* 13) Lite themes v2 — presets mapped onto YouTube's --yt-spec-* vars.
   * Preset colors adapted from RaitaroH's YouTube-DeepDark (via YouTube-Enhancer).
   * Hardened: controls live OUTSIDE labels (no untick hazard), bidirectional
   * enforcement, doubled specificity, direct container fallbacks in case a
   * client ignores the vars, plus a read-back self-check with a warning toast. */
  const THEMES = {
    'pure-black': { name: 'Pure Black', color: '#ffffff', bg: '#000000', second: '#1e1e1e', hover: '#313131', text: '#ffffff', dimmer: '#aaaaaa' },
    'dracula':    { name: 'Dracula', color: '#bd93f9', bg: '#282a36', second: '#2e3140', hover: '#44475a', text: '#f8f8f2', dimmer: '#bcc2cd' },
    'mocha':      { name: 'Catppuccin-Mocha', color: '#cba6f7', bg: '#1e1e2e', second: '#181825', hover: '#313244', text: '#cdd6f4', dimmer: '#a6adc8' },
    'discord':    { name: 'Discord', color: '#7289da', bg: '#1e2124', second: '#2f3136', hover: '#484b51', text: '#ffffff', dimmer: '#ada8aa' },
    'deep-dark':  { name: 'Deep-Dark', color: '#00adee', bg: '#111111', second: '#181818', hover: '#232323', text: '#eff0f1', dimmer: '#cccccc' }
  };
  let lastThemeKey = '';
  let themeWarned = false;
  function themeCss(p, accent) {
    const a = accent || p.color;
    const css = `html.tb-theme.tb-theme{color-scheme:dark;--yt-spec-base-background:${p.bg}!important;--yt-spec-raised-background:${p.second}!important;`
      + `--yt-spec-menu-background:${p.second}!important;--yt-spec-text-primary:${p.text}!important;`
      + `--yt-spec-text-secondary:${p.dimmer}!important;--yt-spec-icon-inactive:${p.dimmer}!important;`
      + `--yt-spec-10-percent-layer:${p.hover}!important;--yt-spec-touch-response:${p.hover}!important;`
      + `--yt-spec-badge-chip-background:${p.hover}!important;--yt-spec-call-to-action:${a}!important;`
      + `--yt-spec-suggested-action:${a}!important;--ytd-searchbox-background:${p.second}!important}`
      + `html.tb-theme.tb-theme body,html.tb-theme.tb-theme ytd-app{background:${p.bg}!important;color:${p.text}!important}`
      + `html.tb-theme.tb-theme ytd-masthead,html.tb-theme.tb-theme #masthead-container{background:${p.second}!important}`
      + `html.tb-theme.tb-theme .ytp-play-progress{background:${a}!important}`
      + `html.tb-theme.tb-theme .ytp-scrubber-button{background:${a}!important}`
      + `html.tb-theme.tb-theme .ytp-volume-slider-handle:before{background:${a}!important}`
      + `html.tb-theme.tb-theme a.yt-simple-endpoint{color:${a}}`;
    return css;
  }
  function themeSweep() {
    try {
      const want = on() && s.enhTheme;
      const root = document.documentElement;
      let st = document.getElementById('tb-theme');
      if (!want) {
        if (st) st.remove();
        root.classList.remove('tb-theme');
        if (root.__tb_darkAdded) { root.removeAttribute('dark'); root.__tb_darkAdded = false; }
        lastThemeKey = '';
        themeWarned = false;
        return;
      }
      const p = THEMES[s.enhThemePreset] || THEMES['pure-black'];
      const accent = /^#[0-9a-fA-F]{6}$/.test(s.enhAccent || '') ? s.enhAccent : '';
      const key = `${s.enhThemePreset}|${accent}`;
      if (!root.hasAttribute('dark')) { root.setAttribute('dark', ''); root.__tb_darkAdded = true; }
      root.classList.add('tb-theme');
      if (!st) {
        st = document.createElement('style');
        st.id = 'tb-theme';
        (document.head || root).appendChild(st);
      }
      if (key !== lastThemeKey) {
        st.textContent = themeCss(p, accent);
        const first = !lastThemeKey;
        lastThemeKey = key;
        themeWarned = false;
        if (!first) toast(`Theme: ${(THEMES[s.enhThemePreset] || {}).name || s.enhThemePreset} applied`);
      }
      // Read-back self-check: is YouTube honoring the override?
      if (!themeWarned && st.isConnected) {
        try {
          const got = getComputedStyle(root).getPropertyValue('--yt-spec-base-background').trim().toLowerCase();
          if (got && got !== p.bg.toLowerCase()) {
            themeWarned = true;
            toast('Theme blocked by this YouTube variant — please report it');
          }
        } catch {}
      }
    } catch {}
  }

  /* 14) Seek + speed buttons in player controls */
  function seekSpeedSweep() {
    try {
      const wantSeek = on() && s.enhSeekButtons;
      const wantSpeed = on() && s.enhSpeedButtons;
      for (const id of ['tb-btn-rw', 'tb-btn-ff', 'tb-btn-sdown', 'tb-btn-sup']) {
        const keep = (id === 'tb-btn-rw' || id === 'tb-btn-ff') ? wantSeek : wantSpeed;
        if (!keep) document.getElementById(id)?.remove();
      }
      if (!wantSeek && !wantSpeed) return;
      const bar = document.querySelector('.ytp-right-controls');
      if (!bar) return;
      const secs = parseInt(s.enhSeekSecs, 10) || 10;
      if (wantSeek && !document.getElementById('tb-btn-rw')) bar.prepend(mkBtn('tb-btn-rw', '⟲', `Back ${secs}s`));
      if (wantSeek && !document.getElementById('tb-btn-ff')) {
        const rw = document.getElementById('tb-btn-rw');
        (rw ? rw.after.bind(rw) : bar.prepend.bind(bar))(mkBtn('tb-btn-ff', '⟳', `Forward ${secs}s`));
      }
      if (wantSpeed && !document.getElementById('tb-btn-sdown')) bar.prepend(mkBtn('tb-btn-sdown', '−', 'Slower'));
      if (wantSpeed && !document.getElementById('tb-btn-sup')) {
        const sd = document.getElementById('tb-btn-sdown');
        (sd ? sd.after.bind(sd) : bar.prepend.bind(bar))(mkBtn('tb-btn-sup', '＋', 'Faster'));
      }
    } catch {}
  }

  /* 15) Hide feed clutter — posts, playlist/radio shelves, labeled badges (CSS + text sweep) */
  const CLUTTER_CSS = `html.tb-clutter ytd-rich-item-renderer:has(ytd-post-renderer),`
    + `html.tb-clutter ytd-rich-item-renderer:has(ytd-playlist-renderer),`
    + `html.tb-clutter ytd-rich-item-renderer:has(ytd-radio-renderer){display:none!important}`;
  function clutterSweep() {
    try {
      const want = on() && s.enhHideClutter;
      document.documentElement.classList.toggle('tb-clutter', !!want);
      let st = document.getElementById('tb-clutter');
      if (want && !st) {
        st = document.createElement('style');
        st.id = 'tb-clutter';
        st.textContent = CLUTTER_CSS;
        (document.head || document.documentElement).appendChild(st);
      } else if (!want && st) st.remove();
      if (!want) return;
      for (const badge of document.querySelectorAll('ytd-badge-supported-renderer')) {
        try {
          const t = (badge.textContent || '').trim().toLowerCase();
          if (t.includes('members only') || t.includes('official artist')) {
            const item = badge.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer');
            if (item) { item.remove(); }
          }
        } catch {}
      }
      for (const el of document.querySelectorAll('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer')) {
        try {
          const title = (el.querySelector('#title-container, #title')?.textContent || '').toLowerCase();
          if (title.includes('playable')) (el.closest('ytd-rich-section-renderer') || el).remove();
        } catch {}
      }
      for (const btn of document.querySelectorAll('ytd-comments ytd-button-renderer button')) {
        try {
          if ((btn.textContent || '').trim().toLowerCase().startsWith('translate')) btn.closest('ytd-button-renderer')?.remove();
        } catch {}
      }
    } catch {}
  }

  /* 16) Videos per row + link fixes + number-key block (applied in listeners below) */
  function perRowSweep() {
    try {
      const want = on() && s.enhPerRow;
      let st = document.getElementById('tb-perrow');
      if (!want) { st?.remove(); return; }
      const n = Math.min(8, Math.max(1, parseInt(s.enhPerRowValue, 10) || 4));
      const css = `ytd-rich-grid-renderer{--ytd-rich-grid-items-per-row:${n}!important}`;
      if (!st) {
        st = document.createElement('style');
        st.id = 'tb-perrow';
        (document.head || document.documentElement).appendChild(st);
      }
      if (st.textContent !== css) st.textContent = css;
    } catch {}
  }
  function fixLink(a) {
    try {
      const href = a.getAttribute('href');
      if (!href) return;
      if (href.includes('/redirect?')) {
        const m = href.match(/[?&]q=([^&]+)/);
        if (m) {
          const target = decodeURIComponent(m[1]);
          // Never upgrade a link into script execution.
          if (/^javascript:/i.test(target.trim())) return;
          a.setAttribute('href', target);
        }
      } else if (/[?&](si|feature)=/.test(href)) {
        try {
          const u = new URL(href, location.origin);
          u.searchParams.delete('si');
          u.searchParams.delete('feature');
          // Keep absolute URLs absolute — pathname-only would break youtu.be links.
          const isAbs = /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
          a.setAttribute('href', isAbs ? u.href : u.pathname + u.search + u.hash);
        } catch {}
      }
    } catch {}
  }
  function linkFixSweep() {
    try {
      if (!on() || !s.enhLinkFix) return;
      for (const a of document.querySelectorAll('a[href*="/redirect?"], a[href*="si="]')) fixLink(a);
    } catch {}
  }
  try {
    document.addEventListener('click', (e) => {
      try {
        if (!on() || !s.enhLinkFix) return;
        const a = e.target && e.target.closest && e.target.closest('a[href]');
        if (a) fixLink(a);
      } catch {}
    }, true);
    document.addEventListener('keydown', (e) => {
      try {
        if (!on() || !s.enhLinkFix) return;
        if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
          if (t && t.closest && (t.closest('video') || t.closest('.html5-video-player') || t === document.body)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      } catch {}
    }, true);
    document.addEventListener('wheel', (e) => {
      try {
        if (!on() || !s.enhWheelVolume) return;
        const v = e.target && e.target.closest && e.target.closest('#movie_player video.html5-main-video, #shorts-player video');
        const video = v || (e.target instanceof HTMLVideoElement ? e.target : null);
        if (!video) return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.deltaY < 0 ? 0.05 : -0.05;
        const nv = Math.min(1, Math.max(0, (video.muted ? 0 : video.volume) + step));
        video.muted = false;
        video.volume = nv;
        try { chrome.storage.local.set({ tbVolume: nv, tbMuted: false }); } catch {}
        toast(`Volume ${Math.round(nv * 100)}%`);
      } catch {}
    }, { capture: true, passive: false });
  } catch {}

  setInterval(sweep, 1000);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      userChoseAutoplay = false;
      setTimeout(sweep, 500);
      setTimeout(sweep, 2000);
    }
  }, 800);
  try {
    document.addEventListener('yt-navigate-finish', () => {
      userChoseAutoplay = false;
      setTimeout(sweep, 500);
    });
  } catch {}
  setTimeout(sweep, 1500);
})();
