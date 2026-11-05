#!/usr/bin/env bash
# Build per-browser packages. Chrome forbids background.scripts in MV3 while
# Firefox ignores background.service_worker — so each package gets the
# manifest variant that its browser accepts. Everything else is identical.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist TrueBlock-Chrome.zip TrueBlock-Firefox.zip /tmp/opencode/TrueBlock-Chrome.zip /tmp/opencode/TrueBlock-Firefox.zip
mkdir -p dist/chrome dist/firefox /tmp/opencode

FILES="rules src icons LICENSE README.md PRIVACY.md"
cp manifest.json dist/chrome/manifest.json
python3 - <<'EOF'
import json
m = json.load(open('manifest.json'))
m['background'] = {'scripts': ['src/background.js']}
json.dump(m, open('dist/firefox/manifest.json', 'w'), indent=2)
print('firefox manifest: background.scripts, no service_worker')
EOF

for target in chrome firefox; do
  cp -r rules src icons LICENSE README.md PRIVACY.md "dist/$target/"
done
# background-dnr.js uses Chrome-only declarativeNetRequest.onRuleMatchedDebug:
# keep it in the Chrome zip, exclude from Firefox (importScripts is try/caught).
rm -f dist/firefox/src/background-dnr.js
python3 -c "import json; m=json.load(open('dist/chrome/manifest.json')); assert 'service_worker' in m['background'] and 'scripts' not in m['background']; m=json.load(open('dist/firefox/manifest.json')); assert m['background']=={'scripts':['src/background.js']}; print('both manifests valid, keys correct')"
(cd dist/chrome && zip -qr /tmp/opencode/TrueBlock-Chrome.zip .) 
(cd dist/firefox && zip -qr /tmp/opencode/TrueBlock-Firefox.zip .)
cp /tmp/opencode/TrueBlock-Chrome.zip ./TrueBlock-Chrome.zip
cp /tmp/opencode/TrueBlock-Firefox.zip ./TrueBlock-Firefox.zip
ls -lh TrueBlock-Chrome.zip TrueBlock-Firefox.zip
