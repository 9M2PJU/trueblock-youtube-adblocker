/* TrueBlock sponsorblock.js — crowdsourced in-video sponsor skipping (ISOLATED world).
 *
 * ORIGINAL clean-room client of SponsorBlock's public hash-prefix read API:
 *   GET https://sponsor.ajayyy.com/api/skipSegments/<4-hex-sha256-prefix>?categories=..&actionTypes=["skip"]
 * No SponsorBlock code is vendored (upstream is GPL-3.0, same as this project).
 * Project: https://github.com/ajayyy/SponsorBlock
 * Copyright (C) 2026 9M2PJU <https://hamradio.my> — SPDX-License-Identifier: GPL-3.0-only
 *
 * Privacy: ON by default. Only a 4-character SHA-256 prefix of the video ID is sent
 * to sponsor.ajayyy.com (k-anonymous prefix lookup). Untick in popup for fully offline.
 */
(() => {
  'use strict';
  if (window.__trueblock_sb) return;
  window.__trueblock_sb = true;

  const CATS = ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'music_offtopic', 'preview', 'filler'];
  const LABELS = {
    sponsor: 'sponsor', intro: 'intro', outro: 'outro', interaction: 'reminder to subscribe',
    selfpromo: 'self-promo', music_offtopic: 'off-topic music', preview: 'recap/preview', filler: 'filler'
  };
  const COLORS = {
    sponsor: '#00d400', intro: '#00ffff', outro: '#0202ed',
    interaction: '#cc00ff', selfpromo: '#ffff00',
    music_offtopic: '#ff9900', preview: '#008fd6', filler: '#7300ff'
  };
  const DEFAULTS = {
    enabled: true,
    sbEnabled: true,
    sbSponsor: true, sbIntro: true, sbOutro: true, sbInteraction: true,
    sbSelfpromo: true, sbMusicOfftopic: true, sbPreview: true, sbFiller: true
  };
  let s = { ...DEFAULTS };
  const CATKEY = {
    sponsor: 'sbSponsor', intro: 'sbIntro', outro: 'sbOutro', interaction: 'sbInteraction',
    selfpromo: 'sbSelfpromo', music_offtopic: 'sbMusicOfftopic', preview: 'sbPreview', filler: 'sbFiller'
  };
  const on = () => s.enabled && s.sbEnabled;
  const enabledCats = () => CATS.filter((c) => !!s[CATKEY[c]]);

  const SB_TTL_MS = 15 * 60 * 1000;
  const cache = new Map(); // videoID -> { at, segs }
  const skipped = new Map(); // videoID -> Set("start:end")
  let curID = '';
  let pendingID = '';

  try {
    chrome.storage.sync.get(DEFAULTS, (v) => { s = { ...DEFAULTS, ...v }; });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(ch)) s[k] = ch[k].newValue;
      if (ch.sbEnabled || ch.enabled || CATS.some((c) => ch[CATKEY[c]])) {
        cache.clear();
        skipped.clear();
        clearMarkers();
        curID = '';
        pendingID = '';
        try { setTimeout(sweep, 0); } catch {}
      }
    });
  } catch {}

  function ensureToast() {
    let t = document.getElementById('tb-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'tb-toast';
      t.setAttribute('style', 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;font:500 13px system-ui;padding:8px 14px;border-radius:8px;z-index:99999;pointer-events:none');
      document.body.appendChild(t);
    }
    return t;
  }

  function showSkipToast(video, g, prevTime) {
    try {
      const t = ensureToast();
      t.textContent = '';
      t.appendChild(document.createTextNode(`Skipped ${LABELS[g.cat] || g.cat} (${Math.round(g.end - g.start)}s) · via SponsorBlock`));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tb-toast-btn';
      btn.textContent = 'Unskip';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        try { video.currentTime = prevTime; } catch {}
        t.style.display = 'none';
      });
      t.appendChild(btn);
      t.style.display = 'block';
      clearTimeout(t.__tb_timer);
      t.__tb_timer = setTimeout(() => { t.style.display = 'none'; }, 4000);
    } catch {}
  }

  async function fetchSegs(id) {
    const cats = enabledCats();
    if (!cats.length) return { ok: true, segs: [] };
    try {
      const res = await Promise.race([
        chrome.runtime.sendMessage({ type: 'tb-sb-fetch', videoID: id, categories: cats }),
        new Promise((resolve) => setTimeout(() => resolve(null), 10000))
      ]);
      if (!res || !res.ok || !Array.isArray(res.segs)) return { ok: false, segs: [] };
      const segs = res.segs
        .filter((g) => g && Number.isFinite(g.start) && Number.isFinite(g.end) && g.end > g.start)
        .sort((a, b) => a.start - b.start);
      return { ok: true, segs };
    } catch {
      return { ok: false, segs: [] };
    }
  }

  function clearMarkers() {
    try {
      for (const el of document.querySelectorAll('.tb-sb-marker')) el.remove();
      const bar = document.querySelector('.ytp-progress-bar');
      if (bar) bar.__tb_sbKey = '';
    } catch {}
  }

  function renderMarkers() {
    try {
      if (!on() || location.pathname !== '/watch') { clearMarkers(); return; }
      const id = curID;
      const entry = id ? cache.get(id) : null;
      const bar = document.querySelector('#movie_player .ytp-progress-bar');
      const v = document.querySelector('#movie_player video.html5-main-video');
      const dur = v ? v.duration : NaN;
      if (!bar || !entry || !entry.segs.length || !Number.isFinite(dur) || dur <= 0) {
        clearMarkers();
        return;
      }
      const key = `${id}|${Math.round(dur)}|${entry.segs.length}`;
      if (bar.__tb_sbKey === key) return;
      bar.__tb_sbKey = key;
      for (const el of bar.querySelectorAll(':scope > .tb-sb-marker')) el.remove();
      for (const g of entry.segs) {
        const startPct = Math.max(0, Math.min(100, (g.start / dur) * 100));
        const endPct = Math.max(startPct, Math.min(100, (g.end / dur) * 100));
        const widthPct = endPct - startPct;
        if (widthPct <= 0) continue;
        const m = document.createElement('div');
        m.className = 'tb-sb-marker';
        m.style.left = startPct + '%';
        m.style.width = Math.max(widthPct, 0.35) + '%';
        m.style.background = COLORS[g.cat] || '#00d400';
        bar.appendChild(m);
      }
    } catch {}
  }

  async function refresh(id) {
    curID = id;
    if (!id || !on()) { clearMarkers(); return; }
    const existing = cache.get(id);
    if (existing && (Date.now() - existing.at < SB_TTL_MS)) {
      renderMarkers();
      return;
    }
    if (pendingID === id) return;
    pendingID = id;
    try {
      const { ok, segs } = await fetchSegs(id);
      if (!ok) return; // do not cache transient errors
      cache.set(id, { at: Date.now(), segs });
      if (cache.size > 30) {
        const first = cache.keys().next().value;
        cache.delete(first);
      }
      if (curID === id) renderMarkers();
    } finally {
      if (pendingID === id) pendingID = '';
    }
  }

  function videoID() {
    try {
      if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v') || '';
      const m = location.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (m) return m[1];
      return '';
    } catch { return ''; }
  }

  function guard(video) {
    if (!video || video.__tb_sbHooked) return;
    video.__tb_sbHooked = true;
    video.addEventListener('timeupdate', () => {
      try {
        if (!on()) return;
        const id = videoID();
        if (!id || id !== curID) return;
        if (location.pathname.startsWith('/shorts')) {
          const reel = video.closest('ytd-reel-video-renderer');
          if (reel && !reel.hasAttribute('is-active')) return;
        }
        const entry = cache.get(id);
        if (!entry || !entry.segs.length) return;
        const t = video.currentTime;
        const p = video.closest('.html5-video-player');
        if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return;
        let set = skipped.get(id);
        for (const g of entry.segs) {
          const key = `${g.start}:${g.end}`;
          if (set && set.has(key)) continue;
          if (t >= g.start && t < g.end - 0.15) {
            if (!set) {
              set = new Set();
              skipped.set(id, set);
              if (skipped.size > 30) {
                const first = skipped.keys().next().value;
                skipped.delete(first);
              }
            }
            set.add(key);
            const prevTime = t;
            try { video.currentTime = g.end; } catch {}
            showSkipToast(video, g, prevTime);
            break;
          }
        }
      } catch {}
    });
  }

  function sweep() {
    try {
      const id = videoID();
      if (id !== curID) {
        clearMarkers();
        refresh(id);
      } else {
        renderMarkers();
      }
      for (const v of document.querySelectorAll('video.html5-main-video, ytd-reel-video-renderer video, #shorts-player video')) {
        if (v) guard(v);
      }
    } catch {}
  }

  setInterval(sweep, 1000);
  try {
    window.addEventListener('tb-nav', sweep);
    window.addEventListener('popstate', sweep);
    document.addEventListener('yt-navigate-finish', sweep);
  } catch {}
  sweep();
})();
