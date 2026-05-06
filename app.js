/* ============================================================
   FITNESS DASHBOARD APP
   Loads activities + sleep, computes readiness, renders all views.
   Data source: local JSON files (mock-friendly).
   To switch to a live API later, replace loadData() with:
     fetch('/api/dashboard')
   ============================================================ */

// ---- HR Zone definitions (Karvonen) ------------------------------
const ZONE_DEFS = [
  { num: 1, name: 'Warm Up',   pct: [0.50, 0.60], color: '#60a5fa',
    tip: 'Very light effort. Good for warm-up, cool-down and active recovery days.' },
  { num: 2, name: 'Fat Burn',  pct: [0.60, 0.70], color: '#4ade80',
    tip: 'Easy conversational pace. Primary fuel is fat. Great for long slow runs.' },
  { num: 3, name: 'Aerobic',   pct: [0.70, 0.80], color: '#fbbf24',
    tip: 'Comfortably hard. Builds aerobic base and endurance. The sweet spot for training.' },
  { num: 4, name: 'Anaerobic', pct: [0.80, 0.90], color: '#fb923c',
    tip: 'Hard effort. Lactate builds faster than it clears. Improves speed endurance and race pace.' },
  { num: 5, name: 'VO₂ Max',   pct: [0.90, 1.00], color: '#ef4444',
    tip: 'Maximum effort. Short bursts only. Builds peak aerobic power. Very demanding — use sparingly.' },
];

// ---- Config ------------------------------------------------------
const CONFIG = {
  MAX_HR: 200,
  REST_HR: 53,
  TARGET_SLEEP_H: 8,
  WEEK_DAYS: 7,
  // Readiness weights — sum to 1
  WEIGHTS: { sleep: 0.40, rhr: 0.25, load: 0.25, manual: 0.10 },
};

const STATE = {
  activities: [],
  sleepNights: [],
  manualFeeling: 7,
  view: 'overview',
  charts: {},
  map: null,
  actFilter:    { sport: 'all', range: 'all', from: '', to: '' },
  sleepFilter:  { range: 'all', from: '', to: '' },
  trendsFilter: { range: 'all', from: '', to: '' },
  zonesFilter:  { sport: 'all', range: 'all', from: '', to: '' },
};

// ============================================================
// DATA LOADING
// ============================================================

async function loadData() {
  try {
    let acts, sleepRaw;
    if (window.ACTIVITIES_DATA && window.SLEEP_DATA) {
      acts = window.ACTIVITIES_DATA;
      sleepRaw = window.SLEEP_DATA;
    } else {
      const [actsRes, sleepRes] = await Promise.all([
        fetch('data/activities.json'),
        fetch('data/sleep.json'),
      ]);
      acts = await actsRes.json();
      sleepRaw = await sleepRes.json();
    }

    STATE.activities = Array.isArray(acts) ? acts : (acts.activities || []);
    const sleepArr = sleepRaw.metrics?.sleep || sleepRaw.sleep || [];
    STATE.sleepNights = sleepArr
      .map(s => ({
        ...s,
        totalSleep: (s.stages.deep_min || 0) + (s.stages.core_min || 0) + (s.stages.rem_min || 0),
      }))
      .filter(s => s.totalSleep >= 60)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.error('Data load failed:', e);
  }

  // Restore manual feeling from localStorage
  const stored = localStorage.getItem('manualFeeling');
  if (stored) STATE.manualFeeling = parseInt(stored, 10);
}

// ============================================================
// FORMATTERS
// ============================================================

const fmtPace = (speedMs) => {
  if (!speedMs || speedMs <= 0) return '—';
  const minPerKm = 1000 / speedMs / 60;
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
const fmtPaceMin = (minPerKm) => {
  if (!Number.isFinite(minPerKm) || minPerKm <= 0) return '—';
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
const fmtDist = (m) => (m / 1000).toFixed(1);
const fmtTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtDateShort = (str) => {
  const d = new Date(str);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
};
const fmtTimeOfDay = (str) => {
  return new Date(str).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore'
  });
};

function getZones() {
  const hrr = CONFIG.MAX_HR - CONFIG.REST_HR;
  return ZONE_DEFS.map(z => ({
    ...z,
    low:  Math.round(CONFIG.REST_HR + hrr * z.pct[0]),
    high: z.num === 5 ? CONFIG.MAX_HR : Math.round(CONFIG.REST_HR + hrr * z.pct[1]),
  }));
}

function hrToZoneIdx(bpm) {
  if (!bpm) return null;
  const zones = getZones();
  for (let i = zones.length - 1; i >= 0; i--) {
    if (bpm >= zones[i].low) return i;
  }
  return 0;
}

const sportIcon = (type) => {
  const icons = { Run: '🏃', Soccer: '⚽', Workout: '💪', Pickleball: '🎾', Velomobile: '🚴', Ride: '🚴', Walk: '🚶' };
  return icons[type] || '🏅';
};
const sportColor = (type) => {
  const c = { Run: '#ff5c1a', Soccer: '#22c55e', Workout: '#3b82f6', Pickleball: '#a855f7', Velomobile: '#64748b', Ride: '#64748b', Walk: '#94a3b8' };
  return c[type] || '#64748b';
};
const sportLabel = (type) => type === 'Soccer' ? 'Football' : type;

function windowDates(range, from, to) {
  const now = new Date();
  if (range === 'today') { const s = new Date(now); s.setHours(0,0,0,0); return [s, now]; }
  if (range === '7d')    return [new Date(now - 7  * 864e5), now];
  if (range === '30d')   return [new Date(now - 30 * 864e5), now];
  if (range === 'custom' && from && to) return [new Date(from), new Date(to + 'T23:59:59')];
  return [new Date(0), now];
}

// ============================================================
// READINESS ALGORITHM
// ============================================================

function lastNightSleep() {
  return STATE.sleepNights[STATE.sleepNights.length - 1] || null;
}

function avgRecentSleepHours(days = 7) {
  const recent = STATE.sleepNights.slice(-days);
  if (recent.length === 0) return null;
  return recent.reduce((s, n) => s + n.totalSleep, 0) / recent.length / 60;
}

function sleepDebtHours(days = 7) {
  const recent = STATE.sleepNights.slice(-days);
  if (recent.length === 0) return 0;
  const totalActual = recent.reduce((s, n) => s + n.totalSleep, 0) / 60;
  const totalTarget = recent.length * CONFIG.TARGET_SLEEP_H;
  return Math.max(0, totalTarget - totalActual);
}

// Sleep score 0-100: blend last night + 7d avg vs target 8h
function calcSleepScore() {
  const last = lastNightSleep();
  const avg7 = avgRecentSleepHours(7);
  if (!last || avg7 === null) return 50;
  const lastH = last.totalSleep / 60;
  // Score 0 at 4h, 100 at 8h
  const norm = h => Math.max(0, Math.min(100, ((h - 4) / 4) * 100));
  const s = norm(lastH) * 0.7 + norm(avg7) * 0.3;
  return Math.round(s);
}

// RHR score: lower current RHR vs personal baseline = better
function calcRhrScore() {
  // We use CONFIG.REST_HR as baseline. If current avg HR on rest days is close, good.
  // Without true daily RHR data, infer from low-effort activities.
  const baseline = CONFIG.REST_HR;
  const recentRestActs = STATE.activities
    .filter(a => a.has_heartrate && a.average_heartrate && a.sport_type === 'Run')
    .slice(-5);
  if (recentRestActs.length === 0) return 75; // neutral-good
  const avgRestHR = recentRestActs.reduce((s, a) => s + a.average_heartrate, 0) / recentRestActs.length;
  // Lower is better. avgRestHR 130 = great, 170 = stressed
  const score = Math.max(0, Math.min(100, 100 - (avgRestHR - baseline - 70) * 2));
  return Math.round(score);
}

// Activity load score: optimal ~30km/week. Too little OR too much = lower
function calcLoadScore() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const weekActs = STATE.activities.filter(a => new Date(a.start_date_local) >= weekAgo);
  const weekKm = weekActs.reduce((s, a) => s + a.distance, 0) / 1000;
  // Optimal 25km/week. <10 = undertraining. >50 = overtraining
  let score;
  if (weekKm <= 10) score = 50 + weekKm * 4;          // 50 at 0km, 90 at 10km
  else if (weekKm <= 30) score = 90 + (weekKm - 10) * 0.5; // 90-100 at 10-30
  else score = Math.max(40, 100 - (weekKm - 30) * 2);  // declining over 30
  return Math.round(Math.max(0, Math.min(100, score)));
}

function calcManualScore() {
  return Math.round(STATE.manualFeeling * 10);
}

function calcReadiness() {
  const sleep = calcSleepScore();
  const rhr = calcRhrScore();
  const load = calcLoadScore();
  const manual = calcManualScore();
  const score = Math.round(
    sleep   * CONFIG.WEIGHTS.sleep +
    rhr     * CONFIG.WEIGHTS.rhr +
    load    * CONFIG.WEIGHTS.load +
    manual  * CONFIG.WEIGHTS.manual
  );
  return { score, sleep, rhr, load, manual };
}

