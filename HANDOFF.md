# HANDOFF - Strava Fitness Dashboard

## Project Goal
Personal mobile-first athlete dashboard for Haily Rahmad. It answers: "Can I push today or take it easy?"

The app combines Strava activities with Apple Health sleep/health exports into a dark OLED, retro-futuristic performance cockpit. The user runs and plays football. Do not call football "soccer" in the UI.

## Stack
- Frontend: vanilla HTML/CSS/JS SPA, no framework.
- Charts/maps: Chart.js, Leaflet with Esri dark tiles.
- Sync scripts: Node.js 18+ only, no npm dependencies.
- Data loading: generated JS globals first, JSON fallback second. This supports both `file://` and HTTP.
- Automation: `/Users/haily/Desktop/Sync Dashboard.app` runs `sync-all.sh`.

## Important Files
- `index.html`: app shell, tab markup, script/style includes. Current CSS cache key: `style.css?v=13`.
- `style.css`: full visual system, dark OLED UI, cards, filters, quick view, daily movement, weight tracker, sync-date styles.
- `app.js`: all dashboard logic, state, rendering, charts, filters, readiness, HR zones, weight localStorage.
- `data/activities.json`: local Strava data.
- `data/activities.js`: generated `window.ACTIVITIES_DATA`, `window.ACTIVITIES_LAST_SYNC`, `window.LAST_SYNC`.
- `data/sleep.json`: normalized sleep data.
- `data/sleep.js`: generated `window.SLEEP_DATA`, `window.SLEEP_LAST_SYNC`.
- `sync.js`: Strava sync. Writes both `data/activities.json` and `data/activities.js`.
- `sync-sleep.js`: sleep sync. Reads Health Export JSON or zipped CSV, writes both `data/sleep.json` and `data/sleep.js`.
- `sync-all.sh`: morning sync script. Runs Strava + sleep sync, copies deploy files, opens local dashboard, prints data summary, exits nonzero if important steps fail.
- `.env`: real local credentials and paths. Do not print or expose secrets.
- `com.haily.strava-sync.plist`: launchd schedule, 7am daily.
- `/Users/haily/Desktop/Sync Dashboard.app`: AppleScript app wrapper around `sync-all.sh`.

## Current Data State
As of the latest check:
- Activities: 18 records.
- Latest activity: `2026-05-06T08:37:08Z`.
- Activity sync timestamp: `2026-05-06T01:56:31.343Z`.
- Sleep: 18 records.
- Latest sleep date: `2026-05-05`.
- Sleep sync timestamp: `2026-05-06T01:56:33.449Z`.

The latest Health Export ZIP currently synced successfully, but the newest actual sleep night inside it is still `2026-05-05`.

## Completed Features
- 7 tabs: Today, Sleep, Activity, Recovery, Trends, Zones, Weight.
- Today tab has:
  - readiness hero
  - Haily Rahmad name in header/hero
  - actual last sync date/time in header, green if synced today and amber if stale
  - daily calories/steps/exercise summary with comparison vs yesterday
  - totality metrics: running time, football time, avg HR, max HR, RHR, 7d exercise
  - quick performance view
  - "Are you getting better?" progress analysis with tone-colored cards and meters
- Sleep tab:
  - stage breakdown and chart
  - filters: All, Today, 7 days, 30 days, Custom
  - sleep recommendation/recovery card
  - tooltips for Deep/Core/REM explanations
- Activity tab:
  - Run/Football filters
  - date range filters including All default
  - summary counts for runs and football
  - map and activity list
- Trends tab:
  - date range filters including All default
  - charts use filtered activities/sleep
- Zones tab:
  - HR profile using user values: max HR 200, resting HR 53, reserve 147
  - sport filters for All/Run/Football
  - date range filters
  - time-in-zone chart
- Weight tab:
  - manual kg entry
  - date input
  - localStorage persistence under `dashWeights`
  - line chart, latest/change/7d trend, deleteable log
- Filters redesigned as compact segmented controls.
- Quick stat card tone system:
  - green = good
  - blue = okay
  - amber = warning
  - icon/value/border/glow now use one consistent tone per card.

## Sync Details
### Strava
`sync.js`:
- Uses Strava refresh-token flow.
- Fetches activities after `2026-04-05T00:00:00+08:00`.
- Maps Strava data into local dashboard shape.
- Preserves calories when Strava returns `a.calories`.
- Writes:
  - `data/activities.json`
  - `data/activities.js` with:
    - `window.ACTIVITIES_DATA`
    - `window.ACTIVITIES_LAST_SYNC`
    - `window.LAST_SYNC` for backward compatibility

### Sleep
`.env` currently points to:

