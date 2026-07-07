'use strict';
// Deterministic mock data generator for the Data Reconciliation and Quality Monitor.
// Ground truth for shapes and volumes: docs/spec-data-reconciliation.md.
// Run: node generate-data.js  (writes CSVs to ../data and prints a verification summary)
//
// Core conventions (spec section 3): the facts are measurements about data, not the
// data itself, and verdicts are never stored - the model derives pass/warn/fail from
// the raw observations here against the thresholds on the rule table. The verification
// summary at the bottom re-derives every verdict the same way the DAX will.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- randomness
const SEED = 20260629;
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
const jitter = (spread) => 1 + (rand() - 0.5) * spread;

// ---------------------------------------------------------------- calendar
// Date dimension 01 Apr - 30 Jun 2026; nightly runs 01 Apr - 29 Jun (the run date).
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = [];
for (let t = Date.UTC(2026, 3, 1); t <= Date.UTC(2026, 5, 30); t += 86400000) {
  const d = new Date(t);
  const iso = d.toISOString().slice(0, 10);
  const dow = d.getUTCDay(); // 0 = Sun
  const monday = new Date(t - ((dow + 6) % 7) * 86400000);
  DAYS.push({
    iso, key: Number(iso.replace(/-/g, '')), dow,
    label: `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`,
    weekday: WD[dow], isWeekend: dow === 0 || dow === 6,
    weekStart: monday.toISOString().slice(0, 10),
    month: `${MONTH_NAMES[d.getUTCMonth()]} 2026`,
    idx: DAYS.length,
  });
}
const RUN_DATE = '2026-06-29';
const RUN_DAYS = DAYS.filter((d) => d.iso <= RUN_DATE);
const dayByIso = Object.fromEntries(DAYS.map((d) => [d.iso, d]));
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- feeds
// schedule: daily | weekdays (Mon-Fri) | monsat (Mon-Sat). avgVal = mean line value (GBP).
// wd = volume factor by weekday index (Sun..Sat). arrive = baseline arrival minutes after midnight.
const FEEDS = [
  { key: 1, code: 'POS', name: 'POS transactions',      source: 'Storeline POS', schedule: 'daily',    steward: 'L. Prentice', hasAmount: true,  files: 4, base: 2300000, avgVal: 7.64,   wd: [1.05, 0.98, 0.94, 0.96, 1.00, 1.12, 1.25], arrive: 232 },
  { key: 2, code: 'ECOM', name: 'E-commerce orders',    source: 'Webshop',       schedule: 'daily',    steward: 'L. Prentice', hasAmount: true,  files: 1, base: 141000,  avgVal: 7.08,   wd: [1.05, 1.08, 1.00, 0.98, 0.99, 1.02, 0.92], arrive: 251 },
  { key: 3, code: 'GL', name: 'ERP GL journal',         source: 'Ledger ERP',    schedule: 'weekdays', steward: 'J. Meads',    hasAmount: true,  files: 1, base: 91000,   avgVal: 444.0,  wd: [0, 1.0, 1.0, 1.0, 1.0, 1.05, 0],           arrive: 155 },
  { key: 4, code: 'EDI', name: 'Supplier EDI invoices', source: 'EDI gateway',   schedule: 'monsat',   steward: 'D. Okafor',   hasAmount: true,  files: 3, base: 8700,    avgVal: 178.3,  wd: [0, 1.15, 1.00, 0.98, 0.97, 1.02, 0.90],    arrive: 272 },
  { key: 5, code: 'LOG', name: 'Logistics shipments',   source: 'DepotTrack',    schedule: 'daily',    steward: 'S. Varga',    hasAmount: false, files: 2, base: 29500,   avgVal: 0,      wd: [0.72, 1.06, 1.04, 1.02, 1.03, 1.05, 0.95], arrive: 282 },
  { key: 6, code: 'LOY', name: 'Loyalty members',       source: 'Loyalty CRM',   schedule: 'daily',    steward: 'S. Varga',    hasAmount: false, files: 1, base: 0,       avgVal: 0,      wd: null, arrive: 202 },
  { key: 7, code: 'PRD', name: 'Product master',        source: 'Ledger ERP',    schedule: 'daily',    steward: 'J. Meads',    hasAmount: false, files: 1, base: 0,       avgVal: 0,      wd: null, arrive: 172 },
  { key: 8, code: 'STO', name: 'Store master',          source: 'Ledger ERP',    schedule: 'daily',    steward: 'J. Meads',    hasAmount: false, files: 1, base: 0,       avgVal: 0,      wd: null, arrive: 174 },
];
const feedByCode = Object.fromEntries(FEEDS.map((f) => [f.code, f]));
const runsOn = (f, d) =>
  f.schedule === 'daily' ? true : f.schedule === 'weekdays' ? d.dow >= 1 && d.dow <= 5 : d.dow >= 1 && d.dow <= 6;