function statusFor(score) {
  if (score >= 80) return { label: 'PEAK',         suggestion: 'Push day. Hard intervals or a long effort. Your body is primed.', color: 'var(--peak)' };
  if (score >= 65) return { label: 'GOOD',         suggestion: 'Normal training. Aerobic Z3, tempo or moderate session.',         color: 'var(--good)' };
  if (score >= 50) return { label: 'OKAY',         suggestion: 'Easy session only. Z2 zone, keep it short and conversational.',  color: 'var(--okay)' };
  if (score >= 35) return { label: 'TAKE IT EASY', suggestion: 'Active recovery: walk, mobility, light stretch. Skip the hard stuff today.', color: 'var(--easy)' };
  return                   { label: 'REST',         suggestion: 'Full rest day. Sleep, hydrate, eat well. Body needs it.',          color: 'var(--rest)' };
}

function avg(nums) {
  const valid = nums.filter(n => Number.isFinite(n));
  if (valid.length === 0) return null;
  return valid.reduce((s, n) => s + n, 0) / valid.length;
}

function bestRunWeekKm(runs) {
  const weeks = {};
  runs.forEach(a => {
    const d = new Date(a.start_date_local);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weeks[key] = (weeks[key] || 0) + a.distance;
  });
  return Math.max(0, ...Object.values(weeks)) / 1000;
}

