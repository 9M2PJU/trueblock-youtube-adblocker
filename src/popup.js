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
  enhScreenshot: false,
  enhPlayerButtons: false,
  enhHideDistractions: false,
  enhRemaining: false,
  enhShortsScroll: false,
  enhTheme: false,
  enhThemePreset: 'deep-dark',
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
    else if (el.type === 'color') el.value = vals[id] || '#00adee';
    else el.value = vals[id] ?? el.value;
  }
  refreshStats();
  refreshPill(vals.enabled);
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

setInterval(refreshStats, 1000);
load();
