// sync.js — Pull latest activities from Strava and update data files
//
// Usage:
//   node sync.js                  - sync latest activities into data/*.json and data/*.js
//   node sync.js --auth <code>    - one-time: exchange auth code for refresh token

const fs = require('node:fs/promises');
const path = require('node:path');

const SCRIPT_DIR = __dirname;
const ENV_PATH = path.join(SCRIPT_DIR, '.env');
const DATA_PATH    = path.join(SCRIPT_DIR, 'data', 'activities.json');
const DATA_JS_PATH = path.join(SCRIPT_DIR, 'data', 'activities.js');

if (typeof fetch !== 'function') {
  console.error('This script requires Node.js 18 or newer.');
  process.exit(1);
}

async function loadEnv() {
  let content;
  try { content = await fs.readFile(ENV_PATH, 'utf8'); }
  catch {
    console.error('Missing .env file. Copy .env.example to .env and fill in your Strava credentials.');
    process.exit(1);
  }
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

async function refreshAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.STRAVA_REFRESH_TOKEN,
  });
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Only fetch activities on/after this date (Singapore time)
const FILTER_AFTER_DATE = '2026-04-05T00:00:00+08:00';
const AFTER_TS = Math.floor(new Date(FILTER_AFTER_DATE).getTime() / 1000);

async function fetchActivities(accessToken) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}&after=${AFTER_TS}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) throw new Error(`Fetch failed: ${r.status} ${await r.text()}`);
    const batch = await r.json();
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

// Map Strava API response to the shape used in index.html
function mapActivity(a) {
  return {
    name: a.name,
    distance: a.distance,
    moving_time: a.moving_time,
    elapsed_time: a.elapsed_time,
    total_elevation_gain: a.total_elevation_gain,
    sport_type: a.sport_type,
    device_name: a.device_name || null,
    start_date_local: a.start_date_local,
    average_speed: a.average_speed,
    max_speed: a.max_speed,
    calories: a.calories ?? null,
    average_cadence: a.average_cadence ?? null,
    has_heartrate: a.has_heartrate,
    average_heartrate: a.average_heartrate ?? null,
    max_heartrate: a.max_heartrate ?? null,
    suffer_score: a.suffer_score ?? null,
    // Real GPS data — for plotting on the map
    polyline: (a.map && a.map.summary_polyline) || null,
    start_latlng: (a.start_latlng && a.start_latlng.length === 2) ? a.start_latlng : null,
    end_latlng: (a.end_latlng && a.end_latlng.length === 2) ? a.end_latlng : null,
  };
}

async function writeActivities(activities) {
  const json = JSON.stringify(activities, null, 2);
  const ts = new Date().toISOString();
  await fs.writeFile(DATA_PATH, json);
  await fs.writeFile(DATA_JS_PATH, `window.ACTIVITIES_DATA = ${json};\nwindow.ACTIVITIES_LAST_SYNC = "${ts}";\nwindow.LAST_SYNC = "${ts}";\n`);
}

async function runAuth(code) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set in .env first.');
    process.exit(1);
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    console.error('Auth failed:', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();

  let envContent = await fs.readFile(ENV_PATH, 'utf8');
  if (envContent.match(/^STRAVA_REFRESH_TOKEN=/m)) {
    envContent = envContent.replace(/^STRAVA_REFRESH_TOKEN=.*$/m, `STRAVA_REFRESH_TOKEN=${data.refresh_token}`);
  } else {
    envContent = envContent.trimEnd() + `\nSTRAVA_REFRESH_TOKEN=${data.refresh_token}\n`;
  }
  await fs.writeFile(ENV_PATH, envContent);
  console.log('Refresh token saved to .env');
  console.log('Now run: node sync.js');
}

function printAuthInstructions() {
  console.error('Usage: node sync.js --auth <code>');
  console.error('');
  console.error('To get a code:');
  console.error('1. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env first.');
  console.error('2. Open this URL in your browser (replace YOUR_CLIENT_ID):');
  console.error('   https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&scope=activity:read_all&approval_prompt=force');
  console.error('3. Click Authorize. The browser will redirect to localhost (page will fail to load — that is fine).');
  console.error('4. From the URL bar, copy the value of the "code" query param.');
  console.error('5. Run: node sync.js --auth <code>');
}

(async () => {
  await loadEnv();

  if (process.argv[2] === '--auth') {
    const code = process.argv[3];
    if (!code) { printAuthInstructions(); process.exit(1); }
    await runAuth(code);
    return;
  }

  for (const k of ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_REFRESH_TOKEN']) {
    if (!process.env[k]) {
      console.error(`Missing ${k} in .env`);
      if (k === 'STRAVA_REFRESH_TOKEN') console.error('Run: node sync.js --auth   for instructions.');
      process.exit(1);
    }
  }

  console.log('Refreshing access token...');
  const t = await refreshAccessToken();
  console.log(`Fetching activities since ${FILTER_AFTER_DATE}...`);
  const acts = await fetchActivities(t.access_token);
  console.log(`Fetched ${acts.length} activities`);
  await writeActivities(acts.map(mapActivity));
  console.log(`Updated data/activities.json (+ activities.js) with ${acts.length} activities. Refresh your browser.`);
})().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
