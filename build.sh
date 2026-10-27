#!/usr/bin/env bash
# Build per-browser packages. Chrome forbids background.scripts in MV3 while
# Firefox ignores background.service_worker — so each package gets the
# manifest variant that its browser accepts. Everything else is identical.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist TrueBlock-Chrome.zip TrueBlock-Firefox.zip
mkdir -p dist/chrome dist/firefox

FILES="rules src icons assets LICENSE README.md PRIVACY.md .github/FUNDING.yml"
cp manifest.json dist/chrome/manifest.json
python3 - <<'EOF'
import json
m = json.load(open('manifest.json'))
m['background'] = {'scripts': ['src/background.js']}
json.dump(m, open('dist/firefox/manifest.json', 'w'), indent=2)
print('firefox manifest: background.scripts, no service_worker')
EOF

for target in chrome firefox; do
  cp -r rules src icons assets LICENSE README.md PRIVACY.md .github "dist/$target/"
done
python3 -c "import json; m=json.load(open('dist/chrome/manifest.json')); assert 'service_worker' in m['background'] and 'scripts' not in m['background']; m=json.load(open('dist/firefox/manifest.json')); assert m['background']=={'scripts':['src/background.js']}; print('both manifests valid, keys correct')"
(cd dist/chrome && zip -qr /tmp/opencode/TrueBlock-Chrome.zip .) 
(cd dist/firefox && zip -qr /tmp/opencode/TrueBlock-Firefox.zip .)
cp /tmp/opencode/TrueBlock-Chrome.zip ./TrueBlock-Chrome.zip
cp /tmp/opencode/TrueBlock-Firefox.zip ./TrueBlock-Firefox.zip
ls -lh TrueBlock-Chrome.zip TrueBlock-Firefox.zip