function activityDayKey(a) {
  return new Date(a.start_date_local).toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

function latestWeightKg() {
  const weights = loadWeights().sort((a, b) => b.date.localeCompare(a.date));
  return weights[0]?.value || 65;
}

function estimateCalories(a, weightKg = 65) {
  if (Number.isFinite(a.calories) && a.calories > 0) return a.calories;
  const hours = (a.moving_time || 0) / 3600;
  const met = a.sport_type === 'Soccer' ? 9.5 : a.sport_type === 'Run' ? 8.8 : 5.5;
  return met * weightKg * hours;
}

function estimateSteps(a) {
  const mins = (a.moving_time || 0) / 60;
  if (Number.isFinite(a.average_cadence) && a.average_cadence > 0) {
    const bothFeetCadence = a.average_cadence < 120 ? a.average_cadence * 2 : a.average_cadence;
    return bothFeetCadence * mins;
  }
  const strideM = a.sport_type === 'Soccer' ? 0.72 : 0.78;
  return (a.distance || 0) / strideM;
}

function dayActivitySummary(dateKey) {
  const acts = STATE.activities.filter(a => activityDayKey(a) === dateKey);
  const weight = latestWeightKg();
  return {
    acts,
    calories: acts.reduce((s, a) => s + estimateCalories(a, weight), 0),
    steps: acts.reduce((s, a) => s + estimateSteps(a), 0),
    exerciseMin: acts.reduce((s, a) => s + (a.moving_time || 0), 0) / 60,
  };
}

function compareIndicator(now, prev, reverse = false) {
  const n = Number.isFinite(now) ? now : 0;
  const p = Number.isFinite(prev) ? prev : 0;
  const tolerance = Math.max(2, p * 0.03);
  if (Math.abs(n - p) <= tolerance) return { cls: 'same', mark: '→', text: 'same as yesterday' };
  const improved = reverse ? n < p : n > p;
  return improved
    ? { cls: 'up', mark: '↑', text: 'better than yesterday' }
    : { cls: 'down', mark: '↓', text: 'below yesterday' };
}

function toneForIndicator(ind) {
  if (!ind) return 'ok';
  if (ind.cls === 'up') return 'good';
  if (ind.cls === 'down') return 'warn';
  return 'ok';
}

function toneForMin(value, good, ok) {
  if (!Number.isFinite(value)) return 'ok';
  if (value >= good) return 'good';
  if (value >= ok) return 'ok';
  return 'warn';
}

function toneForMax(value, goodMax, okMax) {
  if (!Number.isFinite(value)) return 'ok';
  if (value <= goodMax) return 'good';
  if (value <= okMax) return 'ok';
  return 'warn';
}

function formatCompactNumber(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function renderDailyMovement() {
  const el = document.getElementById('daily-movement');
  if (!el) return;

  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

  const today = dayActivitySummary(todayKey);
  const prev = dayActivitySummary(yesterdayKey);
  const all = STATE.activities;
  const runMin = all.filter(a => a.sport_type === 'Run').reduce((s, a) => s + (a.moving_time || 0), 0) / 60;
  const footballMin = all.filter(a => a.sport_type === 'Soccer').reduce((s, a) => s + (a.moving_time || 0), 0) / 60;
  const hrActs = all.filter(a => a.has_heartrate && a.average_heartrate);
  const maxHrActs = all.filter(a => a.max_heartrate);
  const avgHr = avg(hrActs.map(a => a.average_heartrate));
  const avgMaxHr = avg(maxHrActs.map(a => a.max_heartrate));
  const weeklyMin = all
    .filter(a => new Date(a.start_date_local) >= new Date(Date.now() - 7 * 864e5))
    .reduce((s, a) => s + (a.moving_time || 0), 0) / 60;
  const doingWell = calcReadiness().score >= 65 && weeklyMin >= 75;
  const loadTone = doingWell ? 'good' : weeklyMin >= 45 ? 'same' : 'down';
  const loadText = doingWell ? 'Training rhythm looks good' : weeklyMin >= 45 ? 'Building base steadily' : 'Low recent training volume';

  const daily = [
    { icon: '🔥', label: 'Calories', value: formatCompactNumber(today.calories), unit: 'kcal', note: 'estimated burn', ind: compareIndicator(today.calories, prev.calories) },
    { icon: '◌', label: 'Steps', value: formatCompactNumber(today.steps), unit: 'steps', note: 'from runs + football', ind: compareIndicator(today.steps, prev.steps) },
    { icon: '⏱', label: 'Exercise', value: Math.round(today.exerciseMin), unit: 'min', note: 'moving time today', ind: compareIndicator(today.exerciseMin, prev.exerciseMin) },
  ].map(item => ({ ...item, tone: toneForIndicator(item.ind) }));

  const total = [
    { label: 'Running time', value: Math.round(runMin), unit: 'min', note: `${(runMin / 60).toFixed(1)}h total`, tone: toneForMin(runMin, 120, 45) },
    { label: 'Football time', value: Math.round(footballMin), unit: 'min', note: `${(footballMin / 60).toFixed(1)}h total`, tone: toneForMin(footballMin, 120, 45) },
    { label: 'Avg HR', value: avgHr ? Math.round(avgHr) : '—', unit: avgHr ? 'bpm' : '', note: 'HR-tracked activities', tone: toneForMax(avgHr, 150, 170) },
    { label: 'Avg Max HR', value: avgMaxHr ? Math.round(avgMaxHr) : '—', unit: avgMaxHr ? 'bpm' : '', note: 'peak HR average', tone: toneForMax(avgMaxHr, 170, 190) },
    { label: 'Resting HR', value: CONFIG.REST_HR, unit: 'bpm', note: 'personal baseline', tone: toneForMax(CONFIG.REST_HR, 58, 65) },
    { label: '7d Exercise', value: Math.round(weeklyMin), unit: 'min', note: loadText, tone: loadTone === 'good' ? 'good' : loadTone === 'same' ? 'ok' : 'warn' },
  ];

  el.innerHTML = `
    <div class="daily-head">
      <div>
        <span class="daily-eyebrow">Today movement</span>
        <h2>Daily burn + effort</h2>
      </div>
      <div class="daily-status ${loadTone}">
        <strong>${doingWell ? 'ON TRACK' : weeklyMin >= 45 ? 'STEADY' : 'LOW LOAD'}</strong>
        <span>${loadText}</span>
      </div>
    </div>

    <div class="daily-grid">
      ${daily.map(item => `
        <div class="daily-card tone-${item.tone}">
          <div class="daily-icon">${item.icon}</div>
          <div class="daily-label">${item.label}</div>
          <div class="daily-value">${item.value}<span>${item.unit}</span></div>
          <div class="daily-note">${item.note}</div>
          <div class="daily-indicator ${item.ind.cls}"><b>${item.ind.mark}</b>${item.ind.text}</div>
        </div>
      `).join('')}
    </div>

    <div class="totality-card">
      <div class="totality-title">
        <span>Totality</span>
        <strong>Long view of your engine</strong>
      </div>
      <div class="totality-grid">
        ${total.map(item => `
          <div class="totality-metric tone-${item.tone}">
            <span>${item.label}</span>
            <strong>${item.value}<em>${item.unit}</em></strong>
            <small>${item.note}</small>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderQuickView() {
  const el = document.getElementById('quick-view');
  if (!el) return;

  const activities = [...STATE.activities].sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));
  const runs = activities.filter(a => a.sport_type === 'Run');
  const football = activities.filter(a => a.sport_type === 'Soccer');
  const hrRuns = runs.filter(a => a.has_heartrate && a.average_heartrate);
  const hrFootball = football.filter(a => a.has_heartrate && a.average_heartrate);
  const cadenceRuns = runs.filter(a => a.average_cadence);
  const totalRunKm = runs.reduce((s, a) => s + a.distance, 0) / 1000;
  const totalElevation = activities.reduce((s, a) => s + (a.total_elevation_gain || 0), 0);
  const avgRunPaceMin = avg(runs.map(a => a.average_speed ? 1000 / a.average_speed / 60 : null));
  const avgRunHr = avg(hrRuns.map(a => a.average_heartrate));
  const avgCadence = avg(cadenceRuns.map(a => a.average_cadence));
  const bestPaceRun = [...runs]
    .filter(a => a.average_speed)
    .sort((a, b) => (1000 / a.average_speed / 60) - (1000 / b.average_speed / 60))[0];
  const longestRun = [...runs].sort((a, b) => b.distance - a.distance)[0];
  const bestCadence = [...cadenceRuns].sort((a, b) => b.average_cadence - a.average_cadence)[0];
  const highestSuffer = activities.filter(a => a.suffer_score).sort((a, b) => b.suffer_score - a.suffer_score)[0];

  const firstRuns = runs.slice(0, 3);
  const lastRuns = runs.slice(-3);
  const firstRunPace = avg(firstRuns.map(a => a.average_speed ? 1000 / a.average_speed / 60 : null));
  const lastRunPace = avg(lastRuns.map(a => a.average_speed ? 1000 / a.average_speed / 60 : null));
  const paceChange = firstRunPace && lastRunPace ? ((lastRunPace - firstRunPace) / firstRunPace) * 100 : null;
  const paceTone = paceChange === null ? 'Not enough run data yet'
    : Math.abs(paceChange) < 1 ? 'fairly consistent'
    : paceChange < 0 ? 'getting quicker'
    : 'slower recently';
  const paceArrow = paceChange === null ? '—' : paceChange < -1 ? '↓' : paceChange > 1 ? '↑' : '→';
  const paceTrendTone = paceChange === null ? 'ok' : paceChange < -1 ? 'good' : paceChange > 1 ? 'warn' : 'ok';
  const paceMeter = paceChange === null ? 50 : Math.max(8, Math.min(100, 50 - (paceChange * 8)));

  const firstFbHr = avg(hrFootball.slice(0, 3).map(a => a.average_heartrate));
  const lastFbHr = avg(hrFootball.slice(-3).map(a => a.average_heartrate));
  const fbHrDrop = firstFbHr && lastFbHr ? firstFbHr - lastFbHr : null;
  const fbFitness = fbHrDrop === null ? 'Need more HR-tracked football'
    : fbHrDrop > 3 ? 'HR dropping — getting fitter'
    : fbHrDrop < -3 ? 'HR rising — watch fatigue'
    : 'HR steady under football load';
  const footballTone = fbHrDrop === null ? 'ok' : fbHrDrop > 3 ? 'good' : fbHrDrop < -3 ? 'warn' : 'ok';
  const footballMeter = fbHrDrop === null ? 50 : Math.max(8, Math.min(100, 50 + (fbHrDrop * 5)));

  const bestWeek = bestRunWeekKm(runs);
  const volumeTone = bestWeek >= 8 ? 'good' : bestWeek >= 4 ? 'ok' : 'warn';
  const volumeMeter = Math.max(8, Math.min(100, bestWeek * 10));
  const prNote = bestPaceRun
    ? `PR set on "${bestPaceRun.name}" — that is your current benchmark.`
    : 'Log more runs to unlock pace PR analysis.';
  const footballNote = hrFootball.length
    ? `You averaged ${Math.round(avg(hrFootball.map(a => a.average_heartrate)))} bpm across football sessions — that is proper match intensity.`
    : 'Add HR data to football sessions for a better fitness trend.';

  const metricCards = [
    { icon: '↗', label: 'Total Runs', value: runs.length, unit: '', sub: 'Running activities only', accent: 'var(--c-run)', tone: toneForMin(runs.length, 8, 4) },
    { icon: '⌁', label: 'Total Distance', value: totalRunKm.toFixed(1), unit: 'km', sub: 'All runs combined', accent: 'var(--c-run)', tone: toneForMin(totalRunKm, 20, 10) },
    { icon: '◷', label: 'Avg Pace', value: fmtPaceMin(avgRunPaceMin), unit: '', sub: 'min/km across all runs', accent: 'var(--c-run)', tone: toneForMax(avgRunPaceMin, 7.5, 8.5) },
    { icon: '♥', label: 'Avg Heart Rate', value: avgRunHr ? Math.round(avgRunHr) : '—', unit: avgRunHr ? 'bpm' : '', sub: 'HR-tracked runs only', accent: 'var(--rest)', tone: toneForMax(avgRunHr, 145, 160) },
    { icon: '✦', label: 'Total Activities', value: activities.length, unit: '', sub: 'All sport types', accent: 'var(--good)', tone: toneForMin(activities.length, 14, 7) },
    { icon: '△', label: 'Total Elevation', value: Math.round(totalElevation), unit: 'm', sub: 'All activities combined', accent: 'var(--good)', tone: toneForMin(totalElevation, 500, 200) },
    { icon: '●', label: 'Football Sessions', value: football.length, unit: '', sub: 'Matches + training', accent: 'var(--c-workout)', tone: toneForMin(football.length, 4, 2) },
    { icon: '≋', label: 'Avg Cadence', value: avgCadence ? Math.round(avgCadence) : '—', unit: avgCadence ? 'spm' : '', sub: 'Steps/min from tracked runs', accent: 'var(--c-workout)', tone: toneForMin(avgCadence, 82, 76) },
  ];

  el.innerHTML = `
    <div class="quick-grid">
      ${metricCards.map(card => `
        <div class="quick-stat tone-${card.tone}">
          <div class="quick-top"><span class="quick-icon">${card.icon}</span><div class="quick-label">${card.label}</div></div>
          <div class="quick-value">${card.value}${card.unit ? `<span>${card.unit}</span>` : ''}</div>
          <div class="quick-sub">${card.sub}</div>
        </div>
      `).join('')}
    </div>

    <div class="quick-section-title">
      <span>Are you getting better?</span>
      <b>Progress analysis</b>
    </div>

    <div class="quick-analysis">
      <article class="quick-panel tone-${paceTrendTone}">
        <div class="panel-orb">${paceTrendTone === 'good' ? '↯' : paceTrendTone === 'warn' ? '!' : '→'}</div>
        <div class="quick-label">Run pace trend (effort runs)</div>
        <div class="quick-verdict">${paceArrow} ${paceChange === null ? '—' : `${Math.abs(paceChange).toFixed(1)}% pace change`} —<br>${paceTone}</div>
        <div class="quick-meter"><span style="width:${paceMeter}%"></span></div>
        <div class="quick-split">
          <div><span>First 3 runs avg</span><strong>${fmtPaceMin(firstRunPace)}</strong></div>
          <div><span>Last 3 runs avg</span><strong>${fmtPaceMin(lastRunPace)}</strong></div>
        </div>
        <p class="quick-note">Your trial-prep runs are clustered around ${fmtPaceMin(avgRunPaceMin)}/km. That consistency is useful: now the goal is controlled speed without letting recovery drop.</p>
      </article>

      <article class="quick-panel tone-${footballTone}">
        <div class="panel-orb">${footballTone === 'good' ? '↯' : footballTone === 'warn' ? '!' : '≈'}</div>
        <div class="quick-label">Football fitness (heart rate trend)</div>
        <p class="quick-copy">Avg HR in older sessions vs. recent</p>
        <div class="quick-split">
          <div><span>First 3 sessions avg HR</span><strong>${firstFbHr ? Math.round(firstFbHr) : '—'}${firstFbHr ? ' bpm' : ''}</strong></div>
          <div><span>Last 3 sessions avg HR</span><strong>${lastFbHr ? Math.round(lastFbHr) : '—'}${lastFbHr ? ' bpm' : ''}</strong></div>
        </div>
        <div class="quick-meter"><span style="width:${footballMeter}%"></span></div>
        <div class="quick-callout ${fbHrDrop !== null && fbHrDrop > 3 ? 'good' : fbHrDrop !== null && fbHrDrop < -3 ? 'warn' : ''}">${fbFitness}</div>
        <p class="quick-note">${footballNote}</p>
      </article>

      <article class="quick-panel tone-${volumeTone}">
        <div class="panel-orb">◆</div>
        <div class="quick-label">Volume & bests</div>
        <div class="quick-big">${bestWeek.toFixed(1)}<span>km</span></div>
        <p class="quick-copy">Best week distance (runs)</p>
        <div class="quick-meter"><span style="width:${volumeMeter}%"></span></div>
        <div class="quick-split">
          <div><span>Longest run</span><strong>${longestRun ? fmtDist(longestRun.distance) : '—'}${longestRun ? ' km' : ''}</strong></div>
          <div><span>Best pace PR</span><strong>${bestPaceRun ? fmtPace(bestPaceRun.average_speed) : '—'}</strong></div>
        </div>
        <p class="quick-note">${prNote}</p>
      </article>
    </div>

    <div class="quick-pr-strip">
      <div><span>Fastest pace PR</span><strong>${bestPaceRun ? fmtPace(bestPaceRun.average_speed) : '—'}</strong></div>
      <div><span>Longest run</span><strong>${longestRun ? fmtDist(longestRun.distance) : '—'}${longestRun ? ' km' : ''}</strong></div>
      <div><span>Best cadence</span><strong>${bestCadence ? Math.round(bestCadence.average_cadence) : '—'}${bestCadence ? ' spm' : ''}</strong></div>
      <div><span>Highest suffer score</span><strong>${highestSuffer ? highestSuffer.suffer_score : '—'}</strong></div>
    </div>
  `;
}

// ============================================================
// VIEW: OVERVIEW
// ============================================================

function renderOverview() {
  const r = calcReadiness();
  const status = statusFor(r.score);
  const last = lastNightSleep();
  const avgSleep = avgRecentSleepHours(7);
  const debt = sleepDebtHours(7);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const weekActs = STATE.activities.filter(a => new Date(a.start_date_local) >= weekAgo);
  const weekKm = weekActs.reduce((s, a) => s + a.distance, 0) / 1000;
  const lastAct = [...STATE.activities].sort((a, b) => new Date(b.start_date_local) - new Date(a.start_date_local))[0];
  const recentSoccer = STATE.activities
    .filter(a => a.sport_type === 'Soccer' && new Date(a.start_date_local) >= new Date(now.getTime() - 14 * 24 * 3600 * 1000))
    .length;
  const fbReadiness = Math.round(r.score * 0.85 + (r.load > 70 ? 10 : 0));

  // Hero
  animateCounter(document.getElementById('score-num'), r.score, { duration: 900 });
  document.getElementById('status-pill').textContent = status.label;
  document.getElementById('hero-headline').textContent =
    status.label === 'PEAK' ? 'Green light for intensity'
    : status.label === 'GOOD' ? 'Train, but keep it controlled'
    : status.label === 'OKAY' ? 'Useful day for easy volume'
    : status.label === 'TAKE IT EASY' ? 'Recovery is the session'
    : 'Bank recovery first';
  document.getElementById('suggestion').innerHTML = `<strong>${status.label}.</strong> ${status.suggestion}`;
  document.getElementById('hero-signals').innerHTML = `
    <button class="hero-signal" data-jump="sleep">
      <span>Sleep</span>
      <strong>${last ? (last.totalSleep / 60).toFixed(1) : '—'}h</strong>
      <em>${avgSleep ? `7d ${avgSleep.toFixed(1)}h avg` : 'No recent sleep'}</em>
    </button>
    <button class="hero-signal" data-jump="activities">
      <span>7d Load</span>
      <strong>${weekKm.toFixed(1)}km</strong>
      <em>${weekActs.length} activit${weekActs.length === 1 ? 'y' : 'ies'}</em>
    </button>
    <button class="hero-signal" data-jump="activities">
      <span>Last</span>
      <strong>${lastAct ? sportLabel(lastAct.sport_type) : '—'}</strong>
      <em>${lastAct ? `${fmtDist(lastAct.distance)}km · ${fmtDateShort(lastAct.start_date_local)}` : 'No activity yet'}</em>
    </button>
  `;
  document.querySelectorAll('.hero-signal[data-jump]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.jump));
  });
  const hero = document.getElementById('hero');
  hero.style.setProperty('--status-color', status.color);
  document.getElementById('status-pill').style.setProperty('--status-color', status.color);

  // Animate ring
  const ring = document.getElementById('score-ring-fg');
  const C = 2 * Math.PI * 86;
  ring.setAttribute('stroke-dasharray', C);
  ring.setAttribute('stroke-dashoffset', C - (r.score / 100) * C);

  // Cards
  renderDailyMovement();
  renderQuickView();

  const cardsEl = document.getElementById('overview-cards');
  cardsEl.className = 'overview-actions';
  cardsEl.innerHTML = `
    <button class="action-card tone-${r.score >= 65 ? 'good' : r.score >= 50 ? 'ok' : 'warn'}" data-jump="recovery">
      <i>✦</i><span>Recovery factors</span>
      <strong>${r.score}/100</strong>
      <em>Sleep ${r.sleep} · Load ${r.load}</em>
    </button>
    <button class="action-card tone-${debt < 2 ? 'good' : debt < 5 ? 'ok' : 'warn'}" data-jump="sleep">
      <i>◐</i><span>Sleep plan</span>
      <strong>${debt.toFixed(1)}h short</strong>
      <em>${debt < 2 ? 'On track' : debt < 5 ? 'Recoverable tonight' : 'Prioritise rest'}</em>
    </button>
    <button class="action-card tone-${fbReadiness >= 70 ? 'good' : fbReadiness >= 50 ? 'ok' : 'warn'}" data-jump="zones">
      <i>●</i><span>Football readiness</span>
      <strong>${fbReadiness}/100</strong>
      <em>${recentSoccer} match${recentSoccer === 1 ? '' : 'es'} in 14d</em>
    </button>
    <button class="action-card tone-${weekActs.length >= 3 ? 'good' : weekActs.length >= 1 ? 'ok' : 'warn'}" data-jump="activities">
      <i>↗</i><span>Training log</span>
      <strong>${weekActs.length}</strong>
      <em>Open activity detail</em>
    </button>
  `;

  // Make cards tap-jump to other views
  cardsEl.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.jump));
  });
}