`SLEEP_EXPORT_DIR=/Users/haily/Library/Mobile Documents/iCloud~HealthExport/Documents/Health`

`sync-sleep.js` supports:
- Health Export JSON files with `metrics.sleep`
- zipped SimpleHealthExportCSV sleep exports
- empty newest exports: it falls back to the newest file that actually contains sleep records
- Singapore date labels for wake date, so a 7am Singapore wake-up is labeled as that Singapore day

The ZIP parser reads Apple sleep rows like:
- `inBed`
- `asleepCore`
- `asleepDeep`
- `asleepREM`
- `awake`

It groups rows by sleep session and outputs:

```json
{
  "bed_start": "...",
  "bed_end": "...",
  "date": "YYYY-MM-DD",
  "stages": {
    "awake_min": 0,
    "core_min": 0,
    "deep_min": 0,
    "rem_min": 0
  }
}
```

## Morning App Behavior
`Sync Dashboard.app` decompiles to an AppleScript that runs:

`/Users/haily/Desktop/CLAUDE/Strava/sync-all.sh > /tmp/strava-sync.log 2>&1`

`sync-all.sh` now:
- runs Strava sync
- runs sleep sync
- copies `index.html`, `app.js`, `style.css`, and `data/` into `.deploy`
- deploys to Netlify only if Netlify is configured
- opens the local dashboard with Chrome, then Safari, then default open
- prints latest local data summary
- exits nonzero if Strava, sleep, or dashboard opening fails

To inspect morning failures:

```bash
cat /tmp/strava-sync.log
```

Codex sandbox may show `fetch failed` or may fail to open GUI apps. That does not necessarily mean the desktop app fails when run normally on the Mac. Previous normal run showed Strava working.

## Design Direction
User wants a premium athlete performance app:
- mobile-first, daily-use
- dark OLED
- retro-futuristic
- sharp training-console feel
- glow is good, but avoid mixed/contradictory card colors
- consistent fonts:
  - titles: Sora
  - body: Manrope
  - numbers: Fira Code
- avoid generic SaaS look
- reference screenshots are direction, not exact copy

## Fixed Issues
- Empty tabs caused by `fetch()` under `file://`: fixed with generated JS globals loaded by script tags.
- Sync scripts no longer patch inline HTML.
- Netlify deploy copy now includes required files/data.
- Sleep export path corrected from old missing iCloud path to:
  `/Users/haily/Library/Mobile Documents/iCloud~HealthExport/Documents/Health`
- Sleep sync now supports zipped CSV exports.
- Empty newest Health Export files no longer wipe dashboard data.
- Header shows real sync date/time instead of vague relative-only text.
- Quick stat mixed-color bug fixed.
- `open index.html` in morning script replaced with Chrome/Safari/default fallback.

## Known Constraints / Watchouts
- Do not expose `.env` secrets.
- Do not call football "soccer" in UI, even though Strava returns `Soccer`.
- MHR/RHR are user-defined: max HR 200, resting HR 53. Do not change without asking.
- Readiness weights are user-defined: sleep 40%, RHR 25%, load 25%, manual 10%.
- Sleep records under 60 minutes are filtered out in app rendering as naps.
- Some Health Export files may contain `metrics.sleep: []`; this is normal if the app export did not include sleep yet.
- Browser tool may not be available in some Codex sessions. If unavailable, use static checks and clearly state visual verification was not performed.

## Useful Commands
Run all syncs:

```bash
./sync-all.sh
```

Run sleep only:

```bash
node sync-sleep.js
```

Run Strava only:

```bash
node sync.js
```

Check generated data:

```bash
node --check app.js
node --check sync.js
node --check sync-sleep.js
node --check data/activities.js
node --check data/sleep.js
```

Show current data summary:

```bash
node - <<'NODE'
const fs = require('fs');
const acts = JSON.parse(fs.readFileSync('data/activities.json', 'utf8'));
const sleep = JSON.parse(fs.readFileSync('data/sleep.json', 'utf8')).metrics.sleep;
console.log('activities', acts.length);
console.log('latest activity', acts.map(a => a.start_date_local || a.start_date).sort().at(-1));
console.log('sleep', sleep.length);
console.log('latest sleep', sleep.map(s => s.date).sort().at(-1));
NODE
```

## Recommended Next Work
- If user wants more polish: visually verify every tab in browser after changes.
- Improve Health Export guidance in UI if sleep sync is stale.
- Consider adding a visible "Sleep latest date" chip in Sleep tab, separate from sync timestamp, because sync can happen today while latest actual sleep is yesterday.
- Consider better true RHR/HRV support if Health Export starts providing daily RHR/HRV in a parseable file.
