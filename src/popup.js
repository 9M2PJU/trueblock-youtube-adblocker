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
  enhSpectrum: true,
  enhEQ: true,
  enhEqPreset: 'rock',
  enhEqGains: [2, 4, 2, 3, 1, 0, 1, 4, 2, 1],
  enhEqPreamp: '-4',
  enhEqQ: 'normal',
  enhScreenshot: false,
  enhPlayerButtons: false,
  enhHideDistractions: false,
  enhRemaining: false,
  enhShortsScroll: true,
  enhTheme: true,
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
  sbSponsor: true, sbIntro: true, sbOutro: true, sbInteraction: true,
  sbSelfpromo: true, sbMusicOfftopic: true, sbPreview: true, sbFiller: true,
  rydEnabled: true,
  rydBar: true
};
const ids = Object.keys(DEFAULTS);

const THEME_ACCENTS = {
  'pure-black': '#ffffff',
  'classic': '#ff0000',
  'dracula': '#bd93f9',
  'mocha': '#cba6f7',
  'nord': '#88c0d0',
  'gruvbox': '#fabd2f',
  'tokyo': '#7aa2f7',
  'solarized': '#268bd2',
  'forest': '#4caf50',
  'discord': '#7289da',
  'deep-dark': '#00adee'
};

function syncAccentUI(accent, preset) {
  const picker = document.getElementById('enhAccent');
  const reset = document.getElementById('enhAccentReset');
  const hasCustom = /^#[0-9a-fA-F]{6}$/.test(accent || '');
  if (picker) picker.value = hasCustom ? accent : (THEME_ACCENTS[preset] || '#ffffff');
  if (reset) reset.disabled = !hasCustom;
}

async function load() {
  const vals = await chrome.storage.sync.get(DEFAULTS);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!vals[id];
    else if (id === 'enhAccent') syncAccentUI(vals.enhAccent, vals.enhThemePreset);
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
  try {
    const v = await chrome.storage.local.get({ totalBlocked: 0 });
    document.getElementById('totalCount').textContent = v.totalBlocked || 0;
    if (chrome.storage.session) {
      const s = await chrome.storage.session.get({ sessionBlocked: 0 });
      document.getElementById('sessionCount').textContent = s.sessionBlocked || 0;
    }
  } catch {}
}

for (const id of ids) {
  if (id === 'enhEqPreset') continue;
  document.getElementById(id)?.addEventListener('change', async (e) => {
    const el = e.target;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    await chrome.storage.sync.set({ [id]: val });
    if (id === 'enabled') refreshPill(el.checked);
    if (id === 'enhAccent') {
      const preset = document.getElementById('enhThemePreset')?.value || 'pure-black';
      syncAccentUI(val, preset);
    }
    if (id === 'enhThemePreset') {
      const vals = await chrome.storage.sync.get({ enhAccent: '' });
      if (!vals.enhAccent) syncAccentUI('', val);
    }
  });
}

document.getElementById('enhAccentReset')?.addEventListener('click', async () => {
  await chrome.storage.sync.set({ enhAccent: '' });
  const preset = document.getElementById('enhThemePreset')?.value || 'pure-black';
  syncAccentUI('', preset);
});

// Debounced writer: slider drags fire dozens of events/sec but storage.sync
// allows ~120 writes/min — batch them so realtime drags never drop writes.
const pendingSaves = {};
let saveTimer = 0;
function saveSoon(batch) {
  Object.assign(pendingSaves, batch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 150);
}
async function flushSaves(retry) {
  clearTimeout(saveTimer);
  const batch = { ...pendingSaves };
  for (const k of Object.keys(batch)) delete pendingSaves[k];
  if (!Object.keys(batch).length) return;
  try { await chrome.storage.sync.set(batch); }
  catch {
    if (!retry) {
      Object.assign(pendingSaves, batch);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => flushSaves(true), 500);
    }
  }
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
  let gains = Array.isArray(vals.enhEqGains) && vals.enhEqGains.length === 10 ? vals.enhEqGains : EQ_TABLE.flat;
  let preamp = vals.enhEqPreamp ?? '0';
  const preset = vals.enhEqPreset;
  if (preset && preset !== 'custom' && preset !== 'flat' && EQ_TABLE[preset] && gains.every((g) => g === 0)) {
    gains = EQ_TABLE[preset];
    preamp = String(-Math.max(0, ...gains));
  }
  document.querySelectorAll('.eqband').forEach((sl) => {
    const i = +sl.dataset.i;
    sl.value = gains[i] ?? 0;
    const b = sl.parentElement.querySelector('b');
    if (b) b.textContent = (+sl.value > 0 ? '+' : '') + sl.value;
  });
  const pre = document.getElementById('enhEqPreamp');
  if (pre) {
    pre.value = preamp;
    const pv = document.getElementById('enhEqPreampVal');
    if (pv) pv.textContent = ((+pre.value > 0 ? '+' : '') + pre.value) + 'dB';
  }
}
document.getElementById('enhEqPreset')?.addEventListener('change', async (e) => {
  const name = e.target.value;
  if (name !== 'custom' && EQ_TABLE[name]) {
    const gains = [...EQ_TABLE[name]];
    const preamp = String(-Math.max(0, ...gains));
    await chrome.storage.sync.set({ enhEqPreset: name, enhEqGains: gains, enhEqPreamp: preamp });
    paintEq({ enhEqPreset: name, enhEqGains: gains, enhEqPreamp: preamp });
  } else {
    await chrome.storage.sync.set({ enhEqPreset: name });
  }
});
document.querySelectorAll('.eqband').forEach((sl) => {
  sl.addEventListener('input', () => {
    const b = sl.parentElement.querySelector('b');
    if (b) b.textContent = (+sl.value > 0 ? '+' : '') + sl.value;
    const gains = [...document.querySelectorAll('.eqband')].map((x) => +x.value);
    saveSoon({ enhEqGains: gains, enhEqPreset: 'custom' });
    const sel = document.getElementById('enhEqPreset');
    if (sel) sel.value = 'custom';
  });
  sl.addEventListener('change', () => flushSaves());
});
document.getElementById('enhEqPreamp')?.addEventListener('input', (e) => {
  const pv = document.getElementById('enhEqPreampVal');
  if (pv) pv.textContent = ((+e.target.value > 0 ? '+' : '') + e.target.value) + 'dB';
  saveSoon({ enhEqPreamp: e.target.value });
});
document.getElementById('enhEqPreamp')?.addEventListener('change', () => flushSaves());