// ============================================================
// VIEW: SLEEP
// ============================================================

function renderSleep() {
  const { range, from, to } = STATE.sleepFilter;
  const [start, end] = windowDates(range, from, to);
  const today = new Date().toISOString().slice(0, 10);

  // ── Date range filter ────────────────────────────────────
  const rangeChips = [
    { val: 'all',   label: 'All' },
    { val: '7d',    label: '7 days' },
    { val: '30d',   label: '30 days' },
    { val: 'custom',label: 'Custom' },
  ];
  document.getElementById('sleep-filters').innerHTML = `
    <div class="filter-bar">
      ${rangeChips.map(c => `<button class="filter-btn${c.val===range?' active':''}" data-val="${c.val}">${c.label}</button>`).join('')}
    </div>
    ${range === 'custom' ? `
    <div class="custom-range">
      <input type="date" id="sleep-from" value="${from}" max="${today}">
      <span class="range-sep">→</span>
      <input type="date" id="sleep-to" value="${to}" max="${today}">
    </div>` : ''}
  `;
  document.getElementById('sleep-filters').querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => { STATE.sleepFilter.range = btn.dataset.val; renderSleep(); });
  });
  if (range === 'custom') {
    document.getElementById('sleep-from').addEventListener('change', e => { STATE.sleepFilter.from = e.target.value; renderSleep(); });
    document.getElementById('sleep-to').addEventListener('change',   e => { STATE.sleepFilter.to   = e.target.value; renderSleep(); });
  }

  // ── Filtered nights for rec card + chart ─────────────────
  const filtered = STATE.sleepNights.filter(n => {
    const d = new Date(n.date);
    return d >= start && d <= end;
  });

  // ── Recommendation card ──────────────────────────────────
  const recEl = document.getElementById('sleep-rec');
  if (filtered.length > 0) {
    const avgH    = filtered.reduce((s, n) => s + n.totalSleep, 0) / filtered.length / 60;
    const target  = CONFIG.TARGET_SLEEP_H;
    const pct     = Math.min(1, avgH / target);
    const deficit = target - avgH;
    const debtH   = Math.max(0, deficit * filtered.length).toFixed(1);
    const fillColor = pct >= 0.95 ? 'var(--peak)' : pct >= 0.80 ? 'var(--good)' : pct >= 0.65 ? 'var(--okay)' : 'var(--rest)';
    let msg;
    if (deficit <= -0.5)   msg = `You're averaging <strong>${avgH.toFixed(1)}h</strong> — above your ${target}h target. Great recovery base.`;
    else if (deficit < 0.25) msg = `Averaging <strong>${avgH.toFixed(1)}h</strong> — right on your ${target}h target. Keep it consistent.`;
    else if (deficit < 1)  msg = `Averaging <strong>${avgH.toFixed(1)}h</strong> — ${Math.round(deficit*60)} min short of ${target}h. Try an earlier bedtime.`;
    else                   msg = `Averaging only <strong>${avgH.toFixed(1)}h</strong> — ${deficit.toFixed(1)}h below target. ${debtH}h debt built up. Prioritise sleep.`;

    recEl.innerHTML = `
      <div class="sleep-rec-card">
        <div class="sleep-rec-header">
          <span class="lbl">Sleep target</span>
          <span class="avg" style="color:${fillColor}">${avgH.toFixed(1)}h <span style="color:var(--muted);font-weight:400">of ${target}h</span></span>
        </div>
        <div class="sleep-rec-track">
          <div class="sleep-rec-fill" style="width:${Math.round(pct*100)}%;background:${fillColor}"></div>
        </div>
        <div class="sleep-rec-msg">${msg}</div>
      </div>
    `;
  } else {
    recEl.innerHTML = '';
  }

  const last = lastNightSleep();
  if (!last) return;
  const totalMin = last.totalSleep + last.stages.awake_min;
  const totalSleep = last.totalSleep;
  const h = Math.floor(totalSleep / 60);
  const m = totalSleep % 60;

  document.getElementById('sleep-total-h').textContent = h;
  document.getElementById('sleep-total-m').textContent = m;
  document.getElementById('sleep-bedtime').textContent = fmtTimeOfDay(last.bed_start);
  document.getElementById('sleep-waketime').textContent = fmtTimeOfDay(last.bed_end);
  document.getElementById('sleep-times').textContent =
    `${fmtTimeOfDay(last.bed_start)} → ${fmtTimeOfDay(last.bed_end)}`;
  document.getElementById('sleep-debt').firstChild.textContent = sleepDebtHours(7).toFixed(1);
  document.getElementById('sleep-eff').firstChild.textContent =
    Math.round(totalSleep / totalMin * 100);

  // Stage bar
  const STAGE = [
    { k: 'deep_min',  label: 'Deep',  c: 'var(--s-deep)',  tip: 'Most physically restorative stage. Body repairs muscles and releases growth hormone. Aim for 15–25% of sleep.' },
    { k: 'core_min',  label: 'Core',  c: 'var(--s-core)',  tip: 'Light NREM sleep. Makes up most of your total sleep time. Supports memory consolidation.' },
    { k: 'rem_min',   label: 'REM',   c: 'var(--s-rem)',   tip: 'Rapid Eye Movement — when you dream. Key for emotional recovery and learning. Aim for 20–25% of sleep.' },
    { k: 'awake_min', label: 'Awake', c: 'var(--s-awake)', tip: 'Brief arousals during the night. Some is normal — under 10% of total sleep time is healthy.' },
  ];
  const bar = document.getElementById('sleep-stage-bar');
  bar.innerHTML = STAGE
    .filter(s => last.stages[s.k] > 0)
    .map(s => `<div class="stage-seg" style="flex:${last.stages[s.k]};background:${s.c}" title="${s.label}: ${last.stages[s.k]} min"></div>`)
    .join('');
  document.getElementById('sleep-stage-legend').innerHTML = STAGE
    .map(s => `<div class="stage-leg"><div class="swatch" style="background:${s.c}"></div><span class="label" data-tip="${s.tip}">${s.label}</span><span class="num">${last.stages[s.k]}m</span></div>`)
    .join('');

  // Chart: use filtered nights (capped at 30 for readability)
  const recent = filtered.slice(-30);
  const labels = recent.map(n => fmtDateShort(n.date));
  destroyChart('chart-sleep-week');
  STATE.charts['chart-sleep-week'] = new Chart(document.getElementById('chart-sleep-week'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Deep',  data: recent.map(n => +(n.stages.deep_min / 60).toFixed(2)),  backgroundColor: '#4f46e5', stack: 's' },
        { label: 'Core',  data: recent.map(n => +(n.stages.core_min / 60).toFixed(2)),  backgroundColor: '#818cf8', stack: 's' },
        { label: 'REM',   data: recent.map(n => +(n.stages.rem_min / 60).toFixed(2)),   backgroundColor: '#06b6d4', stack: 's' },
        { label: 'Awake', data: recent.map(n => +(n.stages.awake_min / 60).toFixed(2)), backgroundColor: '#475569', stack: 's' },
      ]
    },
    options: chartOptsStacked()
  });
}

