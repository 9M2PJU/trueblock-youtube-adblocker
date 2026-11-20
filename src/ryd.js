/* TrueBlock ryd.js — Return YouTube Dislike counts (ISOLATED world).
 *
 * ORIGINAL clean-room client of the Return YouTube Dislike public read API:
 *   GET https://returnyoutubedislikeapi.com/votes?videoId=..
 * Project: https://returnyoutubedislike.com
 * Docs/API: https://returnyoutubedislike.com/docs/fetching
 * No RYD extension code is vendored — only the same public API + DOM trick:
 * refill missing like/dislike counts without touching SVG icons, plus ratio bar.
 * Copyright (C) 2026 9M2PJU <https://hamradio.my> — SPDX-License-Identifier: GPL-3.0-only
 *
 * Privacy: ON by default. When enabled, the current video ID is sent to
 * returnyoutubedislikeapi.com to fetch crowd-sourced counts. Nothing else is
 * transmitted. Turn it off in the popup to go fully offline.
 */
(() => {
  'use strict';
  if (window.__trueblock_ryd) return;
  window.__trueblock_ryd = true;

  const DEFAULTS = {
    enabled: true,
    rydEnabled: true,
    rydBar: true
  };
  let s = { ...DEFAULTS };
  try {
    chrome.storage.sync.get(DEFAULTS, (v) => { s = { ...DEFAULTS, ...v }; });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(ch)) s[k] = ch[k].newValue;
      if (ch.rydEnabled || ch.rydBar || ch.enabled) {
        try { setTimeout(sweep, 0); } catch {}
      }
    });
  } catch {}

  const on = () => s.enabled && s.rydEnabled;

  const cache = new Map(); // videoID -> { at, likes, dislikes }
  let curID = '';
  let pendingID = '';

  function videoID() {
    try {
      if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v') || '';
      const m = location.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (m) return m[1];
      return '';
    } catch { return ''; }
  }

  function fmt(n) {
    if (!Number.isFinite(n)) return '';
    if (n >= 1000000) {
      const v = n / 1000000;
      return (v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')) + 'M';
    }
    if (n >= 1000) {
      const v = n / 1000;
      return (v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')) + 'K';
    }
    return String(n);
  }
  function fmtFull(n) {
    try { return Number(n).toLocaleString('en-US'); } catch { return String(n); }
  }

  async function fetchVotes(id) {
    try {
      const res = await Promise.race([
        chrome.runtime.sendMessage({ type: 'tb-ryd-fetch', videoID: id }),
        new Promise((resolve) => setTimeout(() => resolve(null), 10000))
      ]);
      if (!res || typeof res.likes !== 'number' || typeof res.dislikes !== 'number') return null;
      return { likes: res.likes, dislikes: res.dislikes };
    } catch {
      return null;
    }
  }

  async function refresh(id) {
    curID = id;
    if (!id) return;
    const existing = cache.get(id);
    if (existing && existing.likes !== null) return;
    if (!on()) return;
    if (pendingID === id) return;
    pendingID = id;
    try {
      const votes = await fetchVotes(id);
      if (votes) {
        cache.set(id, { at: Date.now(), likes: votes.likes, dislikes: votes.dislikes });
        if (cache.size > 60) {
          const first = cache.keys().next().value;
          cache.delete(first);
        }
      }
    } finally {
      if (pendingID === id) pendingID = '';
    }
    try { sweep(); } catch {}
  }

  function labelElFor(btn, createIfMissing) {
    if (!btn) return null;
    const candidates = btn.querySelectorAll('.yt-spec-button-shape-next__button-text-content, [role="text"], #text, .tb-ryd-count');
    for (const el of candidates) {
      if (!el.querySelector('svg')) return el;
    }
    if (!createIfMissing) return null;
    const span = document.createElement('span');
    span.className = 'tb-ryd-count';
    btn.appendChild(span);
    return span;
  }

  function findSlots() {
    const isShorts = location.pathname.startsWith('/shorts');
    const root = isShorts ? document.querySelector('ytd-reel-video-renderer[is-active]') : document;
    if (!root) return null;

    if (!isShorts) {
      const container = root.querySelector(
        'segmented-like-dislike-button-view-model,' +
        'ytd-segmented-like-dislike-button-renderer,' +
        '#segmented-like-dislike-button'
      );
      if (container) {
        const btns = container.querySelectorAll('button');
        if (btns.length >= 2) {
          return { container, likeBtn: btns[0], dislikeBtn: btns[1] };
        }
      }
    }

    const likeBtn = root.querySelector(
      '#like-button button, ytd-like-button-renderer button, like-button-view-model button'
    );
    const dislikeBtn = root.querySelector(
      '#dislike-button button, ytd-dislike-button-renderer button, dislike-button-view-model button'
    );
    if (likeBtn && dislikeBtn) {
      return {
        container: likeBtn.closest('ytd-segmented-like-dislike-button-renderer, segmented-like-dislike-button-view-model') || likeBtn.parentElement,
        likeBtn,
        dislikeBtn
      };
    }
    return null;
  }

  function paintBar(container, likes, dislikes) {
    try {
      let bar = container.querySelector(':scope > #tb-ryd-bar');
      if (!s.rydBar) {
        if (bar) bar.remove();
        return;
      }
      const total = likes + dislikes;
      if (!Number.isFinite(total) || total <= 0) {
        if (bar) bar.remove();
        return;
      }
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'tb-ryd-bar';
        bar.setAttribute('aria-hidden', 'true');
        container.appendChild(bar);
      }
      const pct = (likes / total) * 100;
      if (bar.__tb_pct !== pct) {
        bar.__tb_pct = pct;
        bar.textContent = '';
        const likeFill = document.createElement('div');
        likeFill.className = 'tb-ryd-like';
        likeFill.style.width = pct + '%';
        const dislikeFill = document.createElement('div');
        dislikeFill.className = 'tb-ryd-dislike';
        dislikeFill.style.width = (100 - pct) + '%';
        bar.appendChild(likeFill);
        bar.appendChild(dislikeFill);
      }
      bar.title = `${fmtFull(likes)} likes / ${fmtFull(dislikes)} dislikes`;
    } catch {}
  }

  function sweep() {
    try {
      const id = videoID();
      if (id !== curID) { refresh(id); return; }
      const slots = findSlots();
      if (!slots) return;
      if (!on()) {
        try {
          slots.container?.querySelector(':scope > #tb-ryd-bar')?.remove();
          for (const el of document.querySelectorAll('.tb-ryd-count')) el.remove();
        } catch {}
        return;
      }
      if (!id) return;
      const entry = cache.get(id);
      if (!entry || entry.likes === null || entry.dislikes === null) return;
      const { likes, dislikes } = entry;
      if (!Number.isFinite(likes) || !Number.isFinite(dislikes)) return;

      const likeTxt = fmt(likes);
      const dislikeTxt = fmt(dislikes);
      const tip = `${fmtFull(likes)} likes / ${fmtFull(dislikes)} dislikes · via Return YouTube Dislike`;
      try {
        const likeEl = labelElFor(slots.likeBtn, false);
        // Only fill missing Like count; keep YouTube's accurate live Like label intact.
        if (likeEl && !/\d/.test(likeEl.textContent || '') && likeEl.textContent.trim() !== likeTxt) {
          likeEl.textContent = likeTxt;
        }
        if (slots.likeBtn) {
          slots.likeBtn.title = tip;
        }
      } catch {}
      try {
        const dislikeEl = labelElFor(slots.dislikeBtn, true);
        if (dislikeEl && dislikeEl.textContent.trim() !== dislikeTxt) {
          dislikeEl.textContent = dislikeTxt;
        }
        if (slots.dislikeBtn) {
          slots.dislikeBtn.setAttribute('aria-label', `${fmtFull(dislikes)} people disliked this video`);
          slots.dislikeBtn.title = tip;
        }
      } catch {}
      if (slots.container && !location.pathname.startsWith('/shorts')) {
        paintBar(slots.container, likes, dislikes);
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