// Tabs
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tabpanel').forEach((p) => {
      p.hidden = p.id !== 'panel-' + btn.dataset.tab;
    });
  });
});

document.getElementById('resetBtn')?.addEventListener('click', async () => {
  try { await chrome.runtime.sendMessage({ type: 'tb-reset-session' }); } catch {}
  refreshStats();
});

// About dialog + Export/Import/Defaults
const REPO_URL = 'https://github.com/9M2PJU/trueblock-youtube-adblocker';
try {
  const manifest = chrome.runtime.getManifest();
  const verEl = document.getElementById('aboutVersion');
  if (verEl && manifest?.version) verEl.textContent = manifest.version;
  const repoEl = document.getElementById('aboutRepo');
  if (repoEl) repoEl.href = REPO_URL;
} catch {}
const aboutDialog = document.getElementById('aboutDialog');
const aboutMsg = document.getElementById('aboutMsg');
function showAboutMsg(text, isError = false) {
  if (!aboutMsg) return;
  aboutMsg.textContent = text;
  aboutMsg.style.color = isError ? 'var(--accent)' : 'var(--green)';
  aboutMsg.hidden = false;
  clearTimeout(aboutMsg.__t);
  aboutMsg.__t = setTimeout(() => { aboutMsg.hidden = true; }, 2500);
}
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

document.getElementById('exportBtn')?.addEventListener('click', async () => {
  try {
    const vals = await chrome.storage.sync.get(DEFAULTS);
    const blob = new Blob([JSON.stringify(vals, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trueblock-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showAboutMsg('Settings exported');
  } catch {
    showAboutMsg('Export failed', true);
  }
});

document.getElementById('importBtn')?.addEventListener('click', () => {
  document.getElementById('importFile')?.click();
});

document.getElementById('importFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const patch = {};
    for (const k of ids) {
      if (!(k in parsed)) continue;
      const def = DEFAULTS[k];
      const v = parsed[k];
      if (k === 'enhEqGains') {
        if (Array.isArray(v) && v.length === 10 && v.every((n) => Number.isFinite(+n))) {
          patch[k] = v.map((n) => Math.min(12, Math.max(-12, +n)));
        }
      } else if (typeof def === 'boolean' && typeof v === 'boolean') {
        patch[k] = v;
      } else if (typeof def === 'string' && typeof v === 'string') {
        patch[k] = v;
      }
    }
    if (!Object.keys(patch).length) throw new Error('empty');
    await chrome.storage.sync.set(patch);
    await load();
    showAboutMsg('Settings imported');
  } catch {
    showAboutMsg('Invalid settings file', true);
  }
});

document.getElementById('defaultsBtn')?.addEventListener('click', async () => {
  try {
    await chrome.storage.sync.set(DEFAULTS);
    await load();
    showAboutMsg('Defaults restored');
  } catch {
    showAboutMsg('Reset failed', true);
  }
});

// Guard: selects / color pickers / reset button nested in row labels must not toggle checkbox
document.querySelectorAll('label.row select, label.row input[type="color"], label.row .icon-btn').forEach((el) => {
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation());
});

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && changes.totalBlocked) || (area === 'session' && changes.sessionBlocked)) {
      refreshStats();
    }
  });
} catch {}

load();