// ============================================================
// VIEW: ACTIVITIES
// ============================================================

function renderActivities() {
  const { sport, range, from, to } = STATE.actFilter;
  const [start, end] = windowDates(range, from, to);
  const today = new Date().toISOString().slice(0, 10);

  // ── Filter UI ────────────────────────────────────────────
  const sportChips = [
    { val: 'all',    label: 'All' },
    { val: 'Run',    label: '🏃 Run' },
    { val: 'Soccer', label: '⚽ Football' },
  ];
  const rangeChips = [
    { val: 'all',   label: 'All' },
    { val: 'today', label: 'Today' },
    { val: '7d',    label: '7 days' },
    { val: '30d',   label: '30 days' },
    { val: 'custom',label: 'Custom' },
  ];

  document.getElementById('act-filters').innerHTML = `
    <div class="filter-bar">
      ${sportChips.map(c => `<button class="filter-btn${c.val===sport?' active':''}" data-ftype="sport" data-val="${c.val}">${c.label}</button>`).join('')}
    </div>
    <div class="filter-bar">
      ${rangeChips.map(c => `<button class="filter-btn${c.val===range?' active':''}" data-ftype="range" data-val="${c.val}">${c.label}</button>`).join('')}
    </div>
    ${range === 'custom' ? `
    <div class="custom-range">
      <input type="date" id="act-from" value="${from}" max="${today}">
      <span class="range-sep">→</span>
      <input type="date" id="act-to" value="${to}" max="${today}">
    </div>` : ''}
  `;

  document.getElementById('act-filters').querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.ftype === 'sport') STATE.actFilter.sport = btn.dataset.val;
      else STATE.actFilter.range = btn.dataset.val;
      renderActivities();
    });
  });
  if (range === 'custom') {
    document.getElementById('act-from').addEventListener('change', e => { STATE.actFilter.from = e.target.value; renderActivities(); });
    document.getElementById('act-to').addEventListener('change',   e => { STATE.actFilter.to   = e.target.value; renderActivities(); });
  }

  // ── Apply filters ────────────────────────────────────────
  if (range === 'custom' && (!from || !to)) {
    document.getElementById('act-summary').innerHTML = '';
    document.getElementById('activity-list').innerHTML = '<div class="empty">Pick a start and end date above.</div>';
    initMap();
    return;
  }

  const filtered = STATE.activities
    .filter(a => {
      const d = new Date(a.start_date_local);
      return d >= start && d <= end && (sport === 'all' || a.sport_type === sport);
    })
    .sort((a, b) => new Date(b.start_date_local) - new Date(a.start_date_local));

  // ── Summary chips ────────────────────────────────────────
  const runs     = filtered.filter(a => a.sport_type === 'Run');
  const football = filtered.filter(a => a.sport_type === 'Soccer');
  const totalDist = filtered.reduce((s, a) => s + a.distance, 0) / 1000;
  const totalTime = filtered.reduce((s, a) => s + a.moving_time, 0);

  document.getElementById('act-summary').innerHTML = filtered.length === 0 ? '' : `
    <div class="act-summary">
      ${runs.length     ? `<div class="act-summary-chip">🏃 ${runs.length} Run${runs.length !== 1 ? 's' : ''}</div>` : ''}
      ${football.length ? `<div class="act-summary-chip">⚽ ${football.length} Football</div>` : ''}
      ${filtered.length > 0 ? `<div class="act-summary-chip">${totalDist.toFixed(1)} km</div>` : ''}
      ${totalTime > 0   ? `<div class="act-summary-chip">${fmtTime(totalTime)}</div>` : ''}
    </div>
  `;

  // ── Activity list ────────────────────────────────────────
  const listEl = document.getElementById('activity-list');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty">No activities in this period.</div>';
  } else {
    listEl.innerHTML = filtered.map(a => `
      <div class="activity-item">
        <div class="activity-icon" style="--icon-bg:${sportColor(a.sport_type)}33">${sportIcon(a.sport_type)}</div>
        <div class="activity-meta">
          <div class="activity-name">${a.name}</div>
          <div class="activity-info">
            <span>${fmtDateShort(a.start_date_local)}</span>
            <span>${fmtDist(a.distance)} km</span>
            <span>${fmtTime(a.moving_time)}</span>
            ${a.has_heartrate && a.average_heartrate ? `<span>♥ ${Math.round(a.average_heartrate)}</span>` : ''}
            ${a.total_elevation_gain ? `<span>↑ ${Math.round(a.total_elevation_gain)}m</span>` : ''}
          </div>
        </div>
        <div class="activity-pace">
          ${a.sport_type === 'Run' ? fmtPace(a.average_speed) : sportLabel(a.sport_type)}
          <span class="lbl">${a.sport_type === 'Run' ? '/km' : ''}</span>
        </div>
      </div>
    `).join('');
  }

  initMap();
}

// ============================================================
// VIEW: RECOVERY
// ============================================================

