// sync-sleep.js — Pull latest sleep data from Health Export JSON/ZIP
//                  and write to data/sleep.json.
//
// Looks for the source file in this priority order:
//   1. SLEEP_JSON_FILE in .env  (a specific .json or .zip file path)
//   2. SLEEP_EXPORT_DIR in .env (a folder; uses the newest .json/.zip inside)
//   3. ./sleep.json             (default)

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = __dirname;
const ENV_PATH = path.join(SCRIPT_DIR, '.env');
const DATA_PATH    = path.join(SCRIPT_DIR, 'data', 'sleep.json');
const DATA_JS_PATH = path.join(SCRIPT_DIR, 'data', 'sleep.js');
const DEFAULT_SLEEP_JSON = path.join(SCRIPT_DIR, 'sleep.json');

async function loadEnv() {
  let content;
  try { content = await fs.readFile(ENV_PATH, 'utf8'); } catch { return; }
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

async function findLatestSleepSource() {
  if (process.env.SLEEP_JSON_FILE) return process.env.SLEEP_JSON_FILE;

  if (process.env.SLEEP_EXPORT_DIR) {
    const dir = process.env.SLEEP_EXPORT_DIR;
    const files = await fs.readdir(dir);
    const sources = files.filter(f => /\.(json|zip)$/i.test(f));
    if (sources.length === 0) throw new Error(`No JSON or ZIP files found in ${dir}`);
    const stats = await Promise.all(sources.map(async f => ({
      name: f,
      mtime: (await fs.stat(path.join(dir, f))).mtimeMs
    })));
    stats.sort((a, b) => b.mtime - a.mtime);
    return path.join(dir, stats[0].name);
  }
  return DEFAULT_SLEEP_JSON;
}

function getSleepArray(raw) {
  return (raw.metrics && raw.metrics.sleep) || raw.sleep || (raw.data && raw.data.sleep);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseAppleDate(value) {
  const m = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (!m) return new Date(value);
  return new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
}

function minutesBetween(start, end) {
  return Math.max(0, Math.round((end - start) / 60000));
}

function dateKeySg(date) {
  const parts = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function sleepFromCsv(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headerIndex = lines.findIndex(line => line.startsWith('type,'));
  if (headerIndex === -1) throw new Error('Could not find CSV header in sleep export.');
  const headers = parseCsvLine(lines[headerIndex]);
  const rows = lines.slice(headerIndex + 1).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] || '']));
  });

  const sessions = rows
    .filter(r => r.value === 'inBed')
    .map(r => ({
      bed_start: parseAppleDate(r.startDate),
      bed_end: parseAppleDate(r.endDate),
      stages: { awake_min: 0, core_min: 0, deep_min: 0, rem_min: 0 },
    }))
    .sort((a, b) => a.bed_start - b.bed_start);

  const fallbackSessions = new Map();
  const getFallbackSession = (end) => {
    const key = dateKeySg(end);
    if (!fallbackSessions.has(key)) {
      fallbackSessions.set(key, {
        bed_start: end,
        bed_end: end,
        stages: { awake_min: 0, core_min: 0, deep_min: 0, rem_min: 0 },
      });
    }
    return fallbackSessions.get(key);
  };

  rows.filter(r => r.value !== 'inBed').forEach(r => {
    const start = parseAppleDate(r.startDate);
    const end = parseAppleDate(r.endDate);
    const min = minutesBetween(start, end);
    if (!min) return;
    const session = sessions.find(s => start >= s.bed_start && end <= s.bed_end) || getFallbackSession(end);
    session.bed_start = new Date(Math.min(session.bed_start, start));
    session.bed_end = new Date(Math.max(session.bed_end, end));
    if (r.value === 'asleepDeep') session.stages.deep_min += min;
    else if (r.value === 'asleepREM') session.stages.rem_min += min;
    else if (r.value === 'awake') session.stages.awake_min += min;
    else if (r.value === 'asleepCore' || r.value === 'asleep') session.stages.core_min += min;
  });

  return [...sessions, ...fallbackSessions.values()]
    .map(s => ({
      bed_start: s.bed_start.toISOString(),
      bed_end: s.bed_end.toISOString(),
      date: dateKeySg(s.bed_end),
      stages: s.stages,
    }))
    .filter(s => Object.values(s.stages).some(Boolean));
}

