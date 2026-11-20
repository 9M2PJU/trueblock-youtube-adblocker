#!/usr/bin/env bash
# Build per-browser packages. Chrome forbids background.scripts / browser_specific_settings
# warnings while Firefox needs background.scripts instead of service_worker.
set -euo pipefail
cd "$(dirname "$0")"

# Run automated verification first if a working JS runtime is available
if command -v bun >/dev/null 2>&1; then
  bun tests/verify.mjs
elif node --version >/dev/null 2>&1; then
  node tests/verify.mjs
fi

rm -rf dist TrueBlock-Chrome.zip TrueBlock-Firefox.zip
mkdir -p dist/chrome dist/firefox

cp -r rules src icons LICENSE README.md PRIVACY.md dist/chrome/
cp -r rules src icons LICENSE README.md PRIVACY.md dist/firefox/
rm -f dist/chrome/icons/icon512.png dist/firefox/icons/icon512.png

python3 - <<'EOF'
import json

with open('manifest.json', encoding='utf-8') as f:
    base = json.load(f)

chrome_m = dict(base)
chrome_m.pop('browser_specific_settings', None)
with open('dist/chrome/manifest.json', 'w', encoding='utf-8') as f:
    json.dump(chrome_m, f, indent=2)
    f.write('\n')

firefox_m = dict(base)
firefox_m.pop('minimum_chrome_version', None)
firefox_m['background'] = {'scripts': ['src/background.js']}
with open('dist/firefox/manifest.json', 'w', encoding='utf-8') as f:
    json.dump(firefox_m, f, indent=2)
    f.write('\n')

assert 'service_worker' in chrome_m['background'] and 'browser_specific_settings' not in chrome_m
assert firefox_m['background'] == {'scripts': ['src/background.js']} and 'minimum_chrome_version' not in firefox_m
print('both manifests valid, keys correct')
EOF

WEB_EXT_BIN=$(command -v web-ext 2>/dev/null || echo "$HOME/.npm-global/bin/web-ext")
if [ -x "$WEB_EXT_BIN" ]; then
  if "$WEB_EXT_BIN" --version >/dev/null 2>&1; then
    "$WEB_EXT_BIN" lint --source-dir dist/firefox
  elif command -v bun >/dev/null 2>&1; then
    bun "$WEB_EXT_BIN" lint --source-dir dist/firefox
  fi
fi

(cd dist/chrome && zip -qr ../../TrueBlock-Chrome.zip .)
(cd dist/firefox && zip -qr ../../TrueBlock-Firefox.zip .)
ls -lh TrueBlock-Chrome.zip TrueBlock-Firefox.zip
