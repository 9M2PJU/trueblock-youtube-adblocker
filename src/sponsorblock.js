/* TrueBlock sponsorblock.js — crowdsourced in-video sponsor skipping (ISOLATED world).
 *
 * ORIGINAL clean-room client of SponsorBlock's public read API:
 *   GET https://sponsor.ajayyy.com/api/skipSegments?videoID=..&categories=..&actionTypes=["skip"]
 * No SponsorBlock code is vendored (upstream is GPL-3.0, same as this project).
 * Project: https://github.com/ajayyy/SponsorBlock
 * Copyright (C) 2026 9M2PJU <https://hamradio.my> — SPDX-License-Identifier: GPL-3.0-only
 *
 * Privacy: ON by default. When enabled, the current video ID is sent to
 * sponsor.ajayyy.com to fetch community segments. Nothing else is transmitted.
 */
(() => {
  'use strict';
  if (window.__trueblock_sb) return;
  window.__trueblock_sb = true;

  const API = 'https://sponsor.ajayyy.com/api/skipSegments';
  const CATS = ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'music_offtopic', 'preview', 'filler'];
  const LABELS = {
    sponsor: 'sponsor', intro: 'intro', outro: 'outro', interaction: 'reminder to subscribe',
    selfpromo: 'self-promo', music_offtopic: 'off-topic music', preview: 'recap/preview', filler: 'filler'
  };
  const DEFAULTS = {
    enabled: true,
    sbEnabled: true,
    sbSponsor: true, sbIntro: true, sbOutro: true, sbInteraction: false,
    sbSelfpromo: false, sbMusicOfftopic: false, sbPreview: false, sbFiller: false
  };
  let s = { ...DEFAULTS };
  try {
    chrome.storage.sync.get(DEFAULTS, (v) => { s = { ...DEFAULTS, ...v }; });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(ch)) s[k] = ch[k].newValue;
      // Enabling (or changing categories) must refetch the current video immediately:
      // refresh() skips cached IDs, so bust the cache and re-sweep at once.
      if (ch.sbEnabled || ch.enabled || CATS.some((c) => ch[CATKEY[c]])) {
        cache.clear();
        curID = '';
        try { setTimeout(sweep, 0); } catch {}
      }
    });
  } catch {}

  const on = () => s.enabled && s.sbEnabled;
  // category -> storage key (explicit map avoids camelize bugs)
  const CATKEY = {
    sponsor: 'sbSponsor', intro: 'sbIntro', outro: 'sbOutro', interaction: 'sbInteraction',
    selfpromo: 'sbSelfpromo', music_offtopic: 'sbMusicOfftopic', preview: 'sbPreview', filler: 'sbFiller'
  };
  const enabledCats = () => CATS.filter((c) => !!s[CATKEY[c]]);

  const cache = new Map(); // videoID -> { at, segs }
  let curID = '';

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
      t.__tb_timer = setTimeout(() => { t.style.display = 'none'; }, 1800);
    } catch {}
  }

  async function fetchSegs(id) {
    const cats = enabledCats();
    if (!cats.length) return [];
    const url = `${API}?videoID=${encodeURIComponent(id)}&categories=${encodeURIComponent(JSON.stringify(cats))}&actionTypes=${encodeURIComponent(JSON.stringify(['skip']))}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 404) return []; // no segments submitted for this video
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data
        .filter((d) => d && Array.isArray(d.segment) && Number.isFinite(d.segment[0]) && Number.isFinite(d.segment[1]))
        .map((d) => ({ cat: d.category, start: d.segment[0], end: d.segment[1] }))
        .sort((a, b) => a.start - b.start);
    } catch {
      return []; // offline / DNS / CORS — fail open, never break playback
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(id) {
    curID = id;
    if (!id) return;
    if (cache.has(id)) return;
    cache.set(id, { at: Date.now(), segs: [] });
    if (!on()) return;
    const segs = await fetchSegs(id);
    const entry = cache.get(id);
    if (entry) entry.segs = segs;
    if (cache.size > 30) { // bound memory on long sessions
      const first = cache.keys().next().value;
      cache.delete(first);
    }
  }

  function videoID() {
    try { return new URLSearchParams(location.search).get('v') || ''; }
    catch { return ''; }
  }

  function guard(video) {
    if (!video || video.__tb_sbHooked) return;
    video.__tb_sbHooked = true;
    video.addEventListener('timeupdate', () => {
      try {
        if (!on()) return;
        const id = videoID();
        if (!id || id !== curID) return;
        const entry = cache.get(id);
        if (!entry || !entry.segs.length) return;
        const t = video.currentTime;
        const p = video.closest('.html5-video-player');
        if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) return;
        for (const g of entry.segs) {
          if (t >= g.start && t < g.end - 0.15) {
            try { video.currentTime = g.end; } catch {}
            toast(`Skipped ${LABELS[g.cat] || g.cat} (${Math.round(g.end - g.start)}s) · via SponsorBlock`);
            break;
          }
        }
      } catch {}
    });
  }

  function sweep() {
    try {
      const id = location.pathname === '/watch' ? videoID() : '';
      if (id !== curID) refresh(id);
      const v = document.querySelector('video.html5-main-video');
      if (v) guard(v);
    } catch {}
  }

  setInterval(sweep, 1000);
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      sweep();
    }
  }, 800);
  try {
    document.addEventListener('yt-navigate-finish', sweep);
  } catch {}
  sweep();
})();