async function readSleepFromSource(sourcePath) {
  if (sourcePath.toLowerCase().endsWith('.zip')) {
    const { stdout: listing } = await execFileAsync('zipinfo', ['-1', sourcePath], { maxBuffer: 1024 * 1024 });
    const csvName = listing.split(/\r?\n/).find(name => /\.csv$/i.test(name));
    if (!csvName) throw new Error(`No CSV file found inside ${sourcePath}`);
    const { stdout } = await execFileAsync('unzip', ['-p', sourcePath, csvName], { maxBuffer: 80 * 1024 * 1024 });
    return sleepFromCsv(stdout);
  }

  const raw = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const sleep = getSleepArray(raw);
  if (!Array.isArray(sleep)) {
    throw new Error('Could not find sleep array in JSON (expected metrics.sleep, sleep, or data.sleep).');
  }
  return sleep.filter(s => s && s.date && s.stages);
}

async function writeSleep(sleepArray) {
  const out = { metrics: { sleep: sleepArray } };
  const json = JSON.stringify(out, null, 2);
  const ts = new Date().toISOString();
  await fs.writeFile(DATA_PATH, json);
  await fs.writeFile(DATA_JS_PATH, `window.SLEEP_DATA = ${json};\nwindow.SLEEP_LAST_SYNC = "${ts}";\n`);
}

(async () => {
  await loadEnv();
  const sourcePath = await findLatestSleepSource();
  console.log(`Reading sleep data from: ${sourcePath}`);

  let sleep = await readSleepFromSource(sourcePath);
  if (sleep.length === 0 && process.env.SLEEP_EXPORT_DIR && !process.env.SLEEP_JSON_FILE) {
    const dir = process.env.SLEEP_EXPORT_DIR;
    const files = (await fs.readdir(dir)).filter(f => /\.(json|zip)$/i.test(f));
    const stats = await Promise.all(files.map(async f => ({
      name: f,
      path: path.join(dir, f),
      mtime: (await fs.stat(path.join(dir, f))).mtimeMs
    })));
    stats.sort((a, b) => b.mtime - a.mtime);

    for (const candidate of stats) {
      if (candidate.path === sourcePath) continue;
      let validSleep = [];
      try { validSleep = await readSleepFromSource(candidate.path); } catch { continue; }
      if (validSleep.length > 0) {
        console.log(`Newest export has 0 sleep records. Falling back to: ${candidate.path}`);
        sleep = validSleep;
        break;
      }
    }
  }
  if (sleep.length === 0) {
    throw new Error('Latest Health Export contains 0 sleep records. Check Health Export permissions/sync before overwriting dashboard data.');
  }
  // Normalise field names that Health Auto Export uses
  sleep = sleep.map(s => {
    const record = {
      bed_start: s.bed_start || s.in_bed_start || s.start,
      bed_end:   s.bed_end   || s.in_bed_end   || s.end,
      date:      s.date,
      stages: {
        awake_min: s.stages.awake_min ?? s.stages.awake ?? 0,
        core_min:  s.stages.core_min  ?? s.stages.core  ?? 0,
        deep_min:  s.stages.deep_min  ?? s.stages.deep  ?? 0,
        rem_min:   s.stages.rem_min   ?? s.stages.rem   ?? 0,
      },
    };
    if (s.resting_heart_rate != null) record.resting_heart_rate = s.resting_heart_rate;
    if (s.heart_rate_variability != null) record.heart_rate_variability = s.heart_rate_variability;
    return record;
  });
  console.log(`Found ${sleep.length} sleep records.`);

  await writeSleep(sleep);
  console.log(`Updated data/sleep.json (+ sleep.js) with ${sleep.length} nights of sleep data.`);
})().catch(err => {
  console.error('Sleep sync failed:', err.message);
  process.exit(1);
});
