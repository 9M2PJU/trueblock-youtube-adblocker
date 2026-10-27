const DEFAULTS = {
  enabled: true,
  blockVideoAds: true,
  blockBanners: true,
  blockSponsored: true,
  blockShortsAds: true,
  antiAdblock: true,
  enhTheater: false,
  enhAutoplayOff: false,
  enhRememberVolume: true,
  enhQuality: false,
  enhQualityValue: 'hd1080',
  enhSkipContinue: true,
  enhRememberSpeed: false,
  enhHideShorts: false,
  enhVolumeBoost: false,
  enhBoostValue: '2',
  enhLimiter: true,
  enhSpectrum: false,
  enhEQ: false,
  enhEqPreset: 'flat',
  enhEqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  enhEqPreamp: '0',
  enhEqQ: 'normal',
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
  enhLinkFix: false,
  sbEnabled: true,
  sbSponsor: true, sbIntro: true, sbOutro: true, sbInteraction: false,
  sbSelfpromo: false, sbMusicOfftopic: false, sbPreview: false, sbFiller: false
};
const ids = Object.keys(DEFAULTS);

async function load() {
  const vals = await chrome.storage.sync.get(DEFAULTS);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!vals[id];
    else if (el.type === 'color') el.value = vals[id] || '#ffffff';
    else el.value = vals[id] ?? el.value;
  }
  refreshStats();
  refreshPill(vals.enabled);
  paintEq(vals);
}

function refreshPill(enabled) {
  const pill = document.getElementById('statusPill');
  pill.textContent = enabled ? 'Active' : 'Paused';
  pill.classList.toggle('off', !enabled);
}

async function refreshStats() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'tb-get-stats' });
    if (res) {
      document.getElementById('sessionCount').textContent = res.sessionBlocked ?? 0;
      document.getElementById('totalCount').textContent = res.totalBlocked ?? 0;
      return;
    }
  } catch {}
  const v = await chrome.storage.local.get({ totalBlocked: 0 });
  document.getElementById('totalCount').textContent = v.totalBlocked || 0;
}

for (const id of ids) {
  document.getElementById(id)?.addEventListener('change', async (e) => {
    const el = e.target;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    await chrome.storage.sync.set({ [id]: val });
    if (id === 'enabled') refreshPill(el.checked);
  });
}

// EQ panel: presets, preamp, Q, per-band sliders (audiophile 10-band)
const EQ_TABLE = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 6, 4, 0, -1, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 0, 2, 3, 2, 1],
  vocal: [-3, -2, -1, 1, 3, 4, 4, 2, -1, -1],
  vshape: [5, 4, 2, 0, -1, -2, -1, 1, 3, 5],
  loudness: [4, 3, 2, 0, 0, 0, 0, 1, 2, 3],
  rock: [2, 4, 2, 3, 1, 0, 1, 4, 2, 1]
};
function paintEq(vals) {
  const gains = Array.isArray(vals.enhEqGains) && vals.enhEqGains.length === 10 ? vals.enhEqGains : EQ_TABLE.flat;
  document.querySelectorAll('.eqband').forEach((sl) => {
    const i = +sl.dataset.i;
    sl.value = gains[i] ?? 0;
    const b = sl.parentElement.querySelector('b');
    if (b) b.textContent = (+sl.value > 0 ? '+' : '') + sl.value;
  });
  const pre = document.getElementById('enhEqPreamp');
  if (pre) {
    pre.value = vals.enhEqPreamp ?? '0';
    const pv = document.getElementById('enhEqPreampVal');
    if (pv) pv.textContent = ((+pre.value > 0 ? '+' : '') + pre.value) + 'dB';
  }
}
document.getElementById('enhEqPreset')?.addEventListener('change', async (e) => {
  const name = e.target.value;
  if (name !== 'custom' && EQ_TABLE[name]) {
    const gains = [...EQ_TABLE[name]];
    // Auto-preamp: cut by the peak boost so presets never clip (audiophile rule).
    const preamp = String(-Math.max(0, ...gains));
    await chrome.storage.sync.set({ enhEqGains: gains, enhEqPreamp: preamp });
    paintEq({ enhEqGains: gains, enhEqPreamp: preamp });
  }
});
document.querySelectorAll('.eqband').forEach((sl) => {
  sl.addEventListener('input', async () => {
    const b = sl.parentElement.querySelector('b');
    if (b) b.textContent = (+sl.value > 0 ? '+' : '') + sl.value;
    const gains = [...document.querySelectorAll('.eqband')].map((x) => +x.value);
    await chrome.storage.sync.set({ enhEqGains: gains, enhEqPreset: 'custom' });
    const sel = document.getElementById('enhEqPreset');
    if (sel) sel.value = 'custom';
  });
});
document.getElementById('enhEqPreamp')?.addEventListener('input', async (e) => {
  const pv = document.getElementById('enhEqPreampVal');
  if (pv) pv.textContent = ((+e.target.value > 0 ? '+' : '') + e.target.value) + 'dB';
  await chrome.storage.sync.set({ enhEqPreamp: e.target.value });
});

document.getElementById('resetBtn')?.addEventListener('click', async () => {
  try { await chrome.runtime.sendMessage({ type: 'tb-reset-session' }); } catch {}
  refreshStats();
});

// About dialog: version from manifest, links to 9M2PJU + GitHub repo
const REPO_URL = 'https://github.com/9M2PJU/trueblock-youtube-adblocker';
try {
  const manifest = chrome.runtime.getManifest();
  const verEl = document.getElementById('aboutVersion');
  if (verEl && manifest?.version) verEl.textContent = manifest.version;
  const repoEl = document.getElementById('aboutRepo');
  if (repoEl) repoEl.href = REPO_URL;
} catch {}
const aboutDialog = document.getElementById('aboutDialog');
document.getElementById('aboutBtn')?.addEventListener('click', () => {
  aboutDialog?.removeAttribute('hidden');
});
document.getElementById('aboutClose')?.addEventListener('click', () => {
  aboutDialog?.setAttribute('hidden', '');
});
aboutDialog?.addEventListener('click', (e) => {
  if (e.target === aboutDialog) aboutDialog.setAttribute('hidden', '');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') aboutDialog?.setAttribute('hidden', '');
});

// Guard: selects / color pickers nested in row labels must not toggle the checkbox
document.querySelectorAll('label.row select, label.row input[type="color"]').forEach((el) => {
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation());
});

setInterval(refreshStats, 1000);
load();
