'use strict';
// Writes the files in ../data for the Site Inspection Performance report.
// Run with: node generate-data.js

const fs = require('fs');
const path = require('path');

// mulberry32: a small seeded generator, so every run writes the same files.
const SEED = 20261030;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
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

const DAY = 86400000;
const d = (y, m, day) => Date.UTC(y, m - 1, day);
const addDays = (t, n) => t + n * DAY;
const diffDays = (a, b) => Math.round((b - a) / DAY);
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);
const isWeekday = (t) => { const w = new Date(t).getUTCDay(); return w >= 1 && w <= 5; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthKey = (t) => isoDate(t).slice(0, 7);

// January 2025 to October 2026. The last inspection is on Friday 30 October 2026.
const LAST_DAY = d(2026, 10, 30);
const MONTHS = [];
for (let y = 2025; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === 2026 && m > 10) break;
    MONTHS.push({ y, m, idx: MONTHS.length });
  }
}

const NA_RATE = 0.04;
const BASE_FAIL = 0.14;
const TREND_DROP = 0.37;
const SIGNAGE_EXTRA_DROP = 0.25;
const SECTION_MULT = { 'Fire safety': 1.15, 'Electrical': 0.5, 'Housekeeping': 1.15, 'PPE & welfare': 0.95, 'Storage': 0.85, 'Signage': 1.7 };
const REGION_ADJ = { 'North': -0.30, 'Midlands': -0.10, 'Scotland': 0.00, 'South East': 0.05, 'Wales': 0.15, 'South West': 0.40 };
const COVERAGE_FLOOR_DAYS = 55;
const HIGH_START = 0.14, HIGH_END = 0.05;
const MED_SHARE = 0.32;
const ACTION_P = { High: 1.0, Medium: 0.28, Low: 0.05 };
const DUE_OFFSET = { High: 14, Medium: 21, Low: 28 };
const CLOSE_MU_START = Math.log(9), CLOSE_MU_END = Math.log(16), CLOSE_SIGMA = 0.55;
const STALL_WINDOW = 40, STALL_P = 0.2;
const DUE_SOON_WINDOW = 10, DUE_SOON_HOLD_P = 0.35;

const SITES = [
  ['Kingsway Depot', 'North'], ['Tyne Dock Depot', 'North'], ['Skelton Grange Hub', 'North'],
  ['Salford Quays Depot', 'North'], ['Teesport Yard', 'North'], ['Carlisle Gateway', 'North'],
  ['Bradford Interchange Depot', 'North'], ['Hull Fleet Depot', 'North'], ['Preston Brook Depot', 'North'],
  ['Crewe Annex', 'Midlands'], ['Fenton Works', 'Midlands'], ['Leicester Brook Depot', 'Midlands'],
  ['Derby Litchurch Yard', 'Midlands'], ['Coventry Gateway Hub', 'Midlands'], ['Wolverhampton Basin Depot', 'Midlands'],
  ['Northampton Crossfield Hub', 'Midlands'], ['Rugby Junction Depot', 'Midlands'],
  ['Ely Sidings', 'South East'], ['Dartford Clearway Depot', 'South East'], ['Basildon Marsh Hub', 'South East'],
  ['Reading Green Park Depot', 'South East'], ['Ashford Orbital Yard', 'South East'], ['Slough Trading Depot', 'South East'],
  ['Luton Percival Hub', 'South East'], ['Medway City Depot', 'South East'],
  ['Falkirk Hub', 'Scotland'], ['Perth North', 'Scotland'], ['Clydebank Riverside Depot', 'Scotland'],
  ['Aberdeen Harbour Yard', 'Scotland'], ['Livingston Deans Hub', 'Scotland'], ['Dundee Camperdown Depot', 'Scotland'],
  ['Inverness Longman Depot', 'Scotland'],
  ['Neath Yard', 'Wales'], ['Newport Docks Depot', 'Wales'], ['Wrexham Industrial Hub', 'Wales'],
  ['Swansea Fabian Way Depot', 'Wales'], ['Deeside Park Depot', 'Wales'],
  ['Avonmouth 3', 'South West'], ['Exeter Matford Depot', 'South West'], ['Plymouth Cattedown Yard', 'South West'],
  ['Gloucester Quays Hub', 'South West'], ['Taunton Priory Depot', 'South West'],
].map(([name, region], i) => ({ key: i + 1, name, region, type: null, freq: null, adj: null }));