function renderRecovery() {
  const r = calcReadiness();
  const last = lastNightSleep();
  const lastH = last ? (last.totalSleep / 60) : 0;
  const avg7 = avgRecentSleepHours(7);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const weekKm = STATE.activities.filter(a => new Date(a.start_date_local) >= weekAgo)
    .reduce((s, a) => s + a.distance, 0) / 1000;

  // Plain English explanation
  const reasons = [];
  if (r.sleep >= 75) reasons.push(`You slept ${lastH.toFixed(1)}h last night — that's strong`);
  else if (r.sleep < 50) reasons.push(`Only ${lastH.toFixed(1)}h sleep last night — under recovered`);
  else reasons.push(`Sleep was ${lastH.toFixed(1)}h — adequate but not great`);

  if (r.load >= 80) reasons.push(`weekly volume of ${weekKm.toFixed(1)}km is in the sweet spot`);
  else if (r.load < 50) reasons.push(`light week (${weekKm.toFixed(1)}km) — body is fresh`);
  else reasons.push(`high recent load (${weekKm.toFixed(1)}km) — accumulating fatigue`);

  document.getElementById('recovery-explainer').innerHTML =
    `<strong>Score: ${r.score}/100.</strong> ${reasons.join(', and ')}.`;

  document.getElementById('rec-rhr').firstChild.textContent = CONFIG.REST_HR;
  document.getElementById('rec-load').firstChild.textContent = weekKm.toFixed(1);
  document.getElementById('rec-sleep').firstChild.textContent = avg7 ? avg7.toFixed(1) : '—';

  // Factor list
  const factors = [
    { name: 'Sleep',           score: r.sleep,  weight: '40%', color: 'var(--s-deep)',  note: r.sleep >= 75 ? 'Last night and weekly average both solid.' : r.sleep >= 50 ? 'Sleep is okay but not optimal.' : 'Catch up on sleep — biggest lever for recovery.' },
    { name: 'Resting HR / HRV',score: r.rhr,    weight: '25%', color: 'var(--rest)',    note: 'Estimated from recent run effort. Track true RHR for accuracy.' },
    { name: 'Activity Load',   score: r.load,   weight: '25%', color: 'var(--c-run)',   note: r.load >= 75 ? 'Volume is ideal for your fitness.' : r.load >= 50 ? 'Within range — could push more or rest more.' : 'Low recent volume. Body is fresh, but easy to overdo today.' },
    { name: 'Manual Feeling',  score: r.manual, weight: '10%', color: 'var(--okay)',    note: `Your input: ${STATE.manualFeeling}/10. Tap the emoji top-right to update.` },
  ];
  document.getElementById('factor-list').innerHTML = factors.map(f => `
    <div class="factor">
      <div class="factor-head">
        <div class="factor-name">${f.name}<span class="weight">${f.weight}</span></div>
        <div class="factor-score">${f.score}</div>
      </div>
      <div class="factor-bar"><div class="factor-bar-fill" style="--factor-color:${f.color};width:${f.score}%"></div></div>
      <div class="factor-note">${f.note}</div>
    </div>
  `).join('');
}

// ============================================================
// VIEW: TRENDS
// ============================================================

function renderTrends() {
  const { range, from, to } = STATE.trendsFilter;
  const [start, end] = windowDates(range, from, to);
  const today = new Date().toISOString().slice(0, 10);

  // ── Filter UI ────────────────────────────────────────────
  const rangeChips = [
    { val: 'all',    label: 'All' },
    { val: '7d',     label: '7 days' },
    { val: '30d',    label: '30 days' },
    { val: 'custom', label: 'Custom' },
  ];
  document.getElementById('trends-filters').innerHTML = `
    <div class="filter-bar">
      ${rangeChips.map(c => `<button class="filter-btn${c.val===range?' active':''}" data-val="${c.val}">${c.label}</button>`).join('')}
    </div>
    ${range === 'custom' ? `
    <div class="custom-range">
      <input type="date" id="trends-from" value="${from}" max="${today}">
      <span class="range-sep">→</span>
      <input type="date" id="trends-to" value="${to}" max="${today}">
    </div>` : ''}
  `;
  document.getElementById('trends-filters').querySelectorAll('.filter-btn').forEach(btn =>
    btn.addEventListener('click', () => { STATE.trendsFilter.range = btn.dataset.val; renderTrends(); })
  );
  if (range === 'custom') {
    document.getElementById('trends-from').addEventListener('change', e => { STATE.trendsFilter.from = e.target.value; renderTrends(); });
    document.getElementById('trends-to').addEventListener('change',   e => { STATE.trendsFilter.to   = e.target.value; renderTrends(); });
  }

  // ── Filtered data ────────────────────────────────────────
  const filteredActs  = STATE.activities.filter(a => { const d = new Date(a.start_date_local); return d >= start && d <= end; });
  const filteredSleep = STATE.sleepNights.filter(n => { const d = new Date(n.date); return d >= start && d <= end; });

  // Weekly distance — group by ISO week
  const weekly = {};
  filteredActs.forEach(a => {
    const d = new Date(a.start_date_local);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weekly[key] = (weekly[key] || 0) + a.distance;
  });
  const wKeys = Object.keys(weekly).sort();
  destroyChart('chart-weekly-dist');
  STATE.charts['chart-weekly-dist'] = new Chart(document.getElementById('chart-weekly-dist'), {
    type: 'bar',
    data: {
      labels: wKeys.map(k => fmtDateShort(k)),
      datasets: [{
        label: 'km', data: wKeys.map(k => +(weekly[k] / 1000).toFixed(2)),
        backgroundColor: 'rgba(255,92,26,0.7)', borderColor: '#ff5c1a', borderRadius: 6,
      }]
    },
    options: chartOpts()
  });

  // Pace per run
  const runs = filteredActs.filter(a => a.sport_type === 'Run')
    .sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));
  destroyChart('chart-pace');
  STATE.charts['chart-pace'] = new Chart(document.getElementById('chart-pace'), {
    type: 'line',
    data: {
      labels: runs.map(r => fmtDateShort(r.start_date_local)),
      datasets: [{
        label: 'min/km',
        data: runs.map(r => +(1000 / r.average_speed / 60).toFixed(2)),
        borderColor: '#ff5c1a', backgroundColor: 'rgba(255,92,26,0.1)',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ff5c1a',
        tension: 0.3, fill: true,
      }]
    },
    options: chartOpts()
  });

  // HR per activity
  const hrActs = filteredActs.filter(a => a.has_heartrate && a.average_heartrate)
    .sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));
  destroyChart('chart-hr');
  STATE.charts['chart-hr'] = new Chart(document.getElementById('chart-hr'), {
    type: 'line',
    data: {
      labels: hrActs.map(a => fmtDateShort(a.start_date_local)),
      datasets: [{
        label: 'bpm',
        data: hrActs.map(a => Math.round(a.average_heartrate)),
        borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#ef4444',
        tension: 0.3, fill: true,
      }]
    },
    options: chartOpts()
  });

  // Sleep trend
  const recent = filteredSleep.slice(-30);
  destroyChart('chart-sleep-trend');
  STATE.charts['chart-sleep-trend'] = new Chart(document.getElementById('chart-sleep-trend'), {
    type: 'line',
    data: {
      labels: recent.map(n => fmtDateShort(n.date)),
      datasets: [{
        label: 'hours',
        data: recent.map(n => +(n.totalSleep / 60).toFixed(2)),
        borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.15)',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#818cf8',
        tension: 0.3, fill: true,
      }]
    },
    options: chartOpts()
  });

  // Footer stats
  const monthSoccer = filteredActs.filter(a => a.sport_type === 'Soccer').length;
  document.getElementById('trend-soccer-count').firstChild.textContent = monthSoccer;
  const allRunSpeeds = runs.map(r => r.average_speed);
  const avgSpeed = allRunSpeeds.reduce((s, v) => s + v, 0) / Math.max(1, allRunSpeeds.length);
  document.getElementById('trend-avg-pace').textContent = fmtPace(avgSpeed);
}

// ============================================================
// VIEW: ZONES
// ============================================================

