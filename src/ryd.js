/* TrueBlock ryd.js — Return YouTube Dislike counts (ISOLATED world).
 *
 * ORIGINAL clean-room client of the Return YouTube Dislike public read API:
 *   GET https://returnyoutubedislikeapi.com/votes?videoId=..
 * Project: https://returnyoutubedislike.com
 * Docs/API: https://returnyoutubedislike.com/docs/fetching
 * No RYD extension code is vendored — only the same public API + DOM trick:
 * refill the native like/dislike labels and add a like-ratio bar.
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
      // Shorts: /shorts/VIDEOID
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
      return null; // worker unreachable — fail open, keep native UI
    }
  }

  async function refresh(id) {
    curID = id;
    if (!id) return;
    if (cache.has(id)) return;
    cache.set(id, { at: Date.now(), likes: null, dislikes: null });
    if (cache.size > 60) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    if (!on()) return;
    if (pendingID === id) return;
    pendingID = id;
    try {
      const votes = await fetchVotes(id);
      const entry = cache.get(id);
      if (entry && votes) {
        entry.likes = votes.likes;
        entry.dislikes = votes.dislikes;
      }
    } finally {
      if (pendingID === id) pendingID = '';
    }
    try { sweep(); } catch {}
  }

  /* Locate the native like/dislike label slots. YouTube ships (at least) two
   * variants — the classic ytd-segmented-like-dislike-button-renderer and the
   * newer segmented-like-dislike-button-view-model — plus per-button fallbacks.
   * We treat the first button in the segmented container as Like and the
   * second as Dislike, matching YouTube's fixed order. */
  function findSlots() {
    const container = document.querySelector(
      'segmented-like-dislike-button-view-model,' +
      'ytd-segmented-like-dislike-button-renderer,' +
      '#segmented-like-dislike-button'
    );
    if (container) {
      const btns = container.querySelectorAll('button');
      if (btns.length >= 2) {
        const labelFor = (btn) => btn.querySelector(
          '[role="text"], #text, .yt-spec-button-shape-next__button-text-content'
        ) || btn;
        return { container, likeEl: labelFor(btns[0]), dislikeEl: labelFor(btns[1]), likeBtn: btns[0], dislikeBtn: btns[1] };
      }
    }
    // Fallback: standalone toggle buttons (older / embedded layouts)
    const likeBtn = document.querySelector('#like-button button, ytd-like-button-renderer button');
    const dislikeBtn = document.querySelector('#dislike-button button, ytd-dislike-button-renderer button');
    if (likeBtn && dislikeBtn) {
      const labelFor = (btn) => btn.querySelector('[role="text"], #text') || btn;
      return {
        container: likeBtn.closest('ytd-segmented-like-dislike-button-renderer') || likeBtn.parentElement,
        likeEl: labelFor(likeBtn),
        dislikeEl: labelFor(dislikeBtn),
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
        bar.innerHTML = '';
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
      // Master off or feature off: remove our bar, leave native labels alone
      // (YouTube owns the labels — we never blank them on failure).
      if (!on()) {
        try { slots.container?.querySelector(':scope > #tb-ryd-bar')?.remove(); } catch {}
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
        if (slots.likeEl && slots.likeEl.textContent.trim() !== likeTxt) {
          slots.likeEl.textContent = likeTxt;
        }
        if (slots.likeBtn) {
          slots.likeBtn.setAttribute('aria-label', `Like this video along with ${fmtFull(likes)} other people`);
          slots.likeBtn.title = tip;
        }
      } catch {}
      try {
        if (slots.dislikeEl && slots.dislikeEl.textContent.trim() !== dislikeTxt) {
          slots.dislikeEl.textContent = dislikeTxt;
        }
        if (slots.dislikeBtn) {
          slots.dislikeBtn.setAttribute('aria-label', `${fmtFull(dislikes)} people disliked this video`);
          slots.dislikeBtn.title = tip;
        }
      } catch {}
      if (slots.container) paintBar(slots.container, likes, dislikes);
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