for (const s of SITES) {
  s.type = rand() < 0.55 ? 'Logistics' : 'Facilities';
  s.freq = 0.7 + rand() * 0.7;
  s.adj = -0.10 + rand() * 0.20;
}
const byName = Object.fromEntries(SITES.map((s) => [s.name, s]));
byName['Kingsway Depot'].adj = 0.45;
byName['Fenton Works'].adj = -0.25;
byName['Taunton Priory Depot'].freq = 0.35;
byName['Inverness Longman Depot'].freq = 0.35;

// The last visit to each of these sites, so three sites are past the 60-day rule on 30 October.
const LAST_VISIT = { 'Neath Yard': d(2026, 7, 28), 'Ely Sidings': d(2026, 8, 19), 'Perth North': d(2026, 8, 28) };

const PEOPLE = [
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

const REGIONAL_MANAGERS = [
  ['r.hale@meridian.example', 'North'], ['k.bains@meridian.example', 'Midlands'],
  ['t.morgan@meridian.example', 'South East'], ['f.duncan@meridian.example', 'Scotland'],
  ['g.pryce@meridian.example', 'Wales'], ['n.carter@meridian.example', 'South West'],
];

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
].map(([code, section, text, note, action], i) => ({ order: i + 1, code, section, text, note, action }));

// Visits
function randomWeekday(y, m) {
  const last = y === 2026 && m === 10 ? 30 : daysInMonth(y, m);
  for (;;) { const t = d(y, m, randInt(1, last)); if (isWeekday(t)) return t; }
}

