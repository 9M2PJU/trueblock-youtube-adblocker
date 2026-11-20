import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));

let passed = 0;
function test(name, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => {
        passed++;
        console.log(`PASS: ${name}`);
      });
    }
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

async function main() {
  // 1. JS syntax validation for every file in src/
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).sort();
  await test('all src/*.js files parse cleanly', () => {
    assert.ok(srcFiles.length >= 6);
    assert.ok(!srcFiles.includes('background-dnr.js'), 'background-dnr.js should be removed');
    for (const file of srcFiles) {
      new vm.Script(read(`src/${file}`), { filename: `src/${file}` });
    }
  });

  // 2. Manifest checks
  const manifest = JSON.parse(read('manifest.json'));
  await test('manifest.json has minimal permissions & no WAR', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['declarativeNetRequest', 'storage', 'alarms']);
    assert.ok(!manifest.permissions.includes('declarativeNetRequestFeedback'));
    assert.equal(manifest.web_accessible_resources, undefined);
    assert.deepEqual(manifest.host_permissions, [
      '*://*.youtube.com/*',
      '*://*.youtube-nocookie.com/*',
      'https://sponsor.ajayyy.com/*',
      'https://returnyoutubedislikeapi.com/*'
    ]);
    for (const ic of Object.values(manifest.icons || {})) {
      assert.ok(fs.existsSync(path.join(ROOT, ic)), `missing icon ${ic}`);
      assert.ok(!ic.includes('512'), 'manifest should only reference 16/32/48/128 icons');
    }
    const css = read('src/content.css');
    assert.ok(css.includes('html.tb-block-banners'), 'content.css should gate banner rules');
    assert.ok(css.includes('html.tb-block-sponsored'), 'content.css should gate sponsored rules');
    assert.ok(css.includes('html.tb-anti-adblock'), 'content.css should gate anti-adblock rules');
    assert.ok(fs.existsSync(path.join(ROOT, manifest.background.service_worker)));
    assert.ok(fs.existsSync(path.join(ROOT, manifest.action.default_popup)));
    for (const cs of manifest.content_scripts) {
      for (const js of cs.js || []) assert.ok(fs.existsSync(path.join(ROOT, js)), `missing ${js}`);
      for (const css of cs.css || []) assert.ok(fs.existsSync(path.join(ROOT, css)), `missing ${css}`);
    }
  });

  // 3. DNR rules check
  await test('rules/block_ads.json rules 1-14 scoped to YouTube initiators', () => {
    const rules = JSON.parse(read('rules/block_ads.json'));
    assert.equal(rules.length, 15);
    const ids = new Set();
    for (const r of rules) {
      assert.equal(typeof r.id, 'number');
      assert.ok(!ids.has(r.id), `duplicate rule id ${r.id}`);
      ids.add(r.id);
      if (r.id <= 14) {
        assert.deepEqual(r.condition.initiatorDomains, ['youtube.com', 'youtube-nocookie.com']);
      } else {
        assert.deepEqual(r.condition.excludedInitiatorDomains, ['youtube.com']);
      }
    }
  });

  // 4. DEFAULTS parity across popup.js, content scripts, and popup.html IDs
  function extractDefaults(rel) {
    const text = read(rel);
    const m = text.match(/const DEFAULTS\s*=\s*(\{[\s\S]*?\n\s*\});/);
    assert.ok(m, `could not locate DEFAULTS in ${rel}`);
    return JSON.parse(JSON.stringify(vm.runInNewContext(`(${m[1]})`)));
  }

  await test('DEFAULTS parity across popup.js, content scripts & popup.html', () => {
    const popupDefs = extractDefaults('src/popup.js');
    const html = read('src/popup.html');
    for (const key of Object.keys(popupDefs)) {
      if (key === 'enhEqGains') {
        const bands = html.match(/class="eqband"/g) || [];
        assert.equal(bands.length, 10, 'popup.html must have 10 .eqband sliders for enhEqGains');
        continue;
      }
      assert.ok(html.includes(`id="${key}"`), `popup.html missing element id="${key}"`);
    }
    for (const file of ['src/content.js', 'src/enhancements.js', 'src/sponsorblock.js', 'src/ryd.js']) {
      const defs = extractDefaults(file);
      for (const [k, v] of Object.entries(defs)) {
        assert.ok(k in popupDefs, `${file} key ${k} missing from popup.js DEFAULTS`);
        assert.deepEqual(v, popupDefs[k], `${file} default mismatch for ${k}`);
      }
    }
  });

  // 5. Docs / version sync
  await test('README.md & CHROMEWEBSTORE.md match manifest version and current permissions', () => {
    const readme = read('README.md');
    const cws = read('CHROMEWEBSTORE.md');
    const permSection = (cws.split('## Permission justifications')[1] || '').split('## Data disclosure')[0] || '';
    assert.ok(readme.includes(`version-${manifest.version}-`), 'README badge version mismatch');
    assert.ok(readme.includes(`**v${manifest.version}**`), 'README changelog missing current version');
    assert.ok(!cws.includes('practiceotype'), 'CHROMEWEBSTORE.md typo still present');
    assert.ok(!permSection.includes('declarativeNetRequestFeedback'), 'CHROMEWEBSTORE.md permission table still lists dropped permission');
    assert.ok(!permSection.includes('googlesyndication.com'), 'CHROMEWEBSTORE.md permission table still lists dropped host permissions');
  });

  // 6. inject.js unit test (ad stripping, array filtering, pause gate, player bridge)
  await test('inject.js strips ads, filters empty ad slots, respects pause, bridges player API', () => {
    const listeners = {};
    const store = new Map();
    let blockedEvents = 0;
    const playerCalls = [];
    const flexy = {
      youthereDataChanged_() { playerCalls.push('origYouthere'); }
    };
    const moviePlayer = {
      getAvailableQualityLevels: () => ['hd1080', 'hd720', 'large'],
      getPlaybackQuality: () => 'hd720',
      setPlaybackQualityRange: (a, b) => playerCalls.push(['setRange', a, b]),
      setPlaybackQuality: (q) => playerCalls.push(['setQ', q]),
      setAutonav: (v) => playerCalls.push(['setAutonav', v]),
      skipAd: () => playerCalls.push('skipAd'),
      playVideo: () => playerCalls.push('playVideo')
    };

    const FakeEventTarget = class {
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
      dispatchEvent(ev) {
        if (ev.type === 'tb-main-blocked') blockedEvents += parseInt(ev.detail, 10) || 0;
        for (const fn of listeners[ev.type] || []) fn(ev);
      }
    };
    const win = new FakeEventTarget();
    win.JSON = JSON;
    win.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
    win.Event = class { constructor(type) { this.type = type; } };
    win.ProgressEvent = class { constructor(type) { this.type = type; } };
    win.Headers = Headers;
    win.Response = Response;
    win.fetch = async () => new Response('{}');
    win.XMLHttpRequest = class { open() {} send() {} };
    Object.defineProperty(win.XMLHttpRequest.prototype, 'responseText', { get() { return ''; }, configurable: true });
    win.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    win.document = {
      addEventListener() {},
      getElementById: (id) => (id === 'movie_player' ? moviePlayer : null),
      querySelector: (sel) => (sel.includes('ytd-watch-flexy') ? flexy : null)
    };
    win.window = win;

    vm.runInNewContext(read('src/inject.js'), win);

    const payload = JSON.stringify({
      videoDetails: { videoId: 'abc123' },
      adPlacements: [{ x: 1 }],
      playerAds: [{ y: 2 }],
      contents: [
        { richItemRenderer: { content: { adSlotRenderer: { ad: true } } } },
        { promotedVideoRenderer: { id: 'ad' } },
        { richItemRenderer: { content: { videoRenderer: { videoId: 'real1' } } } }
      ]
    });
    const cleaned = win.JSON.parse(payload);
    assert.equal(cleaned.adPlacements, undefined);
    assert.equal(cleaned.playerAds, undefined);
    assert.equal(cleaned.contents.length, 1);
    assert.equal(cleaned.contents[0].richItemRenderer.content.videoRenderer.videoId, 'real1');
    assert.ok(blockedEvents > 0);

    // Pause via tb-config -> JSON.parse must leave adPlacements intact
    win.dispatchEvent(new win.CustomEvent('tb-config', { detail: JSON.stringify({ enabled: false }) }));
    const uncleaned = win.JSON.parse(payload);
    assert.ok(Array.isArray(uncleaned.adPlacements));
    assert.equal(uncleaned.contents.length, 3);

    // Bridge commands
    win.dispatchEvent(new win.CustomEvent('tb-player-cmd', { detail: JSON.stringify({ action: 'setQuality', quality: 'hd2160' }) }));
    win.dispatchEvent(new win.CustomEvent('tb-player-cmd', { detail: JSON.stringify({ action: 'setAutonav', enabled: false }) }));
    win.dispatchEvent(new win.CustomEvent('tb-player-cmd', { detail: JSON.stringify({ action: 'patchYouthere' }) }));
    win.dispatchEvent(new win.CustomEvent('tb-player-cmd', { detail: JSON.stringify({ action: 'skipAd' }) }));
    win.dispatchEvent(new win.CustomEvent('tb-player-cmd', { detail: JSON.stringify({ action: 'playVideo' }) }));

    assert.deepEqual(plain(playerCalls), [
      ['setRange', 'hd1080', 'hd1080'],
      ['setQ', 'hd1080'],
      ['setAutonav', false],
      'skipAd',
      'playVideo'
    ]);
    flexy.youthereDataChanged_();
    assert.equal(playerCalls.length, 5); // patched to no-op
  });

  // 7. ryd.js preserves SVG icon in Dislike button & avoids overwriting Like count
  await test('ryd.js preserves SVG icons and native Like count', async () => {
    const svgNode = { tagName: 'svg', querySelector: () => null };
    const likeSpan = { textContent: '12K', querySelector: () => null };
    const createdNodes = [];
    const makeEl = (tag) => ({
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      style: {},
      children: [],
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { this.children.push(c); createdNodes.push(c); return c; },
      querySelector(sel) {
        if (sel === 'svg') return this.children.find((c) => c.tagName === 'svg' || c.tagName === 'SVG') || null;
        if (sel.includes('#tb-ryd-bar')) return this.children.find((c) => c.id === 'tb-ryd-bar') || null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel.includes('.tb-ryd-count')) return this.children.filter((c) => c.className === 'tb-ryd-count');
        return [];
      },
      remove() {}
    });

    const likeBtn = makeEl('button');
    likeBtn.children.push(likeSpan);
    likeBtn.querySelectorAll = () => [likeSpan];

    const dislikeBtn = makeEl('button');
    dislikeBtn.children.push(svgNode); // NO text span inside Dislike button
    dislikeBtn.querySelectorAll = () => dislikeBtn.children.filter((c) => c.className === 'tb-ryd-count');

    const container = makeEl('segmented-like-dislike-button-view-model');
    container.querySelectorAll = () => [likeBtn, dislikeBtn];

    const sandbox = {
      URLSearchParams,
      Number,
      Map,
      setInterval: () => 0,
      setTimeout,
      clearTimeout,
      location: { pathname: '/watch', search: '?v=dQw4w9WgXcQ', href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      document: {
        addEventListener() {},
        querySelector: (sel) => (sel.includes('segmented-like-dislike') ? container : null),
        querySelectorAll: () => [],
        createElement: makeEl
      },
      chrome: {
        storage: {
          sync: { get: (d, cb) => cb(d) },
          onChanged: { addListener() {} }
        },
        runtime: {
          sendMessage: async () => ({ likes: 999999, dislikes: 42300 })
        }
      }
    };
    sandbox.window = sandbox;

    vm.runInNewContext(read('src/ryd.js'), sandbox);
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(likeSpan.textContent, '12K'); // native like untouched
    assert.ok(dislikeBtn.children.includes(svgNode), 'SVG must still be inside Dislike button');
    const countSpan = dislikeBtn.children.find((c) => c.className === 'tb-ryd-count');
    assert.ok(countSpan, 'expected .tb-ryd-count span created');
    assert.equal(countSpan.textContent, '42.3K');
    const bar = container.children.find((c) => c.id === 'tb-ryd-bar');
    assert.ok(bar, 'expected #tb-ryd-bar appended');
    assert.equal(bar.children.length, 2);
  });

  // 8. background.js SponsorBlock hash-prefix & transient-error non-caching test
  await test('background.js uses 4-hex SHA-256 prefix & skips error caching', async () => {
    const fetchCalls = [];
    let msgHandler = null;
    let mode = 'fail';
    const videoID = 'dQw4w9WgXcQ';

    // Compute expected 4-hex prefix
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoID));
    const expectedPrefix = Array.from(new Uint8Array(buf)).slice(0, 2).map((b) => b.toString(16).padStart(2, '0')).join('');

    const sandbox = {
      crypto,
      TextEncoder,
      AbortController,
      Map,
      Promise,
      Set,
      Number,
      Array,
      Date,
      setTimeout,
      clearTimeout,
      encodeURIComponent,
      JSON,
      fetch: async (url) => {
        fetchCalls.push(url);
        if (mode === 'fail') throw new Error('network error');
        return {
          ok: true,
          status: 200,
          json: async () => [{
            videoID,
            segments: [{ category: 'sponsor', segment: [10, 25] }]
          }]
        };
      },
      chrome: {
        runtime: {
          lastError: null,
          onMessage: { addListener: (fn) => { msgHandler = fn; } }
        },
        storage: {
          local: { get: (d, cb) => cb(d), set: (_v, cb) => cb && cb() },
          session: { get: (d, cb) => cb(d), set: (_v, cb) => cb && cb() },
          sync: { get: (d, cb) => cb(d), set: (_v, cb) => cb && cb() },
          onChanged: { addListener() {} }
        },
        declarativeNetRequest: { updateEnabledRulesets: async () => {} },
        action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
        alarms: { get: (_n, cb) => cb(null), create() {}, onAlarm: { addListener() {} } }
      }
    };

    vm.runInNewContext(read('src/background.js'), sandbox);
    assert.ok(typeof msgHandler === 'function');

    const ask = (msg) => new Promise((resolve) => msgHandler(msg, {}, resolve));

    const r1 = await ask({ type: 'tb-sb-fetch', videoID, categories: ['sponsor'] });
    assert.equal(r1.ok, false);
    assert.deepEqual(plain(r1.segs), []);
    assert.ok(fetchCalls[0].startsWith(`https://sponsor.ajayyy.com/api/skipSegments/${expectedPrefix}?`));
    assert.ok(!fetchCalls[0].includes(videoID), 'plaintext videoID must not be sent');

    // Second call after transient failure must retry (not cached as empty)
    mode = 'ok';
    const r2 = await ask({ type: 'tb-sb-fetch', videoID, categories: ['sponsor'] });
    assert.equal(r2.ok, true);
    assert.deepEqual(plain(r2.segs), [{ cat: 'sponsor', start: 10, end: 25 }]);
    assert.equal(fetchCalls.length, 2);

    // Third call hits 15-min cache
    const r3 = await ask({ type: 'tb-sb-fetch', videoID, categories: ['sponsor'] });
    assert.equal(r3.ok, true);
    assert.equal(fetchCalls.length, 2);
  });

  // 9. enhancements.js fixLink & EQ clip-guard test
  await test('enhancements.js fixLink unwraps safely & EQ enforces unity headroom', async () => {
    const docListeners = {};
    let storageCb = null;
    let preGainTarget = null;
    const makeAnchor = (href) => ({
      href,
      getAttribute(k) { return k === 'href' ? this.href : null; },
      setAttribute(k, v) { if (k === 'href') this.href = v; },
      closest() { return this; }
    });
    const anchors = [
      makeAnchor('https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.com%2Ffoo'),
      makeAnchor('https://www.youtube.com/redirect?q=javascript%3Aalert(1)'),
      makeAnchor('https://youtu.be/abc123?si=tracker&t=12'),
      makeAnchor('/watch?v=abc123&feature=share')
    ];
    const mockVideo = {
      paused: false,
      muted: false,
      volume: 1,
      playbackRate: 1,
      readyState: 4,
      addEventListener() {},
      closest: () => null
    };
    function MockAudioContext() {
      this.state = 'running';
      this.currentTime = 1;
      this.destination = {};
      this.createMediaElementSource = () => ({ connect() {} });
      this.createGain = () => ({
        gain: {
          value: 1,
          setTargetAtTime(val) {
            this.value = val;
            if (preGainTarget === null) preGainTarget = val;
          }
        },
        connect() {}
      });
      this.createBiquadFilter = () => ({ type: '', frequency: { value: 0 }, Q: { value: 1, setTargetAtTime() {} }, gain: { value: 0, setTargetAtTime() {} }, connect() {} });
      this.createDynamicsCompressor = () => ({ threshold: { value: -3, setTargetAtTime() {} }, knee: { value: 0 }, ratio: { value: 20, setTargetAtTime() {} }, attack: { value: 0 }, release: { value: 0 }, connect() {} });
      this.createAnalyser = () => ({ fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8, minDecibels: -90, maxDecibels: -30, getByteFrequencyData() {}, connect() {} });
    }
    const sandbox = {
      URL,
      URLSearchParams,
      Map,
      WeakMap,
      Set,
      Math,
      Number,
      Array,
      Uint8Array,
      Date,
      JSON,
      HTMLVideoElement: function () {},
      CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
      navigator: { userActivation: { hasBeenActive: true } },
      AudioContext: MockAudioContext,
      setInterval: () => 0,
      setTimeout: (fn) => { fn(); return 0; },
      clearTimeout() {},
      requestAnimationFrame: () => 0,
      getComputedStyle: () => ({ display: 'block', position: 'relative', getPropertyValue: () => '#000000' }),
      location: { pathname: '/watch', search: '?v=abc123', origin: 'https://www.youtube.com', href: 'https://www.youtube.com/watch?v=abc123' },
      document: {
        hidden: true,
        documentElement: { classList: { toggle() {}, add() {}, remove() {} }, hasAttribute: () => true, setAttribute() {}, removeAttribute() {}, appendChild() {} },
        head: { appendChild() {} },
        body: { appendChild() {} },
        addEventListener(ev, fn) { (docListeners[ev] ||= []).push(fn); },
        getElementById: () => null,
        querySelector: (sel) => (sel.includes('video.html5-main-video') ? mockVideo : null),
        querySelectorAll: (sel) => (sel.includes('a[href') ? anchors : [])
      },
      chrome: {
        storage: {
          sync: {
            get: (d, cb) => cb({ ...d, enhLinkFix: true, enhEQ: true, enhEqPreset: 'rock', enhEqPreamp: '0' })
          },
          local: { get: (d, cb) => cb(d), set() {} },
          onChanged: { addListener: (fn) => { storageCb = fn; } }
        }
      }
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = () => {};
    sandbox.window.dispatchEvent = () => {};

    vm.runInNewContext(read('src/enhancements.js'), sandbox);
    assert.equal(anchors[0].href, 'https://example.com/foo');
    assert.equal(anchors[1].href, 'https://www.youtube.com/redirect?q=javascript%3Aalert(1)');
    assert.equal(anchors[2].href, 'https://youtu.be/abc123?t=12');
    assert.equal(anchors[3].href, '/watch?v=abc123');
    // Rock preset peak = +4dB => preamp forced <= -4dB => linear gain ~= 10^(-4/20) = 0.630957
    assert.ok(preGainTarget !== null && Math.abs(preGainTarget - Math.pow(10, -4 / 20)) < 0.001);
    assert.ok(typeof storageCb === 'function');
  });

  // 10. sponsorblock.js seek-back guard & Unskip toast button test
  await test('sponsorblock.js skips once, guards seek-back loop & supports Unskip', async () => {
    const videoListeners = {};
    const mockVideo = {
      currentTime: 12,
      addEventListener(ev, fn) { (videoListeners[ev] ||= []).push(fn); },
      closest: () => null
    };
    let toastEl = null;
    let unskipBtn = null;
    const makeNode = (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      style: {},
      children: [],
      listeners: {},
      setAttribute() {},
      addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
      appendChild(c) {
        this.children.push(c);
        if (c.className === 'tb-toast-btn') unskipBtn = c;
        return c;
      },
      querySelectorAll: () => []
    });

    const sandbox = {
      URLSearchParams,
      Map,
      Set,
      Math,
      Number,
      Array,
      Date,
      setInterval: () => 0,
      setTimeout,
      clearTimeout,
      location: { pathname: '/watch', search: '?v=vidSB123', href: 'https://www.youtube.com/watch?v=vidSB123' },
      document: {
        addEventListener() {},
        createTextNode: (txt) => ({ nodeType: 3, textContent: txt }),
        createElement: (tag) => {
          const el = makeNode(tag);
          if (tag === 'div' && !toastEl) toastEl = el;
          return el;
        },
        getElementById: (id) => (id === 'tb-toast' ? toastEl : null),
        body: { appendChild(el) { toastEl = el; } },
        querySelector: () => null,
        querySelectorAll: (sel) => (sel.includes('video') ? [mockVideo] : [])
      },
      chrome: {
        storage: {
          sync: { get: (d, cb) => cb(d) },
          onChanged: { addListener() {} }
        },
        runtime: {
          sendMessage: async () => ({ ok: true, segs: [{ cat: 'sponsor', start: 10, end: 25 }] })
        }
      }
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = () => {};

    vm.runInNewContext(read('src/sponsorblock.js'), sandbox);
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(Array.isArray(videoListeners.timeupdate) && videoListeners.timeupdate.length === 1);
    // First hit inside [10, 25) skips to 25
    videoListeners.timeupdate[0]();
    assert.equal(mockVideo.currentTime, 25);
    assert.ok(unskipBtn, 'expected Unskip button on toast');

    // Seeking back into [10, 25) must NOT re-skip
    mockVideo.currentTime = 15;
    videoListeners.timeupdate[0]();
    assert.equal(mockVideo.currentTime, 15);

    // Clicking Unskip restores pre-skip timestamp (12)
    unskipBtn.listeners.click[0]({ stopPropagation() {} });
    assert.equal(mockVideo.currentTime, 12);
    assert.equal(toastEl.style.display, 'none');
  });

  console.log(`\nAll ${passed} verification checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