// ---------------------------------------------------------------- rulebook (48 rules)
// [id, feed, name, dimension, unit, isLoadCheck, tolLabel, warnAbove%, failAbove%, warnLateMin, failLateMin, activeFrom]
// Load checks (row count vs source, amount vs source, arrival) drive the feed status board;
// the rest are in-warehouse quality rules and belong to the Quality Rules page.
const RULES = [
  ['R-001', 'POS',  'row count vs source',              'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-002', 'POS',  'file arrival by 05:00',            'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-003', 'POS',  'basket total equals line sum',     'Consistency',  'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-004', 'POS',  'sales amount vs source',           'Consistency',  'pounds', true,  '+/-0.05%', 0,   0.05, null, null, null],
  ['R-005', 'POS',  'transaction line id unique',       'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-006', 'POS',  'store code valid',                 'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-007', 'ECOM', 'order line id unique',             'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-008', 'ECOM', 'customer id present',              'Completeness', 'rows',   false, '<=0.5%',  0,    0.5,  null, null, null],
  ['R-009', 'ECOM', 'row count vs source',              'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-010', 'GL',   'row count vs source',              'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-011', 'GL',   'debits equal credits',             'Consistency',  'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-012', 'GL',   'file arrival by 05:00',            'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-013', 'LOY',  'row count vs source',              'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-014', 'LOY',  'email format valid',               'Validity',     'rows',   false, '<=1%',    0.25, 1.0,  null, null, null],
  ['R-015', 'LOY',  'member id unique',                 'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-016', 'ECOM', 'order amount vs source',           'Consistency',  'pounds', true,  '+/-0.05%', 0,   0.05, null, null, null],
  ['R-017', 'EDI',  'file lands by 05:00',              'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-018', 'EDI',  'invoice number unique',            'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-019', 'EDI',  'invoice count vs manifest',        'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-020', 'EDI',  'supplier code valid',              'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-021', 'PRD',  'barcode unique',                   'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, '2026-05-15'],
  ['R-022', 'EDI',  'invoice amount vs manifest',       'Consistency',  'pounds', true,  '+/-0.05%', 0,   0.05, null, null, null],
  ['R-023', 'ECOM', 'file arrival by 05:00',            'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-024', 'GL',   'journal line id unique',           'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-025', 'GL',   'account code valid',               'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-026', 'GL',   'journal amount vs source',         'Consistency',  'pounds', true,  '+/-0.05%', 0,   0.05, null, null, null],
  ['R-027', 'LOG',  'row count vs source',              'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-028', 'LOG',  'file arrival by 05:00',            'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-029', 'LOG',  'shipment id unique',               'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-030', 'LOG',  'depot code valid',                 'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-031', 'LOG',  'status transitions consistent',    'Consistency',  'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-032', 'LOY',  'file arrival by 05:00',            'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-033', 'LOY',  'mandatory member fields present',  'Completeness', 'rows',   false, '<=0.5%',  0,    0.5,  null, null, null],
  ['R-034', 'LOY',  'join date not in future',          'Consistency',  'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-035', 'PRD',  'row count vs source',              'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-036', 'PRD',  'file arrival by 05:00',            'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-037', 'PRD',  'product key unique',               'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-038', 'PRD',  'category reference valid',         'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-039', 'PRD',  'unit price non-negative',          'Consistency',  'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-040', 'STO',  'row count vs source',              'Completeness', 'rows',   true,  '0',       0,    0.5,  null, null, null],
  ['R-041', 'STO',  'file arrival by 05:00',            'Timeliness',   'files',  true,  '05:00',   null, null, 0,    60,   null],
  ['R-042', 'STO',  'store id unique',                  'Uniqueness',   'rows',   false, '0',       0,    0.05, null, null, null],
  ['R-043', 'STO',  'postcode format valid',            'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-044', 'STO',  'region reference valid',           'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-045', 'ECOM', 'currency code valid',              'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-046', 'ECOM', 'order status valid',               'Validity',     'rows',   false, '0',       0,    0.5,  null, null, null],
  ['R-047', 'EDI',  'mandatory invoice fields present', 'Completeness', 'rows',   false, '<=0.5%',  0,    0.5,  null, null, null],
  ['R-048', 'POS',  'basket id present',                'Completeness', 'rows',   false, '<=0.5%',  0,    0.5,  null, null, null],
];
const rulesOf = (code) => RULES.filter((r) => r[1] === code);

// ---------------------------------------------------------------- seeded events
// 29 Jun anchors (spec section 4): exact pairwise figures per feed.
const ANCHOR = {
  POS:  { src: 2412384, wh: 2412384, srcAmt: 18424913, whAmt: 18424913, arrive: 229, recv: 4 },
  ECOM: { src: 148062,  wh: 148059,  srcAmt: 1048650,  whAmt: 1048238,  arrive: 307, recv: 1 }, // 05:07, 3rd warn night
  GL:   { src: 96410,   wh: 96410,   srcAmt: 42806114, whAmt: 42806114, arrive: 161, recv: 1 },
  EDI:  { src: 8940,    wh: 7736,    srcAmt: 1594208,  whAmt: 1379600,  arrive: 341, recv: 2 }, // 05:41, file 2 of 3 missing
  LOG:  { src: 31254,   wh: 31254,   arrive: 286, recv: 2 },
  LOY:  { src: 1872455, wh: 1872455, arrive: 205, recv: 1 },
  PRD:  { src: 84312,   wh: 84312,   arrive: 168, recv: 1 },
  STO:  { src: 642,     wh: 642,     arrive: 171, recv: 1 },
};
// Row/amount shortfalls on other nights: [feed][iso] = { dRows, dAmt } (warehouse below source).
const SHORTFALL = {
  POS:  { '2026-06-14': { dRows: 50040, dAmt: 382306 } },                  // truncated Sunday extract (the incident)
  EDI:  { '2026-06-22': { dRows: 287, dAmt: 51326 }, '2026-06-24': { dRows: 0, dAmt: 470 } },
  ECOM: { '2026-06-27': { dRows: 1, dAmt: 139 }, '2026-06-28': { dRows: 2, dAmt: 260 } },
};
// EDI 22 Jun pairwise figures are pinned so the fail rates are quotable.
const EDI_22 = { src: 9124, srcAmt: 1631540 };
// Late arrivals: [feed][iso] = arrival minutes after midnight (deadline 05:00 = 300).
const LATE = {
  EDI: { '2026-04-04': 309, '2026-04-21': 318, '2026-05-07': 306, '2026-05-19': 322,
         '2026-06-01': 311, '2026-06-03': 312, '2026-06-08': 317, '2026-06-11': 305,
         '2026-06-18': 326, '2026-06-26': 314 },
  LOG: { '2026-04-28': 313, '2026-06-05': 311, '2026-06-24': 320 },
  GL:  { '2026-04-09': 310 },
};
// In-warehouse rule failures: [ruleId][iso] = units failed (rows).
const RULE_EVENTS = {
  'R-008': { '2026-06-29': 214 },
  'R-021': { '2026-06-28': 14, '2026-06-29': 14 },
  'R-015': { '2026-05-12': 82, '2026-06-26': 374 },
  'R-007': { '2026-06-23': 18 },
};
// R-014 email validity: baseline drifts under the 0.25% warn threshold, then crosses it.
const R014_RATE = (iso) =>
  iso === '2026-06-29' ? null /* exact count below */ :
  iso === '2026-06-28' ? 0.0047 :
  iso === '2026-06-27' ? 0.0031 :
  0.0018 + rand() * 0.0006;
const R014_29JUN = 12480;

// ---------------------------------------------------------------- feed runs
const mins = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// W4: DepotTrack writes arrival times inconsistently; every other feed writes HH:MM.
const rawArrival = (feed, m, idx) => {
  if (feed !== 'LOG') return mins(m);
  const style = idx % 3;
  if (style === 0) return mins(m);
  if (style === 1) return `${mins(m)}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// Snapshot feeds walk backwards from their 29 Jun anchor so the anchor is exact.
function backWalk(anchorVal, nDays, incFn) {
  const incs = [];
  for (let i = 0; i < nDays - 1; i++) incs.push(incFn());
  const vals = [anchorVal];
  for (let i = incs.length - 1; i >= 0; i--) vals.unshift(vals[0] - incs[i]);
  return vals;
}
const loyWalk = backWalk(ANCHOR.LOY.src, RUN_DAYS.length, () => 280 + Math.floor(rand() * 130));
const prdWalk = backWalk(ANCHOR.PRD.src, RUN_DAYS.length, () => Math.floor(rand() * 13));

const feedRuns = []; // { day, feed, src, wh, srcAmt, whAmt, filesExp, filesRecv, arriveMin, raw }
for (const day of RUN_DAYS) {
  for (const f of FEEDS) {
    if (!runsOn(f, day)) continue;
    let src, srcAmt = null;
    if (f.code === 'LOY') src = loyWalk[day.idx];
    else if (f.code === 'PRD') src = prdWalk[day.idx];
    else if (f.code === 'STO') src = day.iso < '2026-05-15' ? 641 : 642; // store opening
    else {
      const growth = 1 + 0.0011 * (day.idx / 7);
      src = Math.round(f.base * f.wd[day.dow] * growth * jitter(0.05));
      srcAmt = Math.round(src * f.avgVal * jitter(0.012));
    }
    if (f.code === 'EDI' && day.iso === '2026-06-22') { src = EDI_22.src; srcAmt = EDI_22.srcAmt; }
    let wh = src, whAmt = srcAmt;
    const short = (SHORTFALL[f.code] || {})[day.iso];
    if (short) { wh = src - short.dRows; if (srcAmt !== null) whAmt = srcAmt - short.dAmt; }
    let arriveMin = Math.round(f.arrive + (rand() - 0.5) * 24);
    const late = (LATE[f.code] || {})[day.iso];
    if (late) arriveMin = late;
    let filesRecv = f.files;
    if (day.iso === RUN_DATE) {
      const a = ANCHOR[f.code];
      src = a.src; wh = a.wh; arriveMin = a.arrive; filesRecv = a.recv;
      if (f.hasAmount) { srcAmt = a.srcAmt; whAmt = a.whAmt; }
    }
    if (!f.hasAmount) { srcAmt = null; whAmt = null; } // W6: genuinely blank, not zero
    feedRuns.push({ day, f, src, wh, srcAmt, whAmt, filesExp: f.files, filesRecv,
      arriveMin, raw: rawArrival(f.code, arriveMin, day.idx) });
  }
}
const runByFeedDay = {};
for (const r of feedRuns) runByFeedDay[`${r.f.code}|${r.day.iso}`] = r;

// ---------------------------------------------------------------- check results
const checkRows = []; // { day, ruleId, feed, seq, checked, failed, minsLate }
for (const day of RUN_DAYS) {
  for (const f of FEEDS) {
    const run = runByFeedDay[`${f.code}|${day.iso}`];
    if (!run) continue;
    for (const rule of rulesOf(f.code)) {
      const [id, , , dim, unit, , , , , , , activeFrom] = rule;
      if (activeFrom && day.iso < activeFrom) continue; // W3: rule added mid-window
      let checked, failed = 0, minsLate = null;
      if (dim === 'Timeliness') {
        checked = run.filesExp;
        failed = run.filesExp - run.filesRecv;
        minsLate = Math.max(0, run.arriveMin - 300);
      } else if (unit === 'pounds') {
        checked = run.srcAmt; failed = Math.abs(run.srcAmt - run.whAmt);
      } else if (id.endsWith('001') || id === 'R-009' || id === 'R-010' || id === 'R-013' ||
                 id === 'R-019' || id === 'R-027' || id === 'R-035' || id === 'R-040') {
        checked = run.src; failed = Math.abs(run.src - run.wh); // row count vs source
      } else {
        checked = run.wh;
        if (id === 'R-014') {
          failed = day.iso === RUN_DATE ? R014_29JUN : Math.round(run.wh * R014_RATE(day.iso));
        } else {
          failed = (RULE_EVENTS[id] || {})[day.iso] || 0;
        }
      }
      checkRows.push({ day, ruleId: id, feed: f.code, seq: 1, checked, failed, minsLate });
    }
  }
}
// W2: the 14 Jun POS incident checks ran twice - a first result set that understated the
// shortfall, then the corrected rerun. Keep-latest (max run_seq) gives the true figures.
{
  const incident = checkRows.filter((c) => c.feed === 'POS' && c.day.iso === '2026-06-14');
  for (const c of incident) {
    const first = { ...c, seq: 1 };
    if (c.ruleId === 'R-001') first.failed = 49900;
    if (c.ruleId === 'R-004') first.failed = 381236;
    c.seq = 2;
    checkRows.push(first);
  }
}
checkRows.sort((a, b) => a.day.iso.localeCompare(b.day.iso) ||
  a.ruleId.localeCompare(b.ruleId) || a.seq - b.seq);

// ---------------------------------------------------------------- break register
// Open breaks at 29 Jun: 14, hand-anchored (spec section 4). Ages 9,8,7,7,6,5,3,3,2,2,1,1,0,0.
const OPEN_BREAKS = [
  ['2026-06-20', 'PRD',  'Schema drift',          'Critical', 'Change raised with ERP team'],
  ['2026-06-21', 'EDI',  'Late arrival',          'High',     'Monitoring after gateway change'],
  ['2026-06-22', 'EDI',  'Row count mismatch',    'Critical', 'Waiting on supplier resend'],
  ['2026-06-22', 'GL',   'Schema drift',          'High',     'Extract column added; loader change in test'],
  ['2026-06-23', 'ECOM', 'Duplicate keys',        'High',     'Fix in code review'],
  ['2026-06-24', 'EDI',  'Amount mismatch',       'Medium',   'Investigating persistent small variance'],
  ['2026-06-26', 'EDI',  'Late arrival',          'Medium',   'Supplier SFTP window under review'],
  ['2026-06-26', 'LOY',  'Duplicate keys',        'Low',      'Fix scheduled 01 Jul'],
  ['2026-06-27', 'ECOM', 'Amount mismatch',       'Medium',   'Root cause identified: refund timing'],
  ['2026-06-27', 'LOY',  'Rule threshold breach', 'Medium',   'Email validity drift under investigation'],
  ['2026-06-28', 'ECOM', 'Row count mismatch',    'Low',      'Linked to refund timing'],
  ['2026-06-28', 'POS',  'Schema drift',          'High',     'New till software field under review'],
  ['2026-06-29', 'EDI',  'Missing file',          'Critical', 'Investigating'],
  ['2026-06-29', 'ECOM', 'Late arrival',          'Low',      'Arrived 05:07 - monitoring'],
];
// Recently resolved (the trailing-7-nights flow): opened 20-22 Jun, resolved 23-26 Jun.
const RECENT_RESOLVED = [
  ['2026-06-20', 3, 'EDI',  'Late arrival',       'Low'],
  ['2026-06-20', 4, 'POS',  'Amount mismatch',    'Medium'],
  ['2026-06-21', 2, 'LOG',  'Late arrival',       'Low'],
  ['2026-06-21', 3, 'ECOM', 'Row count mismatch', 'Medium'],
  ['2026-06-21', 4, 'LOY',  'Duplicate keys',     'Low'],
  ['2026-06-22', 1, 'GL',   'Late arrival',       'Low'],
  ['2026-06-22', 2, 'EDI',  'Row count mismatch', 'High'],
  ['2026-06-22', 3, 'PRD',  'Duplicate keys',     'Low'],
  ['2026-06-22', 4, 'EDI',  'Amount mismatch',    'Medium'],
];
// Older resolved breaks: 44 procedurally spread over 01 Apr - 19 Jun, plus the 14 Jun
// incident break (opened 14 Jun, resolved next day) and the W5 impossible record.
const CATS = ['Late arrival', 'Row count mismatch', 'Amount mismatch', 'Duplicate keys', 'Missing file', 'Schema drift'];
const CAT_W = [0.30, 0.22, 0.18, 0.14, 0.10, 0.06];
const SEVS = ['Low', 'Medium', 'High', 'Critical'];
const SEV_W = [0.42, 0.34, 0.18, 0.06];
const FEED_W = [['EDI', 0.30], ['ECOM', 0.20], ['LOY', 0.12], ['POS', 0.12], ['LOG', 0.10], ['GL', 0.06], ['PRD', 0.06], ['STO', 0.04]];
const pick = (items, weights) => {
  let r = rand(), acc = 0;
  for (let i = 0; i < items.length; i++) { acc += weights[i]; if (r < acc) return items[i]; }
  return items[items.length - 1];
};
const olderResolved = [];
{
  const startIdx = 0, endIdx = RUN_DAYS.findIndex((d) => d.iso === '2026-06-19');
  let acc = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    acc += 44 / (endIdx - startIdx + 1);
    while (acc >= 1) {
      acc -= 1;
      const opened = RUN_DAYS[i].iso;
      const feed = pick(FEED_W.map((x) => x[0]), FEED_W.map((x) => x[1]));
      const ttrPool = [0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6];
      let ttr = ttrPool[Math.floor(rand() * ttrPool.length)];
      let resolved = addDays(opened, ttr);
      if (resolved > '2026-06-22') resolved = '2026-06-22'; // keep the trailing-7 flow anchored
      olderResolved.push({ opened, resolved, feed, cat: pick(CATS, CAT_W), sev: pick(SEVS, SEV_W), status: 'Resolved' });
    }
  }
  // The 14 Jun POS truncation: raised critical, fixed by the next night's rerun.
  olderResolved.push({ opened: '2026-06-14', resolved: '2026-06-15', feed: 'POS',
    cat: 'Row count mismatch', sev: 'Critical', status: 'Resolved' });
  // W5: one record with resolved before opened - a data-entry slip left in the register.
  olderResolved[19].opened = '2026-05-12';
  olderResolved[19].resolved = '2026-05-10';
}
const allBreaks = [
  ...olderResolved.map((b) => ({ ...b })),
  ...RECENT_RESOLVED.map(([opened, ttr, feed, cat, sev]) =>
    ({ opened, resolved: addDays(opened, ttr), feed, cat, sev, status: 'Resolved' })),
  ...OPEN_BREAKS.map(([opened, feed, cat, sev, status]) =>
    ({ opened, resolved: null, feed, cat, sev, status, isOpen: true })),
];
// Number by opened date; the anchored open breaks keep their listed order within a day
// (PRD schema drift is first on 20 Jun, so it lands on BRK-0171 - 45 breaks precede it).
allBreaks.sort((a, b) => a.opened.localeCompare(b.opened) ||
  (a.isOpen === b.isOpen ? 0 : a.isOpen ? 1 : -1));
// exception: on 20 Jun the open PRD break must precede the recent-resolved ones
{
  const jun20 = allBreaks.filter((b) => b.opened === '2026-06-20');
  const rest = allBreaks.filter((b) => b.opened !== '2026-06-20');
  jun20.sort((a, b) => (a.isOpen === b.isOpen ? 0 : a.isOpen ? -1 : 1));
  const at = allBreaks.findIndex((b) => b.opened === '2026-06-20');
  allBreaks.length = 0; allBreaks.push(...rest.slice(0, at), ...jun20, ...rest.slice(at));
}
allBreaks.forEach((b, i) => { b.id = `BRK-${String(126 + i).padStart(4, '0')}`; });

// ---------------------------------------------------------------- write CSVs
const outDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
const csv = (name, header, rows) => {
  fs.writeFileSync(path.join(outDir, name), header + '\n' + rows.join('\n') + '\n');
  console.log(`  ${name.padEnd(22)} ${String(rows.length).padStart(6)} rows`);
};
console.log('Writing CSVs to ' + outDir);
csv('date.csv', 'date,date_key,day_label,weekday,is_weekend,week_start,month',
  DAYS.map((d) => [d.iso, d.key, d.label, d.weekday, d.isWeekend, d.weekStart, d.month].join(',')));
csv('feed.csv', 'feed_key,feed_code,feed,source_system,schedule,steward,has_amount,arrival_deadline,files_expected',
  FEEDS.map((f) => [f.key, f.code, f.name, f.source,
    f.schedule === 'daily' ? 'Daily' : f.schedule === 'weekdays' ? 'Weekdays' : 'Mon-Sat',
    f.steward, f.hasAmount, '05:00', f.files].join(',')));
csv('rule.csv', 'rule_id,rule_name,feed_code,quality_dimension,unit,is_load_check,tolerance_label,warn_above_pct,fail_above_pct,warn_late_mins,fail_late_mins,active_from',
  RULES.map((r) => [r[0], r[2], r[1], r[3], r[4], r[5], r[6],
    r[7] ?? '', r[8] ?? '', r[9] ?? '', r[10] ?? '', r[11] ?? ''].join(',')));
csv('feed_run.csv', 'date,feed_code,source_rows,warehouse_rows,source_amount,warehouse_amount,files_expected,files_received,arrival_time_raw',
  feedRuns.map((r) => [r.day.iso, r.f.code, r.src, r.wh, r.srcAmt ?? '', r.whAmt ?? '',
    r.filesExp, r.filesRecv, r.raw].join(',')));
csv('check_result.csv', 'date,rule_id,feed_code,run_seq,units_checked,units_failed,minutes_late',
  checkRows.map((c) => [c.day.iso, c.ruleId, c.feed, c.seq, c.checked, c.failed, c.minsLate ?? ''].join(',')));
csv('break_register.csv', 'break_id,opened,resolved,feed_code,category,severity,owner,status',
  allBreaks.map((b) => [b.id, b.opened, b.resolved ?? '', b.feed, b.cat, b.sev,
    feedByCode[b.feed].steward, b.status].join(',')));

// ---------------------------------------------------------------- verification
// Re-derive every verdict exactly as the DAX will: thresholds from the rule table,
// keep-latest on run_seq, load checks driving the feed verdict.
console.log('\n=== Verification (all figures re-derived from the written data) ===');
const ruleById = Object.fromEntries(RULES.map((r) => [r[0], r]));
const latest = {};
for (const c of checkRows) {
  const k = `${c.ruleId}|${c.day.iso}`;
  if (!latest[k] || c.seq > latest[k].seq) latest[k] = c;
}
function verdict(c) {
  const r = ruleById[c.ruleId];
  if (r[3] === 'Timeliness') {
    if (c.failed > 0 || c.minsLate > r[10]) return 'FAIL';
    if (c.minsLate > r[9]) return 'WARN';
    return 'PASS';
  }
  const rate = c.checked ? (c.failed / c.checked) * 100 : 0;
  if (rate > r[8]) return 'FAIL';
  if (rate > r[7]) return 'WARN';
  return 'PASS';
}
const checksOn = (iso) => Object.values(latest).filter((c) => c.day.iso === iso);
const feedVerdict = (code, iso) => {
  const loads = checksOn(iso).filter((c) => c.feed === code && ruleById[c.ruleId][5]);
  if (!loads.length) return 'NORUN';
  const v = loads.map(verdict);
  return v.includes('FAIL') ? 'FAIL' : v.includes('WARN') ? 'WARN' : 'PASS';
};
const ok = (label, got, want) => {
  const pass = String(got) === String(want);
  console.log(`  ${pass ? 'OK  ' : 'MISS'} ${label}: ${got}${pass ? '' : '  (wanted ' + want + ')'}`);
};

// 29 Jun anchors
const runsToday = feedRuns.filter((r) => r.day.iso === RUN_DATE);
const totSrc = runsToday.reduce((s, r) => s + r.src, 0);
const totDelta = runsToday.reduce((s, r) => s + Math.abs(r.src - r.wh), 0);
ok('29 Jun source rows compared', totSrc.toLocaleString('en-GB'), '4,654,459');
ok('29 Jun row match rate', ((1 - totDelta / totSrc) * 100).toFixed(2) + '%', '99.97%');
const verdicts29 = FEEDS.map((f) => feedVerdict(f.code, RUN_DATE));
ok('29 Jun feeds pass/warn/fail',
  ['PASS', 'WARN', 'FAIL'].map((v) => verdicts29.filter((x) => x === v).length).join('/'), '6/1/1');
ok('29 Jun EDI verdict', feedVerdict('EDI', RUN_DATE), 'FAIL');
ok('29 Jun ECOM verdict (3rd warn night: 27, 28, 29)',
  ['2026-06-27', '2026-06-28', '2026-06-29'].map((d) => feedVerdict('ECOM', d)).join(','), 'WARN,WARN,WARN');
const c29 = checksOn(RUN_DATE).map(verdict);
console.log(`  --   29 Jun rules evaluated ${c29.length}: ` +
  `${c29.filter((v) => v === 'PASS').length} pass / ${c29.filter((v) => v === 'WARN').length} warn / ${c29.filter((v) => v === 'FAIL').length} fail`);
const fails29 = checksOn(RUN_DATE).filter((c) => verdict(c) === 'FAIL').map((c) => c.ruleId).join(' ');
ok('29 Jun failing rules all on EDI', fails29, 'R-017 R-019 R-022');

// the 14 Jun incident
const runs14 = feedRuns.filter((r) => r.day.iso === '2026-06-14');
const rate14 = 1 - runs14.reduce((s, r) => s + Math.abs(r.src - r.wh), 0) / runs14.reduce((s, r) => s + r.src, 0);
console.log(`  --   14 Jun match rate ${(rate14 * 100).toFixed(2)}% (dip visible), POS verdict ${feedVerdict('POS', '2026-06-14')}`);

// dimension pass rates, trailing 30 nights
const win30 = RUN_DAYS.slice(-30).map((d) => d.iso);
const dims = {};
for (const c of Object.values(latest)) {
  if (!win30.includes(c.day.iso)) continue;
  const dim = ruleById[c.ruleId][3];
  dims[dim] = dims[dim] || { n: 0, pass: 0 };
  dims[dim].n++;
  if (verdict(c) === 'PASS') dims[dim].pass++;
}
console.log('  --   dimension pass rates, trailing 30 nights (share of evaluations PASS):');
for (const [d, v] of Object.entries(dims).sort((a, b) => a[1].pass / a[1].n - b[1].pass / b[1].n))
  console.log(`         ${d.padEnd(13)} ${((v.pass / v.n) * 100).toFixed(1)}%  (${v.pass}/${v.n})`);

// breaks
const openAt = allBreaks.filter((b) => b.opened <= RUN_DATE && (!b.resolved || b.resolved > RUN_DATE));
const ages = openAt.map((b) => Math.round((Date.parse(RUN_DATE) - Date.parse(b.opened)) / 86400000)).sort((a, b) => a - b);
const median = (ages[6] + ages[7]) / 2;
ok('open breaks at 29 Jun', openAt.length, 14);
ok('open by severity C/H/M/L', SEVS.slice().reverse().map((s) => openAt.filter((b) => b.sev === s).length).join('/'), '3/4/4/3');
ok('median open age (days)', median, 3);
const oldest = openAt.reduce((a, b) => (a.opened < b.opened ? a : b));
ok('oldest open break', `${oldest.id} ${oldest.feed} ${oldest.cat} 9d`, 'BRK-0171 PRD Schema drift 9d');
ok('open breaks on EDI', openAt.filter((b) => b.feed === 'EDI').length, 5);
const week = allBreaks.filter((b) => b.resolved && b.resolved >= '2026-06-23' && b.resolved <= RUN_DATE);
const openedWeek = allBreaks.filter((b) => b.opened >= '2026-06-23' && b.opened <= RUN_DATE);
console.log(`  --   trailing 7 nights: resolved ${week.length}, opened ${openedWeek.length}`);
const mttrSet = allBreaks.filter((b) => b.resolved && b.resolved >= '2026-06-02' && b.resolved <= RUN_DATE && b.resolved >= b.opened);
const mttr = mttrSet.reduce((s, b) => s + (Date.parse(b.resolved) - Date.parse(b.opened)) / 86400000, 0) / mttrSet.length;
console.log(`  --   MTTR trailing 28 nights ${mttr.toFixed(1)} days over ${mttrSet.length} resolutions (target <= 3.0)`);
console.log(`  --   break ids ${allBreaks[0].id} .. ${allBreaks[allBreaks.length - 1].id} (${allBreaks.length} breaks)`);

// wrinkles
console.log('  --   wrinkles:');
console.log(`         W1 no-run nights: GL ${RUN_DAYS.filter((d) => !runsOn(feedByCode.GL, d)).length}, EDI ${RUN_DAYS.filter((d) => !runsOn(feedByCode.EDI, d)).length} (absent from facts, never failures)`);
console.log(`         W2 duplicate 14 Jun POS check rows: ${checkRows.filter((c) => c.feed === 'POS' && c.day.iso === '2026-06-14').length} raw, ${checksOn('2026-06-14').filter((c) => c.feed === 'POS').length} after keep-latest`);
console.log(`         W3 R-021 first evaluated: ${checkRows.filter((c) => c.ruleId === 'R-021')[0].day.iso} (added mid-window)`);
console.log(`         W4 DepotTrack arrival formats: ${[...new Set(feedRuns.filter((r) => r.f.code === 'LOG').map((r) => (r.raw.match(/:/g) || []).length + '-colon' + (r.raw.length < 5 ? ' short' : '')))].length} variants in raw column`);
const w5 = allBreaks.find((b) => b.resolved && b.resolved < b.opened);
console.log(`         W5 impossible break record: ${w5.id} opened ${w5.opened} resolved ${w5.resolved} (excluded from MTTR)`);
console.log(`         W6 blank amount runs (non-monetary feeds): ${feedRuns.filter((r) => r.srcAmt === null).length}`);
