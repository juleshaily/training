#!/bin/bash
# Daily sync — pulls latest Strava + sleep, deploys to Netlify, opens dashboard.
# Designed to be run by launchd OR manually (just `./sync-all.sh`).

set -u
cd "$(dirname "$0")"

# launchd has a minimal PATH — make sure node + netlify are findable
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found. Install Node.js 18+." >&2
  exit 1
fi

echo "=========================================="
echo "  Daily sync starting at $(date)"
echo "=========================================="

STRAVA_OK=0
SLEEP_OK=0
OPEN_OK=0

echo ""
echo "[1/4] Strava sync..."
if "$NODE_BIN" sync.js; then
  echo "      Strava OK"
  STRAVA_OK=1
else
  echo "      Strava sync FAILED (continuing anyway)"
fi

echo ""
echo "[2/4] Sleep sync..."
if "$NODE_BIN" sync-sleep.js; then
  echo "      Sleep OK"
  SLEEP_OK=1
else
  echo "      Sleep sync skipped or failed (continuing anyway)"
fi

echo ""
echo "[3/4] Publishing to Netlify..."
rm -rf .deploy && mkdir -p .deploy
cp index.html app.js style.css manifest.json sw.js .deploy/
cp icon-192.png icon-512.png .deploy/ 2>/dev/null || true
cp -r data .deploy/data
if command -v netlify >/dev/null 2>&1 && [ -d .netlify ]; then
  if netlify deploy --prod --dir=.deploy --message="Auto sync $(date +%Y-%m-%d_%H:%M)" 2>&1 | tail -10; then
    echo "      Deployed to Netlify"
  else
    echo "      Netlify deploy failed (continuing)"
  fi
else
  echo "      Netlify not configured yet (skipping web upload)"
fi

echo ""
echo "[4/4] Opening local dashboard..."
if open -a "Google Chrome" "$PWD/index.html" 2>/dev/null; then
  OPEN_OK=1
elif open -a "Safari" "$PWD/index.html" 2>/dev/null; then
  OPEN_OK=1
elif open "$PWD/index.html" 2>/dev/null; then
  OPEN_OK=1
else
  echo "      Could not open dashboard automatically"
fi

echo ""
echo "Latest local data:"
"$NODE_BIN" - <<'NODE' || true
const fs = require('fs');
function readJson(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return null; }
}
const acts = readJson('data/activities.json');
const sleepRaw = readJson('data/sleep.json');
const activities = Array.isArray(acts) ? acts : (acts?.activities || []);
const sleep = sleepRaw?.metrics?.sleep || sleepRaw?.sleep || [];
const latestActivity = activities
  .map(a => a.start_date_local || a.start_date)
  .filter(Boolean)
  .sort()
  .at(-1);
const latestSleep = sleep
  .map(s => s.date)
  .filter(Boolean)
  .sort()
  .at(-1);
console.log(`      Activities: ${activities.length} records${latestActivity ? `, latest ${latestActivity.slice(0, 10)}` : ''}`);
console.log(`      Sleep: ${sleep.length} records${latestSleep ? `, latest ${latestSleep}` : ''}`);
NODE

echo ""
echo "Done at $(date)."

if [ "$STRAVA_OK" -ne 1 ] || [ "$SLEEP_OK" -ne 1 ] || [ "$OPEN_OK" -ne 1 ]; then
  echo ""
  echo "One or more morning sync steps failed:"
  [ "$STRAVA_OK" -ne 1 ] && echo "      - Strava sync failed"
  [ "$SLEEP_OK" -ne 1 ] && echo "      - Sleep sync failed"
  [ "$OPEN_OK" -ne 1 ] && echo "      - Dashboard did not open automatically"
  exit 1
fi