function renderZones() {
  const { sport, range, from, to } = STATE.zonesFilter;
  const [start, end] = windowDates(range, from, to);
  const today = new Date().toISOString().slice(0, 10);

  // ── Sport filter ─────────────────────────────────────────
  const sportChips = [
    { val: 'all',     label: 'All' },
    { val: 'Run',     label: 'Run' },
    { val: 'Soccer',  label: 'Football' },
    { val: 'Workout', label: 'Workout' },
  ];
  // ── Date range filter ────────────────────────────────────
  const rangeChips = [
    { val: 'all',    label: 'All' },
    { val: '7d',     label: '7 days' },
    { val: '30d',    label: '30 days' },
    { val: 'custom', label: 'Custom' },
  ];
  document.getElementById('zones-filters').innerHTML = `
    <div class="filter-bar">
      ${sportChips.map(c => `<button class="filter-btn${c.val===sport?' active':''}" data-sport="${c.val}">${c.label}</button>`).join('')}
    </div>
    <div class="filter-bar">
      ${rangeChips.map(c => `<button class="filter-btn${c.val===range?' active':''}" data-val="${c.val}">${c.label}</button>`).join('')}
    </div>
    ${range === 'custom' ? `
    <div class="custom-range">
      <input type="date" id="zones-from" value="${from}" max="${today}">
      <span class="range-sep">→</span>
      <input type="date" id="zones-to" value="${to}" max="${today}">
    </div>` : ''}
  `;
  document.getElementById('zones-filters').querySelectorAll('[data-sport]').forEach(btn =>
    btn.addEventListener('click', () => { STATE.zonesFilter.sport = btn.dataset.sport; renderZones(); })
  );
  document.getElementById('zones-filters').querySelectorAll('[data-val]').forEach(btn =>
    btn.addEventListener('click', () => { STATE.zonesFilter.range = btn.dataset.val; renderZones(); })
  );
  if (range === 'custom') {
    document.getElementById('zones-from').addEventListener('change', e => { STATE.zonesFilter.from = e.target.value; renderZones(); });
    document.getElementById('zones-to').addEventListener('change',   e => { STATE.zonesFilter.to   = e.target.value; renderZones(); });
  }

  const zones = getZones();
  const hrr = CONFIG.MAX_HR - CONFIG.REST_HR;

  document.getElementById('z-mhr').firstChild.textContent = CONFIG.MAX_HR;
  document.getElementById('z-rhr').firstChild.textContent = CONFIG.REST_HR;
  document.getElementById('z-hrr').firstChild.textContent = hrr;

  document.getElementById('zones-list').innerHTML = zones.map(z => `
    <div class="zone-row">
      <div class="zone-badge" style="background:${z.color}22;color:${z.color}">Z${z.num}</div>
      <div class="zone-info">
        <div class="zone-name"><span data-tip="${z.tip}">${z.name}</span></div>
        <div class="zone-range">${z.low}–${z.high} bpm &nbsp;·&nbsp; ${Math.round(z.pct[0]*100)}–${Math.round(z.pct[1]*100)}% HRR</div>
      </div>
      <div class="zone-pct-bar">
        <div class="zone-pct-fill" style="background:${z.color};width:${Math.round(z.pct[1]*100)}%"></div>
      </div>
    </div>
  `).join('');

  // Time in zones: classify each activity by avg HR → zone, sum moving_time
  const zoneMins = new Array(5).fill(0);
  STATE.activities
    .filter(a => { const d = new Date(a.start_date_local); return d >= start && d <= end; })
    .filter(a => sport === 'all' || a.sport_type === sport)
    .filter(a => a.has_heartrate && a.average_heartrate)
    .forEach(a => {
      const i = hrToZoneIdx(a.average_heartrate);
      if (i !== null) zoneMins[i] += Math.round(a.moving_time / 60);
    });

  destroyChart('chart-zones');
  STATE.charts['chart-zones'] = new Chart(document.getElementById('chart-zones'), {
    type: 'bar',
    data: {
      labels: zones.map(z => `Z${z.num} ${z.name}`),
      datasets: [{
        data: zoneMins,
        backgroundColor: zones.map(z => z.color + 'bb'),
        borderColor: zones.map(z => z.color),
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      ...chartOpts(),
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw} min` } },
      },
    },
  });
}

// ============================================================
// VIEW: WEIGHT
// ============================================================

function loadWeights() {
  try { return JSON.parse(localStorage.getItem('dashWeights') || '[]'); } catch { return []; }
}
function saveWeights(ws) {
  localStorage.setItem('dashWeights', JSON.stringify(ws));
}

function renderWeight() {
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById('weight-date');
  if (dateInput && !dateInput.value) dateInput.value = today;

  document.getElementById('weight-add-btn').onclick = () => {
    const val = parseFloat(document.getElementById('weight-input').value);
    const date = document.getElementById('weight-date').value || today;
    if (!val || val < 20 || val > 400) return;
    const ws = loadWeights();
    const idx = ws.findIndex(w => w.date === date);
    if (idx >= 0) ws[idx].value = val; else ws.push({ date, value: val });
    saveWeights(ws);
    document.getElementById('weight-input').value = '';
    renderWeight();
  };

  const weights = loadWeights().sort((a, b) => a.date.localeCompare(b.date));
  const trendColor = v => v > 0 ? 'var(--rest)' : v < 0 ? 'var(--peak)' : 'var(--muted)';

  // Stats
  const statsEl = document.getElementById('weight-stats');
  if (weights.length === 0) {
    statsEl.innerHTML = `
      <div class="stat-compact"><div class="lbl">Latest</div><div class="v">—</div></div>
      <div class="stat-compact"><div class="lbl">Change</div><div class="v">—</div></div>
      <div class="stat-compact"><div class="lbl">7d Trend</div><div class="v">—</div></div>`;
  } else {
    const latest = weights[weights.length - 1];
    const change = +(latest.value - weights[0].value).toFixed(1);
    const w7 = weights.filter(w => new Date(w.date) >= new Date(Date.now() - 7 * 864e5));
    const trend7 = w7.length >= 2 ? +(w7[w7.length-1].value - w7[0].value).toFixed(1) : null;
    statsEl.innerHTML = `
      <div class="stat-compact">
        <div class="lbl">Latest</div>
        <div class="v">${latest.value.toFixed(1)}<span class="u">kg</span></div>
      </div>
      <div class="stat-compact">
        <div class="lbl">Change</div>
        <div class="v" style="color:${trendColor(change)}">${change > 0 ? '+' : ''}${change}<span class="u">kg</span></div>
      </div>
      <div class="stat-compact">
        <div class="lbl">7d Trend</div>
        <div class="v" ${trend7 !== null ? `style="color:${trendColor(trend7)}"` : ''}>
          ${trend7 !== null ? (trend7 > 0 ? '+' : '') + trend7 : '—'}<span class="u">${trend7 !== null ? 'kg' : ''}</span>
        </div>
      </div>`;
  }

  // Chart
  destroyChart('chart-weight');
  if (weights.length > 1) {
    const vals = weights.map(w => w.value);
    const pad  = Math.max(0.5, (Math.max(...vals) - Math.min(...vals)) * 0.3);
    STATE.charts['chart-weight'] = new Chart(document.getElementById('chart-weight'), {
      type: 'line',
      data: {
        labels: weights.map(w => fmtDateShort(w.date)),
        datasets: [{ label: 'kg', data: vals,
          borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.12)',
          borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#60a5fa',
          tension: 0.35, fill: true }]
      },
      options: { ...chartOpts(),
        scales: { ...chartOpts().scales,
          y: { ...chartOpts().scales.y,
            min: Math.min(...vals) - pad, max: Math.max(...vals) + pad } } }
    });
  }

  // Log
  const logEl = document.getElementById('weight-log');
  if (weights.length === 0) {
    logEl.innerHTML = '<div class="empty">No entries yet. Log your first weight above.</div>';
    return;
  }
  const sorted = [...weights].reverse();
  logEl.innerHTML = '<div class="card full">' + sorted.map((w, i) => {
    const prev = sorted[i + 1];
    const diff = prev ? +(w.value - prev.value).toFixed(1) : null;
    return `
      <div class="weight-log-item">
        <div class="weight-log-date">${fmtDateShort(w.date)}</div>
        <div class="weight-log-val">
          ${w.value.toFixed(1)} <span class="weight-log-unit">kg</span>
          ${diff !== null ? `<span class="weight-diff" style="color:${trendColor(diff)}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}</span>` : ''}
        </div>
        <button class="weight-del" data-date="${w.date}" aria-label="Delete">×</button>
      </div>`;
  }).join('') + '</div>';

  logEl.querySelectorAll('.weight-del').forEach(btn =>
    btn.addEventListener('click', () => {
      saveWeights(loadWeights().filter(w => w.date !== btn.dataset.date));
      renderWeight();
    })
  );
}

// ============================================================
// CHART DEFAULTS
// ============================================================

function chartOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(37,42,56,0.6)', display: false }, ticks: { color: '#6b7286', maxRotation: 0, font: { size: 10 } } },
      y: { grid: { color: 'rgba(37,42,56,0.6)' }, ticks: { color: '#6b7286', font: { size: 10 } } }
    }
  };
}
function chartOptsStacked() {
  const o = chartOpts();
  o.scales.x.stacked = true;
  o.scales.y.stacked = true;
  o.plugins.legend = { position: 'bottom', labels: { color: '#a8aebd', boxWidth: 12, padding: 10, font: { size: 11 } } };
  return o;
}
function destroyChart(id) {
  if (STATE.charts[id]) { STATE.charts[id].destroy(); delete STATE.charts[id]; }
}

// ============================================================
// MAP
// ============================================================

function decodePolyline(encoded) {
  if (!encoded) return [];
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

function initMap() {
  if (STATE.map) { setTimeout(() => STATE.map.invalidateSize(), 100); return; }
  if (typeof L === 'undefined') {
    document.getElementById('activity-map').innerHTML =
      '<div class="map-fallback"><div style="font-size:32px">🗺️</div><div style="font-weight:600;color:var(--text)">Map unavailable</div><div style="font-size:11px">No internet or map library blocked.</div></div>';
    return;
  }

  try {
    const map = L.map('activity-map', { center: [1.3521, 103.8198], zoom: 11, zoomControl: true });
    STATE.map = map;
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri', maxZoom: 16
    }).addTo(map);

    const allLatLngs = [];

    STATE.activities.forEach(act => {
      const color = sportColor(act.sport_type);
      const popup = `
        <div class="popup-name">${act.name}</div>
        <div class="popup-row">${fmtDateShort(act.start_date_local)} · <span>${act.sport_type}</span></div>
        <div class="popup-row">Distance: <span>${fmtDist(act.distance)} km</span></div>
        <div class="popup-row">Duration: <span>${fmtTime(act.moving_time)}</span></div>
        ${act.sport_type === 'Run' ? `<div class="popup-row">Pace: <span>${fmtPace(act.average_speed)} /km</span></div>` : ''}
        ${act.has_heartrate && act.average_heartrate ? `<div class="popup-row">HR: <span>${Math.round(act.average_heartrate)} bpm</span></div>` : ''}
      `;
      const path = act.polyline ? decodePolyline(act.polyline) : null;
      if (path && path.length > 1) {
        L.polyline(path, { color: '#000', weight: 6, opacity: 0.4 }).addTo(map);
        L.polyline(path, { color, weight: 3.5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map).bindPopup(popup);
        L.circleMarker(path[0], { radius: 4, fillColor: color, color: '#fff', weight: 1.5, opacity: 1, fillOpacity: 1 }).addTo(map).bindPopup(popup);
        path.forEach(p => allLatLngs.push(p));
      } else if (act.start_latlng && act.start_latlng.length === 2) {
        L.circleMarker(act.start_latlng, {
          radius: act.sport_type === 'Soccer' ? 7 : 5,
          fillColor: color, color: '#0d0f14', weight: 2, opacity: 1, fillOpacity: 0.9
        }).addTo(map).bindPopup(popup);
        allLatLngs.push(act.start_latlng);
      }
    });

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [30, 30], maxZoom: 14 });
    }
    setTimeout(() => map.invalidateSize(), 200);
  } catch (e) {
    console.error('Map failed:', e);
    document.getElementById('activity-map').innerHTML =
      '<div class="map-fallback"><div style="font-size:32px">🗺️</div><div style="font-weight:600;color:var(--text)">Map blocked</div><div style="font-size:11px">Tile servers may be unreachable.</div></div>';
  }
}

// ============================================================
// VIEW SWITCHING
// ============================================================

function switchView(name) {
  STATE.view = name;
  document.querySelectorAll('.view').forEach(v => {
    v.hidden = v.dataset.view !== name;
  });
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('tab-active', t.dataset.tab === name);
  });
  // Render on demand
  const renders = {
    overview: renderOverview,
    sleep: renderSleep,
    activities: renderActivities,
    recovery: renderRecovery,
    trends: renderTrends,
    zones: renderZones,
    weight: renderWeight,
  };
  if (renders[name]) renders[name]();
  // Scroll to top of view
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// MOOD INPUT (manual feeling)
// ============================================================

function setupMood() {
  const moods = [
    { emoji: '😴', value: 3,  label: 'Wrecked' },
    { emoji: '😐', value: 5,  label: 'Meh' },
    { emoji: '🙂', value: 7,  label: 'Good' },
    { emoji: '😊', value: 8,  label: 'Great' },
    { emoji: '🔥', value: 10, label: 'Unstoppable' },
  ];
  const btn = document.getElementById('mood-btn');
  const updateBtn = () => {
    const m = moods.reduce((p, c) => Math.abs(c.value - STATE.manualFeeling) < Math.abs(p.value - STATE.manualFeeling) ? c : p);
    btn.textContent = m.emoji;
    btn.title = `Feeling: ${m.label} (${STATE.manualFeeling}/10) — tap to change`;
  };
  updateBtn();
  btn.addEventListener('click', () => {
    const cur = moods.findIndex(m => m.value === STATE.manualFeeling);
    const next = moods[(cur + 1) % moods.length];
    STATE.manualFeeling = next.value;
    localStorage.setItem('manualFeeling', String(STATE.manualFeeling));
    updateBtn();
    if (STATE.view === 'overview') renderOverview();
    else if (STATE.view === 'recovery') renderRecovery();
  });
}

// ============================================================
// HEADER GREETING
// ============================================================

function setupHeader() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 5 ? 'Late night,' : h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : h < 21 ? 'Good evening,' : 'Good night,';
  document.getElementById('greeting').textContent = `${greet} Haily Rahmad`;
  document.getElementById('today-date').textContent =
    now.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short' });

  const syncEl = document.getElementById('sync-date');
  if (syncEl) {
    const syncSources = [
      { label: 'Activities', ts: window.ACTIVITIES_LAST_SYNC || window.LAST_SYNC },
      { label: 'Sleep', ts: window.SLEEP_LAST_SYNC },
    ]
      .filter(s => s.ts && !Number.isNaN(new Date(s.ts).getTime()))
      .map(s => ({ ...s, date: new Date(s.ts) }));

    if (syncSources.length) {
      const latest = syncSources.reduce((a, b) => a.date > b.date ? a : b);
      const diff = Math.max(0, Math.round((now - latest.date) / 60000));
      const relative = diff < 1 ? 'just now'
        : diff < 60 ? `${diff}m ago`
        : diff < 1440 ? `${Math.floor(diff / 60)}h ago`
        : `${Math.floor(diff / 1440)}d ago`;
      const sameDay = latest.date.toDateString() === now.toDateString();
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString() === latest.date.toDateString();
      const dayLabel = sameDay ? 'Today'
        : yesterday ? 'Yesterday'
        : latest.date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
      const timeLabel = latest.date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false });
      const detail = syncSources
        .map(s => `${s.label}: ${s.date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}, ${s.date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false })}`)
        .join(' • ');

      syncEl.classList.toggle('sync-fresh', sameDay);
      syncEl.classList.toggle('sync-stale', !sameDay);
      syncEl.title = detail;
      syncEl.innerHTML = `<span>Last sync</span><strong>${dayLabel}, ${timeLabel}</strong><em>${relative}</em>`;
    } else {
      syncEl.classList.add('sync-stale');
      syncEl.textContent = 'Last sync: not recorded';
    }
  }
}

// ============================================================
// BOOT
// ============================================================

(async function init() {
  // Chart.js global defaults
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#a8aebd';
    Chart.defaults.borderColor = '#252a38';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 11;
  }

  setupHeader();
  await loadData();
  setupMood();

  // Tab listeners
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchView(t.dataset.tab));
  });

  // Tooltip tap support (mobile — hover doesn't fire on touch)
  document.addEventListener('click', e => {
    const tip = e.target.closest('[data-tip]');
    document.querySelectorAll('[data-tip].tip-open').forEach(el => {
      if (el !== tip) el.classList.remove('tip-open');
    });
    if (tip) tip.classList.toggle('tip-open');
  });

  renderOverview();

  setupScrollReveal();
  setupRipple();
})();

// ============================================================
// UI/UX PRO MAX — INTERACTIONS
// ============================================================

// ── Scroll-reveal via Intersection Observer ───────────────
function setupScrollReveal() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          io.unobserve(e.target); // fire once
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -32px 0px' }
  );

  function attachReveal(root) {
    const targets = root.querySelectorAll(
      '.card, .chart-card, .stat-compact, .factor, .activity-item, ' +
      '.sleep-rec-card, .quick-card, .action-card, .daily-move-item, ' +
      '.zone-row, .weight-log-item, .explainer'
    );
    targets.forEach((el, i) => {
      if (!el.classList.contains('reveal')) {
        el.classList.add('reveal');
        const delay = Math.min(i, 6);
        if (delay > 0) el.classList.add(`reveal-d${delay}`);
        io.observe(el);
      }
    });
  }

  // Attach on initial render and re-attach after any tab switch
  attachReveal(document);

  const origSwitch = window.switchView;
  if (typeof origSwitch === 'function') {
    window.switchView = function(view) {
      origSwitch(view);
      requestAnimationFrame(() => attachReveal(document));
    };
  }

  // Re-observe after JS re-renders content (cards etc.)
  const mo = new MutationObserver(() => attachReveal(document));
  mo.observe(document.getElementById('overview-cards') || document.body, { childList: true, subtree: true });
  ['activity-list','factor-list','weight-log','zones-list','quick-view','daily-movement'].forEach(id => {
    const el = document.getElementById(id);
    if (el) mo.observe(el, { childList: true, subtree: true });
  });
}

// ── Ripple on tap ─────────────────────────────────────────
function setupRipple() {
  const SELECTORS = '.card.tappable, .activity-item, .tab, .filter-btn, .weight-add-btn, .mood-btn, .quick-card, .action-card, .daily-move-item';

  function addRipple(e) {
    const el = e.currentTarget;
    if (!el) return;
    el.classList.add('ripple-host');
    const rect = el.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    const r = document.createElement('span');
    r.className = 'ripple';
    r.style.cssText = `left:${x}px;top:${y}px;width:10px;height:10px`;
    el.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });
  }

  function bindRipple(root) {
    root.querySelectorAll(SELECTORS).forEach(el => {
      if (el.dataset.rippleBound) return;
      el.dataset.rippleBound = '1';
      el.addEventListener('pointerdown', addRipple);
    });
  }

  bindRipple(document);

  // Re-bind after dynamic renders
  const mo = new MutationObserver(() => bindRipple(document));
  mo.observe(document.body, { childList: true, subtree: true });
}

// ── Animated number counter ───────────────────────────────
function animateCounter(el, target, opts = {}) {
  const duration = opts.duration || 800;
  const decimals = opts.decimals ?? 0;
  const suffix   = opts.suffix || '';
  const start    = performance.now();
  const from     = opts.from ?? 0;

  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out-cubic
    const val = from + (target - from) * ease;
    el.textContent = val.toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(step);
    else {
      el.textContent = target.toFixed(decimals) + suffix;
      el.classList.add('num-popped');
      el.addEventListener('animationend', () => el.classList.remove('num-popped'), { once: true });
    }
  }
  requestAnimationFrame(step);
}

// Expose globally so render functions can call it
window.animateCounter = animateCounter;
