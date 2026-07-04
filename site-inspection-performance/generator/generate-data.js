'use strict';
// Deterministic mock data generator for the Site Inspection Performance project.
// Ground truth for shapes and volumes: docs/spec-site-inspection.md.
// Run: node generate-data.js   (writes CSVs to ../data and prints a verification summary)

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- randomness
// Embedded PRNG (mulberry32) so output is identical on any machine and Node
// version. Math.random is not seedable; library PRNGs would add a dependency.
const SEED = 20260628;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const choice = (arr) => arr[Math.floor(rand() * arr.length)];
function weightedIndex(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}
function logNormal(mu, sigma) {
  let u = rand(); if (u === 0) u = 1e-12;
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  return Math.exp(mu + sigma * z);
}

// ---------------------------------------------------------------- dates
const DAY = 86400000;
const d = (y, m, day) => Date.UTC(y, m - 1, day);
const addDays = (t, n) => t + n * DAY;
const diffDays = (a, b) => Math.round((b - a) / DAY);
const fmt = (t) => new Date(t).toISOString().slice(0, 10);
const isWeekday = (t) => { const w = new Date(t).getUTCDay(); return w >= 1 && w <= 5; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const AS_AT = d(2026, 6, 28);
const MONTHS = [];
for (let y = 2025; y <= 2026; y++)
  for (let m = 1; m <= 12; m++)
    if (y === 2025 || m <= 6) MONTHS.push({ y, m, idx: MONTHS.length });

// ---------------------------------------------------------------- tuning
const NA_RATE = 0.04;             // W3: share of answers marked N/A
const BASE_FAIL = 0.14;           // overall fail rate anchor, early 2025
const TREND_DROP = 0.34;          // fail rate falls this fraction across the 18 months
const SIGNAGE_EXTRA_DROP = 0.25;  // Signage improves faster than the rest
const SECTION_MULT = { 'Fire safety': 1.15, 'Electrical': 0.5, 'Housekeeping': 1.15, 'PPE & welfare': 0.95, 'Storage': 0.85, 'Signage': 1.7 };
const REGION_ADJ = { 'North': -0.30, 'Midlands': -0.10, 'Scotland': 0.00, 'South East': 0.05, 'Wales': 0.15, 'South West': 0.40 };
const COVERAGE_FLOOR_DAYS = 55;   // force a visit when a site's gap exceeds this
const HIGH_START = 0.14, HIGH_END = 0.05;  // severity mix shifts away from High
const MED_SHARE = 0.32;
const ACTION_P = { High: 1.0, Medium: 0.28, Low: 0.05 };
const DUE_OFFSET = { High: 14, Medium: 21, Low: 28 };
const CLOSE_MU = 2.5, CLOSE_SIGMA = 0.55;  // median days-to-close ~12
const STALL_WINDOW = 40, STALL_P = 0.45;   // the overdue tail at the as-at date
const DUE_SOON_WINDOW = 10, DUE_SOON_HOLD_P = 0.35; // some work waits for its due date

// ---------------------------------------------------------------- dimensions
const SITES = [
  // name, region, lat, lon
  ['Kingsway Depot', 'North', 53.80, -1.55], ['Tyne Dock Depot', 'North', 54.97, -1.43],
  ['Skelton Grange Hub', 'North', 53.77, -1.46], ['Salford Quays Depot', 'North', 53.47, -2.29],
  ['Teesport Yard', 'North', 54.61, -1.16], ['Carlisle Gateway', 'North', 54.89, -2.94],
  ['Bradford Interchange Depot', 'North', 53.79, -1.75], ['Hull Fleet Depot', 'North', 53.74, -0.34],
  ['Preston Brook Depot', 'North', 53.76, -2.70],
  ['Crewe Annex', 'Midlands', 53.09, -2.44], ['Fenton Works', 'Midlands', 53.00, -2.16],
  ['Leicester Brook Depot', 'Midlands', 52.63, -1.13], ['Derby Litchurch Yard', 'Midlands', 52.91, -1.46],
  ['Coventry Gateway Hub', 'Midlands', 52.39, -1.48], ['Wolverhampton Basin Depot', 'Midlands', 52.59, -2.13],
  ['Northampton Crossfield Hub', 'Midlands', 52.24, -0.90], ['Rugby Junction Depot', 'Midlands', 52.37, -1.26],
  ['Ely Sidings', 'South East', 52.40, 0.26], ['Dartford Clearway Depot', 'South East', 51.44, 0.22],
  ['Basildon Marsh Hub', 'South East', 51.57, 0.46], ['Reading Green Park Depot', 'South East', 51.42, -0.98],
  ['Ashford Orbital Yard', 'South East', 51.15, 0.87], ['Slough Trading Depot', 'South East', 51.52, -0.62],
  ['Luton Percival Hub', 'South East', 51.88, -0.42], ['Medway City Depot', 'South East', 51.40, 0.55],
  ['Falkirk Hub', 'Scotland', 56.00, -3.78], ['Perth North', 'Scotland', 56.41, -3.44],
  ['Clydebank Riverside Depot', 'Scotland', 55.90, -4.40], ['Aberdeen Harbour Yard', 'Scotland', 57.14, -2.08],
  ['Livingston Deans Hub', 'Scotland', 55.90, -3.55], ['Dundee Camperdown Depot', 'Scotland', 56.48, -3.03],
  ['Inverness Longman Depot', 'Scotland', 57.49, -4.22],
  ['Neath Yard', 'Wales', 51.66, -3.80], ['Newport Docks Depot', 'Wales', 51.57, -2.99],
  ['Wrexham Industrial Hub', 'Wales', 53.03, -2.94], ['Swansea Fabian Way Depot', 'Wales', 51.63, -3.90],
  ['Deeside Park Depot', 'Wales', 53.21, -3.03],
  ['Avonmouth 3', 'South West', 51.50, -2.70], ['Exeter Matford Depot', 'South West', 50.70, -3.53],
  ['Plymouth Cattedown Yard', 'South West', 50.36, -4.11], ['Gloucester Quays Hub', 'South West', 51.86, -2.25],
  ['Taunton Priory Depot', 'South West', 51.02, -3.10],
].map(([name, region, lat, lon], i) => ({
  key: i + 1, name, region, lat, lon,
  type: null, freq: null, adj: null,
}));

// Seeded narrative overrides (spec section 3): coverage cut-offs, the repeat
// offender, a model site and two rarely visited sites.
const CUTOFF = { 'Neath Yard': d(2026, 3, 26), 'Ely Sidings': d(2026, 4, 17), 'Perth North': d(2026, 4, 27) };
for (const s of SITES) {
  s.type = rand() < 0.55 ? 'Logistics' : 'Facilities';
  s.freq = 0.7 + rand() * 0.7;
  s.adj = -0.10 + rand() * 0.20;
}
const byName = Object.fromEntries(SITES.map((s) => [s.name, s]));
byName['Kingsway Depot'].adj = 0.45;   // repeat offender
byName['Fenton Works'].adj = -0.25;    // model site
byName['Taunton Priory Depot'].freq = 0.35;   // rarely visited
byName['Inverness Longman Depot'].freq = 0.35;

const PEOPLE = [
  // key, name, role, region, activeFrom, activeTo
  { key: 1, name: 'J. Okafor', role: 'Inspector', region: 'North', from: d(2025, 1, 1), to: null },
  { key: 2, name: 'M. Reid', role: 'Inspector', region: 'Scotland', from: d(2025, 1, 1), to: null },
  { key: 3, name: 'S. Hughes', role: 'Inspector', region: 'South West', from: d(2025, 1, 1), to: null },
  { key: 4, name: 'D. Prasad', role: 'Inspector', region: 'South East', from: d(2025, 1, 1), to: null },
  { key: 5, name: 'C. Whitfield', role: 'Inspector', region: 'Midlands', from: d(2025, 1, 1), to: null },
  { key: 6, name: 'A. Nowak', role: 'Inspector', region: 'Wales', from: d(2025, 1, 1), to: null },
  { key: 7, name: 'R. Sturridge', role: 'Inspector', region: 'North', from: d(2025, 1, 1), to: d(2025, 10, 31) },
  { key: 8, name: 'E. Marsh', role: 'Inspector', region: 'South East', from: d(2026, 2, 1), to: null },
  { key: 9, name: 'L. Farrant', role: 'Site manager', region: 'Midlands', from: d(2025, 1, 1), to: null },
  { key: 10, name: 'G. Osei', role: 'Site manager', region: 'North', from: d(2025, 1, 1), to: null },
];
const activeAt = (p, t) => t >= p.from && (p.to === null || t <= p.to);

const LOCS = ['level 2', 'loading bay 6', 'aisle 4', 'the east exit', 'the welfare cabin', 'the yard gate', 'store B', 'the mezzanine', 'the dock office', 'the north stairwell', 'bay 2', 'the main workshop'];
const QUESTIONS = [
  ['FS-01', 'Fire safety', 'Fire door closes fully unaided', 'Fire door at {loc} catches on frame and does not latch', 'Adjust and repair fire door at {loc}'],
  ['FS-02', 'Fire safety', 'Fire extinguishers in date and accessible', 'Extinguisher at {loc} past its service date', 'Arrange service or replacement of extinguisher at {loc}'],
  ['FS-03', 'Fire safety', 'Fire alarm call points unobstructed', 'Call point at {loc} blocked by stored materials', 'Clear access to fire alarm call point at {loc}'],
  ['FS-04', 'Fire safety', 'Emergency lighting operational', 'Emergency light at {loc} not illuminating on test', 'Service emergency lighting at {loc}'],
  ['EL-01', 'Electrical', 'Portable appliances tested in date', 'PAT label at {loc} expired', 'Book PAT retest for equipment at {loc}'],
  ['EL-02', 'Electrical', 'Distribution boards closed and labelled', 'Distribution board at {loc} left open and unlabelled', 'Close and label distribution board at {loc}'],
  ['EL-03', 'Electrical', 'No damaged cables or plugs in use', 'Damaged extension lead in use at {loc}', 'Remove and replace damaged extension lead at {loc}'],
  ['EL-04', 'Electrical', 'Isolation switches accessible', 'Isolation switch at {loc} obstructed', 'Clear access to isolation switch at {loc}'],
  ['HK-01', 'Housekeeping', 'Walkways free of obstruction', 'Pallets staged on pedestrian route near {loc}', 'Clear staged pallets from pedestrian route near {loc}'],
  ['HK-02', 'Housekeeping', 'Waste segregated and bins not overflowing', 'Waste bins overflowing at {loc}', 'Arrange additional waste collection at {loc}'],
  ['HK-03', 'Housekeeping', 'Work areas clean and tidy', 'Work bench at {loc} cluttered with offcuts', 'Clear and clean work area at {loc}'],
  ['HK-04', 'Housekeeping', 'Spill kit stocked and accessible', 'Spill kit at {loc} missing absorbent pads', 'Restock spill kit at {loc}'],
  ['PW-01', 'PPE & welfare', 'Eye-wash station in date', 'Eye-wash bottle at {loc} past expiry', 'Replace eye-wash bottle at {loc}'],
  ['PW-02', 'PPE & welfare', 'First-aid kit stocked and in date', 'First-aid kit at {loc} missing dressings', 'Restock first-aid kit at {loc}'],
  ['PW-03', 'PPE & welfare', 'PPE worn as signed', 'Operative without hi-vis near {loc}', 'Rebrief PPE requirements for {loc}'],
  ['PW-04', 'PPE & welfare', 'Welfare facilities clean and stocked', 'Welfare room at {loc} without hot water', 'Repair hot water supply in welfare room at {loc}'],
  ['ST-01', 'Storage', 'Racking inspection tag current', 'Racking tag at {loc} out of date', 'Book racking inspection for {loc}'],
  ['ST-02', 'Storage', 'Loads stored within rated limits', 'Overloaded top beam at {loc}', 'Redistribute load and check beam at {loc}'],
  ['ST-03', 'Storage', 'Ladders and steps tagged and serviceable', 'Untagged stepladder in use at {loc}', 'Remove untagged stepladder from {loc}'],
  ['ST-04', 'Storage', 'COSHH cabinet locked and register current', 'COSHH register at {loc} not updated this quarter', 'Update COSHH register at {loc}'],
  ['SG-01', 'Signage', 'Escape route signage visible', 'Escape route sign above {loc} obscured by stock', 'Relocate stock obscuring escape signage at {loc}'],
  ['SG-02', 'Signage', 'Pedestrian walkways marked and visible', 'Walkway markings at {loc} worn and faded', 'Re-mark pedestrian walkway at {loc}'],
  ['SG-03', 'Signage', 'Statutory notices displayed and current', 'Statutory notice board at {loc} out of date', 'Display current statutory notices at {loc}'],
  ['SG-04', 'Signage', 'Hazard signage matches site risks', 'No vehicle warning signage at {loc} crossing', 'Install hazard signage at {loc} crossing'],
].map(([code, section, text, note, action], i) => ({ key: i + 1, code, section, text, note, action }));

// ---------------------------------------------------------------- inspections
function randomWeekday(y, m) {
  const last = y === 2026 && m === 6 ? 28 : daysInMonth(y, m);
  for (;;) { const t = d(y, m, randInt(1, last)); if (isWeekday(t)) return t; }
}

const visits = [];
const planned = [];
// Warm-up: pretend every site was last visited some time in Nov-Dec 2024, so
// the coverage floor does not dump all 42 sites into January 2025.
const lastSeen = {};
for (const s of SITES) lastSeen[s.key] = d(2024, 11, randInt(1, 60));
const addVisit = (site, t, idx) => {
  visits.push({ site, t, idx });
  lastSeen[site.key] = Math.max(lastSeen[site.key], t);
};

for (const { y, m, idx } of MONTHS) {
  const plan = y === 2025 ? (m === 12 ? 36 : 48) : 52;
  planned.push({ y, m, plan });
  const actual = plan + randInt(-6, 4);
  const monthStart = d(y, m, 1);
  const eligible = (s) => CUTOFF[s.name] === undefined ||
    monthStart < d(new Date(CUTOFF[s.name]).getUTCFullYear(), new Date(CUTOFF[s.name]).getUTCMonth() + 1, 1);

  // Kingsway Depot: two visits every month (the repeat offender needs volume)
  for (let k = 0; k < 2; k++) addVisit(byName['Kingsway Depot'], randomWeekday(y, m), idx);
  let placed = 2;

  // Coverage floor: any eligible site unvisited for COVERAGE_FLOOR_DAYS at the
  // start of the month gets a visit, so random gaps never outgrow the three
  // deliberately stale sites.
  const perSite = {};
  for (const s of SITES) {
    if (s.name === 'Kingsway Depot' || !eligible(s)) continue;
    if (diffDays(lastSeen[s.key], monthStart) > COVERAGE_FLOOR_DAYS) {
      addVisit(s, randomWeekday(y, m), idx);
      perSite[s.key] = 1; placed++;
    }
  }

  const pool = SITES.filter((s) => s.name !== 'Kingsway Depot' && eligible(s));
  const weights = pool.map((s) => s.freq);
  let guard = 0;
  while (placed < actual && guard++ < 5000) {
    const s = pool[weightedIndex(weights)];
    if ((perSite[s.key] || 0) >= 2) continue;
    perSite[s.key] = (perSite[s.key] || 0) + 1;
    addVisit(s, randomWeekday(y, m), idx);
    placed++;
  }
}
// Forced final visits on the cut-off dates (all weekdays), so staleness at the
// as-at date is exactly the story the Coverage page tells.
for (const [name, t] of Object.entries(CUTOFF)) {
  const idx = MONTHS.findIndex((mm) => mm.y === new Date(t).getUTCFullYear() && mm.m === new Date(t).getUTCMonth() + 1);
  addVisit(byName[name], t, idx);
}

visits.sort((a, b) => a.t - b.t || a.site.name.localeCompare(b.site.name));
const seq = { 2025: 0, 2026: 0 };
for (const v of visits) {
  const y = new Date(v.t).getUTCFullYear();
  seq[y]++;
  v.id = `SI-${y}-${String(seq[y]).padStart(4, '0')}`;
  const inspectors = PEOPLE.filter((p) => p.role === 'Inspector' && activeAt(p, v.t));
  v.inspector = inspectors[weightedIndex(inspectors.map((p) => (p.region === v.site.region ? 3 : 1)))];
}

// ---------------------------------------------------------------- responses
const responses = [];
const findings = [];
for (const v of visits) {
  const f = v.idx / (MONTHS.length - 1);
  const trend = 1 - TREND_DROP * f;
  const sigTrend = 1 - SIGNAGE_EXTRA_DROP * f;
  const pHigh = HIGH_START - (HIGH_START - HIGH_END) * f;
  for (const q of QUESTIONS) {
    if (rand() < NA_RATE) { responses.push({ v, q, result: 'NA', severity: '', note: '' }); continue; }
    let p = BASE_FAIL * trend * SECTION_MULT[q.section] * (q.section === 'Signage' ? sigTrend : 1) * (1 + REGION_ADJ[v.site.region] + v.site.adj);
    p = Math.min(0.55, Math.max(0.01, p));
    if (rand() < p) {
      const r = rand();
      const severity = r < pHigh ? 'High' : r < pHigh + MED_SHARE ? 'Medium' : 'Low';
      const loc = choice(LOCS);
      const row = { v, q, result: 'Fail', severity, note: q.note.replace('{loc}', loc), loc };
      responses.push(row); findings.push(row);
    } else {
      responses.push({ v, q, result: 'Pass', severity: '', note: '' });
    }
  }
}

// ---------------------------------------------------------------- actions
const actions = [];
for (const fRow of findings) {
  if (rand() >= ACTION_P[fRow.severity]) continue;
  const raised = Math.min(addDays(fRow.v.t, randInt(0, 2)), AS_AT);
  const due = addDays(raised, DUE_OFFSET[fRow.severity]);
  const intendedClose = addDays(raised, Math.max(1, Math.round(logNormal(CLOSE_MU, CLOSE_SIGMA))));
  let closed = null;
  const overdueDays = diffDays(due, AS_AT);
  if (due < AS_AT && overdueDays <= STALL_WINDOW && rand() < STALL_P) {
    closed = null; // stalled: the deliberate overdue tail
  } else if (due > AS_AT && diffDays(AS_AT, due) <= DUE_SOON_WINDOW && rand() < DUE_SOON_HOLD_P) {
    closed = null; // work scheduled against the due date, still open at the as-at date
  } else if (intendedClose <= AS_AT) {
    closed = intendedClose;
  }
  const owners = PEOPLE.filter((p) => activeAt(p, raised));
  const owner = owners[weightedIndex(owners.map((p) => (p.role === 'Site manager' ? 2 : 1) * (p.region === fRow.v.site.region ? 2 : 1)))];
  actions.push({
    inspectionId: fRow.v.id, site: fRow.v.site, category: fRow.q.section,
    raised, due, closed, owner, desc: fRow.q.action.replace('{loc}', fRow.loc), severity: fRow.severity,
  });
}
actions.sort((a, b) => a.raised - b.raised || a.inspectionId.localeCompare(b.inspectionId));
actions.forEach((a, i) => { a.ref = `AC-${String(i + 1).padStart(3, '0')}`; });

// Wrinkle W4: one orphan action referencing an inspection ID that never existed.
const orphanId = `SI-2026-${String(seq[2026] + 37).padStart(4, '0')}`;
actions.push({
  ref: `AC-${String(actions.length + 1).padStart(3, '0')}`, inspectionId: orphanId,
  site: byName['Medway City Depot'], category: 'Housekeeping',
  raised: d(2026, 5, 14), due: d(2026, 6, 4), closed: d(2026, 5, 27),
  owner: PEOPLE[3], desc: 'Arrange additional waste collection at the yard gate', severity: 'Medium',
});

// Wrinkle W5: two open 2026 actions with no owner recorded.
const w5 = actions.filter((a) => a.closed === null && a.raised >= d(2026, 1, 1)).slice(2, 4);
for (const a of w5) a.owner = null;

// ---------------------------------------------------------------- CSV output
const esc = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file, header, rows) => {
  const out = [header.join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n') + '\n';
  fs.writeFileSync(file, out, 'utf8');
  return rows.length;
};
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

writeCsv(path.join(dataDir, 'sites.csv'),
  ['site_id', 'site_name', 'region', 'site_type', 'latitude', 'longitude'],
  SITES.map((s) => [s.key, s.name, s.region, s.type, s.lat.toFixed(2), s.lon.toFixed(2)]));

writeCsv(path.join(dataDir, 'people.csv'),
  ['person_id', 'person_name', 'role', 'home_region'],
  PEOPLE.map((p) => [p.key, p.name, p.role, p.region]));

writeCsv(path.join(dataDir, 'questions.csv'),
  ['question_id', 'question_code', 'section', 'question_text'],
  QUESTIONS.map((q) => [q.key, q.code, q.section, q.text]));

// Wrinkle W2: a re-exported batch, five duplicate rows appended verbatim.
const inspectionRows = visits.map((v) => [v.id, fmt(v.t), v.site.key, v.inspector.key]);
const dupSource = visits.filter((v) => v.t >= d(2026, 5, 11) && v.t <= d(2026, 5, 15)).slice(0, 5);
for (const v of dupSource) inspectionRows.push([v.id, fmt(v.t), v.site.key, v.inspector.key]);
writeCsv(path.join(dataDir, 'inspections.csv'),
  ['inspection_id', 'inspection_date', 'site_id', 'inspector_id'], inspectionRows);

writeCsv(path.join(dataDir, 'responses.csv'),
  ['inspection_id', 'question_id', 'result', 'severity', 'inspector_note'],
  responses.map((r) => [r.v.id, r.q.key, r.result, r.severity, r.note]));

// Wrinkle W6: the actions extract comes from a different system, so ~10 rows
// carry untrimmed or badly cased site names. Cleaned in Power Query at load.
const dirty = new Map();
const dirtyCandidates = actions.filter((a) => a.raised >= d(2026, 2, 1)).slice(0, 10);
dirtyCandidates.forEach((a, i) => {
  const n = a.site.name;
  dirty.set(a.ref, i % 3 === 0 ? `${n} ` : i % 3 === 1 ? n.toUpperCase() : n.replace(' ', '  '));
});
writeCsv(path.join(dataDir, 'actions.csv'),
  ['action_ref', 'inspection_id', 'site_name', 'category', 'raised_date', 'due_date', 'closed_date', 'owner_id', 'action_description'],
  actions.map((a) => [a.ref, a.inspectionId, dirty.get(a.ref) ?? a.site.name, a.category,
    fmt(a.raised), fmt(a.due), a.closed ? fmt(a.closed) : '', a.owner ? a.owner.key : '', a.desc]));

writeCsv(path.join(dataDir, 'monthly_targets.csv'),
  ['month_start', 'planned_inspections'],
  planned.map((p) => [fmt(d(p.y, p.m, 1)), p.plan]));

// ---------------------------------------------------------------- verification
// Computed from the clean in-memory data (equals the post-dedupe model state).
const pct = (n, dnm) => (dnm === 0 ? null : (100 * n) / dnm);
const fPct = (x) => (x === null ? ' -- ' : x.toFixed(1));
const monthKey = (t) => fmt(t).slice(0, 7);

console.log(`Seed ${SEED} · as-at ${fmt(AS_AT)}`);
console.log(`rows: sites ${SITES.length} · people ${PEOPLE.length} · questions ${QUESTIONS.length} · inspections ${visits.length} (+5 dup rows in csv) · responses ${responses.length} · actions ${actions.length} · targets ${planned.length}`);

console.log('\nMonth      Insp  Plan  Compliance%');
for (const { y, m } of MONTHS) {
  const key = `${y}-${String(m).padStart(2, '0')}`;
  const ins = visits.filter((v) => monthKey(v.t) === key).length;
  const rs = responses.filter((r) => monthKey(r.v.t) === key && r.result !== 'NA');
  const c = pct(rs.filter((r) => r.result === 'Pass').length, rs.length);
  console.log(`${key}    ${String(ins).padStart(3)}   ${String(planned.find((p) => p.y === y && p.m === m).plan).padStart(3)}   ${fPct(c)}`);
}

console.log('\nCompliance by region (Jan-Jun 2026):');
for (const region of Object.keys(REGION_ADJ)) {
  const rs = responses.filter((r) => r.v.site.region === region && r.v.t >= d(2026, 1, 1) && r.result !== 'NA');
  console.log(`  ${region.padEnd(11)} ${fPct(pct(rs.filter((r) => r.result === 'Pass').length, rs.length))}`);
}

console.log('\nCompliance by section (2025 H1 -> Apr-Jun 2026):');
for (const section of Object.keys(SECTION_MULT)) {
  const early = responses.filter((r) => r.q.section === section && r.v.t < d(2025, 7, 1) && r.result !== 'NA');
  const late = responses.filter((r) => r.q.section === section && r.v.t >= d(2026, 4, 1) && r.result !== 'NA');
  console.log(`  ${section.padEnd(14)} ${fPct(pct(early.filter((r) => r.result === 'Pass').length, early.length))} -> ${fPct(pct(late.filter((r) => r.result === 'Pass').length, late.length))}`);
}

const kMonths = MONTHS.filter((mm) => mm.y === 2026).map((mm) => `2026-${String(mm.m).padStart(2, '0')}`);
const kHit = kMonths.filter((key) => findings.some((fr) => fr.v.site.name === 'Kingsway Depot' && monthKey(fr.v.t) === key)).length;
console.log(`\nKingsway Depot: findings in ${kHit}/6 months of 2026`);

console.log('\nSeverity mix (share High, by quarter):');
const qtr = (t) => `${new Date(t).getUTCFullYear()}-Q${Math.floor(new Date(t).getUTCMonth() / 3) + 1}`;
const qtrs = [...new Set(findings.map((fr) => qtr(fr.v.t)))].sort();
for (const q of qtrs) {
  const fs2 = findings.filter((fr) => qtr(fr.v.t) === q);
  console.log(`  ${q}  High ${fPct(pct(fs2.filter((x) => x.severity === 'High').length, fs2.length))}%  of ${fs2.length}`);
}

const lastVisit = {};
for (const v of visits) lastVisit[v.site.name] = Math.max(lastVisit[v.site.name] || 0, v.t);
const stale = SITES.map((s) => ({ name: s.name, days: diffDays(lastVisit[s.name], AS_AT) }))
  .filter((s) => s.days > 60).sort((a, b) => b.days - a.days);
console.log(`\nSites not visited in 60d: ${stale.length}`);
for (const s of stale) console.log(`  ${s.name.padEnd(26)} ${s.days}d`);
const covered = new Set(visits.filter((v) => v.t >= d(2026, 1, 1)).map((v) => v.site.key)).size;
console.log(`Sites covered Jan-Jun 2026: ${covered}/${SITES.length}`);

const real = actions.filter((a) => a.inspectionId !== orphanId);
const ytd = real.filter((a) => a.raised >= d(2026, 1, 1));
const status = (a) => a.closed ? 'Closed' : a.due < AS_AT ? 'Overdue' : diffDays(AS_AT, a.due) <= 7 ? 'Due<7d' : 'Open';
const overdue = real.filter((a) => status(a) === 'Overdue');
const closedDays = real.filter((a) => a.closed).map((a) => diffDays(a.raised, a.closed)).sort((x, y2) => x - y2);
console.log(`\nActions: total ${real.length} (+1 orphan) · per inspection ${(real.length / visits.length).toFixed(2)}`);
console.log(`  raised YTD ${ytd.length} · closed YTD ${ytd.filter((a) => a.closed).length} (closure ${fPct(pct(ytd.filter((a) => a.closed).length, ytd.length))}%)`);
console.log(`  open ${real.filter((a) => status(a) === 'Open' || status(a) === 'Due<7d').length} (due<7d ${real.filter((a) => status(a) === 'Due<7d').length}) · overdue ${overdue.length} · max days overdue ${overdue.length ? Math.max(...overdue.map((a) => diffDays(a.due, AS_AT))) : 0}`);
console.log(`  median days to close ${closedDays[Math.floor(closedDays.length / 2)]}`);
console.log(`\nWrinkles: W2 dup rows ${dupSource.length} · W3 NA ${responses.filter((r) => r.result === 'NA').length} (${fPct(pct(responses.filter((r) => r.result === 'NA').length, responses.length))}%) · W4 orphan 1 (${orphanId}) · W5 unassigned ${actions.filter((a) => !a.owner).length} · W6 dirty names ${dirty.size}`);

console.log('\nCompliance by section (full window):');
for (const section of Object.keys(SECTION_MULT)) {
  const rs = responses.filter((r) => r.q.section === section && r.result !== 'NA');
  console.log(`  ${section.padEnd(14)} ${fPct(pct(rs.filter((r) => r.result === 'Pass').length, rs.length))}`);
}