const visits = [];
const planned = [];
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
  const monthEnd = y === 2026 && m === 10 ? LAST_DAY : d(y, m, daysInMonth(y, m));
  const eligible = (s) => LAST_VISIT[s.name] === undefined ||
    monthStart < d(new Date(LAST_VISIT[s.name]).getUTCFullYear(), new Date(LAST_VISIT[s.name]).getUTCMonth() + 1, 1);

  for (let k = 0; k < 2; k++) addVisit(byName['Kingsway Depot'], randomWeekday(y, m), idx);
  let placed = 2;

  const perSite = {};
  for (const s of SITES) {
    if (s.name === 'Kingsway Depot' || !eligible(s)) continue;
    if (diffDays(lastSeen[s.key], monthEnd) > COVERAGE_FLOOR_DAYS) {
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
for (const [name, t] of Object.entries(LAST_VISIT)) {
  const idx = MONTHS.findIndex((mm) => mm.y === new Date(t).getUTCFullYear() && mm.m === new Date(t).getUTCMonth() + 1);
  addVisit(byName[name], t, idx);
}
addVisit(byName['Kingsway Depot'], LAST_DAY, MONTHS.length - 1);

visits.sort((a, b) => a.t - b.t || a.site.name.localeCompare(b.site.name));
const AS_AT = visits[visits.length - 1].t;
const seq = { 2025: 0, 2026: 0 };
for (const v of visits) {
  const y = new Date(v.t).getUTCFullYear();
  seq[y]++;
  v.id = `SI-${y}-${String(seq[y]).padStart(4, '0')}`;
  const inspectors = PEOPLE.filter((p) => p.role === 'Inspector' && activeAt(p, v.t));
  v.inspector = inspectors[weightedIndex(inspectors.map((p) => (p.region === v.site.region ? 3 : 1)))];
  v.submitted = v.t + randInt(7 * 60 + 30, 17 * 60 + 30) * 60000;
}

// Answers
const findings = [];
for (const v of visits) {
  const f = v.idx / (MONTHS.length - 1);
  const trend = 1 - TREND_DROP * f;
  const sigTrend = 1 - SIGNAGE_EXTRA_DROP * f;
  const pHigh = HIGH_START - (HIGH_START - HIGH_END) * f;
  v.answers = {};
  v.notes = [];
  for (const q of QUESTIONS) {
    if (rand() < NA_RATE) { v.answers[q.code] = 'N/A'; continue; }
    let p = BASE_FAIL * trend * SECTION_MULT[q.section] * (q.section === 'Signage' ? sigTrend : 1) * (1 + REGION_ADJ[v.site.region] + v.site.adj);
    p = Math.min(0.55, Math.max(0.01, p));
    if (rand() < p) {
      const r = rand();
      const severity = r < pHigh ? 'High' : r < pHigh + MED_SHARE ? 'Medium' : 'Low';
      const loc = choice(LOCS);
      v.answers[q.code] = `Fail - ${severity}`;
      v.notes.push(q.note.replace('{loc}', loc));
      findings.push({ v, q, severity, loc });
    } else {
      v.answers[q.code] = 'Pass';
    }
  }
}

// Corrective actions
const actions = [];
for (const fRow of findings) {
  if (rand() >= ACTION_P[fRow.severity]) continue;
  const f = fRow.v.idx / (MONTHS.length - 1);
  const raised = Math.min(addDays(fRow.v.t, randInt(0, 2)), AS_AT);
  const due = addDays(raised, DUE_OFFSET[fRow.severity]);
  const mu = CLOSE_MU_START + (CLOSE_MU_END - CLOSE_MU_START) * f;
  const intendedClose = addDays(raised, Math.max(1, Math.round(logNormal(mu, CLOSE_SIGMA))));
  let closed = null;
  if (due < AS_AT && diffDays(due, AS_AT) <= STALL_WINDOW && rand() < STALL_P) {
    closed = null;
  } else if (due > AS_AT && diffDays(AS_AT, due) <= DUE_SOON_WINDOW && rand() < DUE_SOON_HOLD_P) {
    closed = null;
  } else if (intendedClose <= AS_AT) {
    closed = intendedClose;
  }
  const owners = PEOPLE.filter((p) => activeAt(p, raised));
  const owner = owners[weightedIndex(owners.map((p) => (p.role === 'Site manager' ? 2 : 1) * (p.region === fRow.v.site.region ? 2 : 1)))];
  actions.push({
    inspectionId: fRow.v.id, site: fRow.v.site, category: fRow.q.section,
    raised, due, closed, owner, desc: fRow.q.action.replace('{loc}', fRow.loc),
  });
}
actions.sort((a, b) => a.raised - b.raised || a.inspectionId.localeCompare(b.inspectionId));
actions.forEach((a, i) => { a.ref = `AC-${String(i + 1).padStart(3, '0')}`; });

// An action that points at an inspection number that was never used.
const orphanId = `SI-2026-${String(seq[2026] + 37).padStart(4, '0')}`;
actions.push({
  ref: `AC-${String(actions.length + 1).padStart(3, '0')}`, inspectionId: orphanId,
  site: byName['Medway City Depot'], category: 'Housekeeping',
  raised: d(2026, 9, 10), due: d(2026, 10, 1), closed: d(2026, 9, 23),
  owner: PEOPLE[3], desc: 'Arrange additional waste collection at the yard gate',
});

// Two overdue actions where the owner was never filled in.
const noOwner = actions.filter((a) => a.closed === null && a.due < AS_AT && a.raised >= d(2026, 1, 1)).slice(2, 4);
for (const a of noOwner) a.owner = null;

// Exports: one file a month, holding every inspection submitted or edited that month.
// A few inspections were edited days after submission: the first version had one answer
// left as N/A, and the corrected record appears again in the next month's file.
const versions = visits.map((v) => ({ v, modified: v.submitted, answers: v.answers }));
const edited = [];
for (const { y, m } of MONTHS.slice(-7, -1)) {
  const lastWeek = visits.filter((v) => v.t >= d(y, m, daysInMonth(y, m) - 2) && v.t <= d(y, m, daysInMonth(y, m)));
  if (lastWeek.length && edited.length < 5) edited.push(lastWeek[0]);
}
for (const v of edited) {
  const original = versions.find((x) => x.v === v);
  const code = QUESTIONS.find((q) => v.answers[q.code] === 'Pass').code;
  original.answers = { ...v.answers, [code]: 'N/A' };
  versions.push({ v, modified: addDays(v.submitted, randInt(3, 5)) + randInt(10, 300) * 60000, answers: v.answers });
}

// An app update in August 2026 changed the date format of the exports to dd/mm/yyyy.
const NEW_FORMAT_FROM = '2026-08';
const pad = (n) => String(n).padStart(2, '0');
function stamp(t, fileMonth) {
  const x = new Date(t);
  const hm = `${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
  return fileMonth >= NEW_FORMAT_FROM
    ? `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${hm}`
    : `${isoDate(t)} ${hm}`;
}

const esc = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file, header, rows) => {
  const out = [header.join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n') + '\n';
  fs.writeFileSync(file, out, 'utf8');
  return rows.length;
};
const dataDir = path.join(__dirname, '..', 'data');
const exportDir = path.join(dataDir, 'exports');
fs.mkdirSync(exportDir, { recursive: true });
for (const f of fs.readdirSync(exportDir)) fs.unlinkSync(path.join(exportDir, f));

const exportHeader = ['inspection_id', 'submitted_at', 'last_modified', 'site_id', 'site_name', 'inspector']
  .concat(QUESTIONS.map((q) => q.code), ['comments']);
const exportFiles = [];
for (const { y, m } of MONTHS) {
  const key = `${y}-${pad(m)}`;
  const rows = versions
    .filter((x) => monthKey(x.modified) === key)
    .sort((a, b) => a.modified - b.modified)
    .map((x) => [x.v.id, stamp(x.v.submitted, key), stamp(x.modified, key), x.v.site.key, x.v.site.name, x.v.inspector.name]
      .concat(QUESTIONS.map((q) => x.answers[q.code]), [x.v.notes.join('; ')]));
  exportFiles.push({ key, rows: writeCsv(path.join(exportDir, `inspections_${key}.csv`), exportHeader, rows) });
}

writeCsv(path.join(dataDir, 'sites.csv'),
  ['site_id', 'site_name', 'region', 'site_type'],
  SITES.map((s) => [s.key, s.name, s.region, s.type]));

writeCsv(path.join(dataDir, 'checklist.csv'),
  ['question_code', 'section', 'question_text', 'checklist_order'],
  QUESTIONS.map((q) => [q.code, q.section, q.text, q.order]));

// The monthly plan is set by region, in proportion to the number of sites.
const regions = Object.keys(REGION_ADJ);
const planRows = [];
for (const p of planned) {
  const shares = regions.map((r) => ({ r, exact: (p.plan * SITES.filter((s) => s.region === r).length) / SITES.length }));
  shares.forEach((x) => { x.n = Math.floor(x.exact); });
  let left = p.plan - shares.reduce((s, x) => s + x.n, 0);
  for (const x of [...shares].sort((a, b) => (b.exact - b.n) - (a.exact - a.n))) { if (left-- > 0) x.n++; }
  for (const x of shares) planRows.push([isoDate(d(p.y, p.m, 1)), x.r, x.n]);
}
writeCsv(path.join(dataDir, 'inspection_plan.csv'),
  ['month_start', 'region', 'planned_inspections'], planRows);

writeCsv(path.join(dataDir, 'region_access.csv'),
  ['user_email', 'region'], REGIONAL_MANAGERS);

// The actions list is typed by hand, so some site names carry stray spaces or capitals.
const typed = new Map();
actions.filter((a) => a.raised >= d(2026, 2, 1)).slice(0, 10).forEach((a, i) => {
  const n = a.site.name;
  typed.set(a.ref, i % 3 === 0 ? `${n} ` : i % 3 === 1 ? n.toUpperCase() : n.replace(' ', '  '));
});
writeCsv(path.join(dataDir, 'actions.csv'),
  ['action_ref', 'inspection_id', 'site_name', 'category', 'raised_date', 'due_date', 'closed_date', 'owner', 'description'],
  actions.map((a) => [a.ref, a.inspectionId, typed.get(a.ref) ?? a.site.name, a.category,
    isoDate(a.raised), isoDate(a.due), a.closed ? isoDate(a.closed) : '', a.owner ? a.owner.name : '', a.desc]));

// Summary of what the report should show, from the clean data
const pct = (n, dnm) => (dnm === 0 ? null : (100 * n) / dnm);
const f1 = (x) => (x === null ? '-' : x.toFixed(1));
const answersIn = (vs) => vs.flatMap((v) => QUESTIONS.map((q) => ({ v, q, a: v.answers[q.code] })));
const compliance = (vs) => {
  const rs = answersIn(vs).filter((r) => r.a !== 'N/A');
  return pct(rs.filter((r) => r.a === 'Pass').length, rs.length);
};
const ytdStart = d(2026, 1, 1);
const lyStart = d(2025, 1, 1), lyEnd = d(2025, 10, 30);
const ytd = visits.filter((v) => v.t >= ytdStart);
const ly = visits.filter((v) => v.t >= lyStart && v.t <= lyEnd);

console.log(`Seed ${SEED}, as at ${isoDate(AS_AT)}`);
console.log(`Inspections ${visits.length} (${edited.length} edited and exported twice), actions ${actions.length} (1 without an inspection), export files ${exportFiles.length}`);
console.log(`\nCompliance 2026 to date ${f1(compliance(ytd))}%, same months 2025 ${f1(compliance(ly))}%`);
console.log(`Inspections 2026 to date ${ytd.length}, planned ${planned.filter((p) => p.y === 2026).reduce((s, p) => s + p.plan, 0)}`);

console.log('\nMonth     Insp  Plan  Compliance');
for (const { y, m } of MONTHS) {
  const key = `${y}-${pad(m)}`;
  const vs = visits.filter((v) => monthKey(v.t) === key);
  console.log(`${key}   ${String(vs.length).padStart(4)}  ${String(planned.find((p) => p.y === y && p.m === m).plan).padStart(4)}  ${f1(compliance(vs))}`);
}

console.log('\nCompliance by region, 2026 to date');
for (const region of Object.keys(REGION_ADJ)) console.log(`  ${region.padEnd(12)} ${f1(compliance(ytd.filter((v) => v.site.region === region)))}`);

console.log('\nCompliance by section, 2026 to date');
for (const section of Object.keys(SECTION_MULT)) {
  const rs = answersIn(ytd).filter((r) => r.q.section === section && r.a !== 'N/A');
  console.log(`  ${section.padEnd(14)} ${f1(pct(rs.filter((r) => r.a === 'Pass').length, rs.length))}`);
}

const real = actions;
const onTime = (list) => {
  const due = list.filter((a) => a.due <= AS_AT);
  return { due: due.length, onTime: due.filter((a) => a.closed && a.closed <= a.due).length };
};
const dueYtd = onTime(real.filter((a) => a.due >= ytdStart));
const dueLy = onTime(real.filter((a) => a.due >= lyStart && a.due <= lyEnd));
const overdue = real.filter((a) => !a.closed && a.due < AS_AT).sort((a, b) => a.due - b.due);
console.log(`\nActions due 2026 to date ${dueYtd.due}, closed on time ${dueYtd.onTime} (${f1(pct(dueYtd.onTime, dueYtd.due))}%); same months 2025 ${f1(pct(dueLy.onTime, dueLy.due))}%`);
const monthsBelow = MONTHS.slice(-18).filter(({ y, m }) => {
  const r = onTime(real.filter((a) => monthKey(a.due) === `${y}-${pad(m)}`));
  return r.due > 0 && pct(r.onTime, r.due) < 90;
}).length;
console.log(`On-time closure below 90% in ${monthsBelow} of the last 18 months`);
console.log(`Open ${real.filter((a) => !a.closed).length}, overdue ${overdue.length}, overdue with no owner ${overdue.filter((a) => !a.owner).length}`);
for (const a of overdue.slice(0, 5)) console.log(`  ${a.ref} ${a.site.name.padEnd(26)} ${a.owner ? a.owner.name : 'Unassigned'}  ${diffDays(a.due, AS_AT)} days`);

const lastVisit = {};
for (const v of visits) lastVisit[v.site.name] = Math.max(lastVisit[v.site.name] || 0, v.t);
const gaps = SITES.map((s) => ({ name: s.name, days: diffDays(lastVisit[s.name], AS_AT) })).sort((a, b) => b.days - a.days);
console.log(`\nSites past the 60-day rule ${gaps.filter((g) => g.days > 60).length}`);
for (const g of gaps.slice(0, 6)) console.log(`  ${g.name.padEnd(26)} ${g.days} days`);
const days = diffDays(ytdStart, AS_AT) + 1;
console.log(`Visits a month: needed ${(SITES.length * 30.4 / 60).toFixed(1)}, made ${(ytd.length / (days / 30.4)).toFixed(1)}`);
const perSite = SITES.map((s) => ({ name: s.name, n: ytd.filter((v) => v.site === s).length })).sort((a, b) => b.n - a.n);
console.log(`Most visited ${perSite[0].name} ${perSite[0].n}; least visited ${perSite.slice(-3).map((p) => `${p.name} ${p.n}`).join(', ')}`);

console.log(`\nData problems: ${edited.length} inspections exported twice (${edited.map((v) => v.id).join(', ')}), ` +
  `${exportFiles.filter((x) => x.key >= NEW_FORMAT_FROM).length} files with dd/mm/yyyy dates, ` +
  `${typed.size} site names typed differently, ${actions.filter((a) => !a.owner).length} actions with no owner, ` +
  `1 action without an inspection (${orphanId}), ${answersIn(visits).filter((r) => r.a === 'N/A').length} N/A answers`);
