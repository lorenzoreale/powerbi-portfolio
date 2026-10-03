'use strict';
// Deterministic data generator for the Data Reconciliation Monitor.
// The figures the report has to show are listed in the project README.
// Run: node generate-data.js   (writes CSVs to ../data and prints a check summary)
//
// The facts are measurements about data, not the data itself: for every overnight load
// the platform records how many rows and how much value the source sent, how much
// landed in the warehouse, which files arrived and when, and how many records failed
// each quality rule. No pass or fail is stored. The model works every verdict out from
// these observations and the thresholds on the rule table, and so does the summary at
// the bottom of this script.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- randomness
// Embedded PRNG (mulberry32), so the output is identical on every machine.
const SEED = 20260629;
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
const jitter = (spread) => 1 + (rand() - 0.5) * spread;

// ---------------------------------------------------------------- calendar
// Loads run every night from 1 Apr to 29 Jun 2026, the last load. The date table covers the same nights.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = [];
for (let t = Date.UTC(2026, 3, 1); t <= Date.UTC(2026, 5, 29); t += 86400000) {
  const d = new Date(t);
  DAYS.push({ iso: d.toISOString().slice(0, 10), dow: d.getUTCDay(), month: `${MONTH_NAMES[d.getUTCMonth()]} 2026`, idx: DAYS.length });
}
const LAST_LOAD = '2026-06-29';
const LOAD_DAYS = DAYS;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- data areas (feeds)
// area: the business name. feedsInto: the reporting each load feeds. record: what one row is.
// schedule: daily | weekdays | monsat. base: typical rows a night. avgVal: mean value per row (GBP).
// wd: volume factor by weekday (Sun..Sat). arrive: usual arrival, minutes after midnight (deadline 05:00 = 300).
const FEEDS = [
  { code: 'POS', area: 'Store sales', name: 'POS transactions', source: 'Storeline POS', feedsInto: 'Sales, margin and stock', record: 'transactions',
    schedule: 'daily', owner: 'L. Prentice', hasAmount: true, files: 4, base: 2300000, avgVal: 7.64, wd: [1.05, 0.98, 0.94, 0.96, 1.0, 1.12, 1.25], arrive: 232 },
  { code: 'ECOM', area: 'Online orders', name: 'E-commerce orders', source: 'Webshop', feedsInto: 'Online sales and returns', record: 'orders',
    schedule: 'daily', owner: 'L. Prentice', hasAmount: true, files: 1, base: 141000, avgVal: 7.08, wd: [1.05, 1.08, 1.0, 0.98, 0.99, 1.02, 0.92], arrive: 251 },
  { code: 'GL', area: 'Finance ledger', name: 'ERP GL journal', source: 'Ledger ERP', feedsInto: 'Management accounts', record: 'journal lines',
    schedule: 'weekdays', owner: 'J. Meads', hasAmount: true, files: 1, base: 91000, avgVal: 444.0, wd: [0, 1.0, 1.0, 1.0, 1.0, 1.05, 0], arrive: 155 },
  { code: 'EDI', area: 'Supplier invoices', name: 'Supplier EDI invoices', source: 'EDI gateway', feedsInto: 'Accounts payable and supplier spend', record: 'invoices',
    schedule: 'monsat', owner: 'D. Okafor', hasAmount: true, files: 3, base: 8700, avgVal: 178.3, wd: [0, 1.15, 1.0, 0.98, 0.97, 1.02, 0.9], arrive: 272 },
  { code: 'LOG', area: 'Deliveries', name: 'Logistics shipments', source: 'DepotTrack', feedsInto: 'Logistics and availability', record: 'shipments',
    schedule: 'daily', owner: 'S. Varga', hasAmount: false, files: 2, base: 29500, avgVal: 0, wd: [0.72, 1.06, 1.04, 1.02, 1.03, 1.05, 0.95], arrive: 282 },
  { code: 'LOY', area: 'Loyalty members', name: 'Loyalty members', source: 'Loyalty CRM', feedsInto: 'Customer and marketing', record: 'members',
    schedule: 'daily', owner: 'S. Varga', hasAmount: false, files: 1, base: 0, avgVal: 0, wd: null, arrive: 202 },
  { code: 'PRD', area: 'Products', name: 'Product master', source: 'Ledger ERP', feedsInto: 'All product reporting', record: 'products',
    schedule: 'daily', owner: 'J. Meads', hasAmount: false, files: 1, base: 0, avgVal: 0, wd: null, arrive: 172 },
  { code: 'STO', area: 'Stores', name: 'Store master', source: 'Ledger ERP', feedsInto: 'All store reporting', record: 'stores',
    schedule: 'daily', owner: 'J. Meads', hasAmount: false, files: 1, base: 0, avgVal: 0, wd: null, arrive: 174 },
];
const feedByCode = Object.fromEntries(FEEDS.map((f) => [f.code, f]));
const runsOn = (f, d) => (f.schedule === 'daily' ? true : f.schedule === 'weekdays' ? d.dow >= 1 && d.dow <= 5 : d.dow >= 1 && d.dow <= 6);

// ---------------------------------------------------------------- the rulebook (48 rules)
// [id, feed, name, dimension, unit, isLoadCheck, warnAbove%, failAbove%, warnLateMins, failLateMins, activeFrom, problem]
// Load checks (rows and value against the source, file arrival) decide whether a data area
// can be used. The other rules check the data once it has landed. `problem` names what a
// failing record is, in plain words, for the notes on the Status page.
const RULES = [
  ['R-001', 'POS', 'row count vs source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-002', 'POS', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-003', 'POS', 'basket total equals line sum', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'baskets whose total differs from their lines'],
  ['R-004', 'POS', 'sales value vs source', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-005', 'POS', 'transaction line id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate transaction lines'],
  ['R-006', 'POS', 'store code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'transactions with an unknown store code'],
  ['R-007', 'ECOM', 'order line id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate order lines'],
  ['R-008', 'ECOM', 'customer id present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'orders with no customer id'],
  ['R-009', 'ECOM', 'row count vs source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-010', 'GL', 'row count vs source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-011', 'GL', 'debits equal credits', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'journals whose debits and credits differ'],
  ['R-012', 'GL', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-013', 'LOY', 'row count vs source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-014', 'LOY', 'email format valid', 'Validity', 'rows', false, 0.25, 1.0, null, null, null, 'members with an invalid email'],
  ['R-015', 'LOY', 'member id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate member ids'],
  ['R-016', 'ECOM', 'order value vs source', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-017', 'EDI', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-018', 'EDI', 'invoice number unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate invoice numbers'],
  ['R-019', 'EDI', 'invoice count vs manifest', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-020', 'EDI', 'supplier code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'invoices with an unknown supplier code'],
  ['R-021', 'PRD', 'barcode unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, '2026-05-15', 'duplicate barcodes'],
  ['R-022', 'EDI', 'invoice value vs manifest', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-023', 'ECOM', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-024', 'GL', 'journal line id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate journal lines'],
  ['R-025', 'GL', 'account code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'journal lines with an unknown account code'],
  ['R-026', 'GL', 'journal value vs source', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-027', 'LOG', 'row count vs source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-028', 'LOG', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-029', 'LOG', 'shipment id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate shipments'],
  ['R-030', 'LOG', 'depot code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'shipments with an unknown depot'],
  ['R-031', 'LOG', 'status transitions consistent', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'shipments with an impossible status change'],
  ['R-032', 'LOY', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-033', 'LOY', 'mandatory member fields present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'members missing a mandatory field'],
  ['R-034', 'LOY', 'join date not in future', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'members with a join date in the future'],
  ['R-035', 'PRD', 'row count vs source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-036', 'PRD', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-037', 'PRD', 'product key unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate product keys'],
  ['R-038', 'PRD', 'category reference valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'products with an unknown category'],
  ['R-039', 'PRD', 'unit price not negative', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'products with a negative price'],
  ['R-040', 'STO', 'row count vs source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-041', 'STO', 'file arrival by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-042', 'STO', 'store id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'duplicate store ids'],
  ['R-043', 'STO', 'postcode format valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'stores with an invalid postcode'],
  ['R-044', 'STO', 'region reference valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'stores with an unknown region'],
  ['R-045', 'ECOM', 'currency code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'orders with an unknown currency'],
  ['R-046', 'ECOM', 'order status valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'orders with an unknown status'],
  ['R-047', 'EDI', 'mandatory invoice fields present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'invoices missing a mandatory field'],
  ['R-048', 'POS', 'basket id present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'transactions with no basket id'],
];
const rulesOf = (code) => RULES.filter((r) => r[1] === code);
const ROW_COUNT_RULES = new Set(RULES.filter((r) => r[5] && r[4] === 'rows').map((r) => r[0]));

// ---------------------------------------------------------------- the story
// The last load, 29 Jun: exact figures per data area.
const LAST = {
  POS: { src: 2412384, wh: 2412384, srcAmt: 18424913, whAmt: 18424913, arrive: 229, recv: 4 },
  ECOM: { src: 148062, wh: 148059, srcAmt: 1048650, whAmt: 1048238, arrive: 288, recv: 1 }, // third night a few orders short
  GL: { src: 96410, wh: 96410, srcAmt: 42806114, whAmt: 42806114, arrive: 161, recv: 1 },
  EDI: { src: 8940, wh: 7736, srcAmt: 1594208, whAmt: 1379600, arrive: 341, recv: 2 }, // file 2 of 3 missing, the rest at 05:41
  LOG: { src: 31254, wh: 31254, arrive: 286, recv: 2 },
  LOY: { src: 1872455, wh: 1872455, arrive: 205, recv: 1 },
  PRD: { src: 84312, wh: 84312, arrive: 168, recv: 1 },
  STO: { src: 642, wh: 642, arrive: 171, recv: 1 },
};
// Shortfalls on earlier nights: warehouse below source by dRows and dAmt.
const SHORTFALL = {
  POS: { '2026-06-14': { dRows: 50040, dAmt: 382306 } }, // a truncated Sunday extract, rerun the next day
  EDI: { '2026-06-22': { dRows: 287, dAmt: 51326 }, '2026-06-24': { dRows: 0, dAmt: 470 } },
  ECOM: { '2026-06-27': { dRows: 1, dAmt: 139 }, '2026-06-28': { dRows: 2, dAmt: 260 } },
};
const EDI_22 = { src: 9124, srcAmt: 1631540 }; // pinned, so the 22 Jun failure is quotable
// Late arrivals: minutes after midnight.
const LATE = {
  EDI: { '2026-04-04': 309, '2026-04-21': 318, '2026-05-07': 306, '2026-05-19': 322, '2026-06-01': 311,
    '2026-06-03': 312, '2026-06-08': 317, '2026-06-11': 305, '2026-06-18': 326, '2026-06-26': 314 },
  LOG: { '2026-04-28': 313, '2026-06-05': 311, '2026-06-24': 320 },
  GL: { '2026-04-09': 310 },
};
// Records failing in-warehouse rules on given nights.
const RULE_EVENTS = {
  'R-008': { '2026-06-29': 214 },
  'R-021': { '2026-06-28': 14, '2026-06-29': 14 },
  'R-015': { '2026-05-12': 82, '2026-06-26': 374 },
  'R-007': { '2026-06-23': 18 },
};
// R-014, invalid emails: a low background rate that crosses the 0.25% warning line on 27 Jun.
const R014_RATE = (iso) => (iso === '2026-06-28' ? 0.0047 : iso === '2026-06-27' ? 0.0031 : 0.0018 + rand() * 0.0006);
const R014_LAST = 12480;

// ---------------------------------------------------------------- loads
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// DepotTrack writes its arrival time three ways ("05:41", "05:41:22", "5:41"); every other system writes HH:MM.
const rawArrival = (code, m, idx) => {
  if (code !== 'LOG' || idx % 3 === 0) return hhmm(m);
  if (idx % 3 === 1) return `${hhmm(m)}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
// Reference data (members, products, stores) is a full snapshot every night: walk back from the last load.
function walkBack(lastValue, nights, step) {
  const steps = [];
  for (let i = 0; i < nights - 1; i++) steps.push(step());
  const values = [lastValue];
  for (let i = steps.length - 1; i >= 0; i--) values.unshift(values[0] - steps[i]);
  return values;
}
const members = walkBack(LAST.LOY.src, LOAD_DAYS.length, () => 280 + Math.floor(rand() * 130));
const products = walkBack(LAST.PRD.src, LOAD_DAYS.length, () => Math.floor(rand() * 13));

const loads = [];
for (const day of LOAD_DAYS) {
  for (const f of FEEDS) {
    if (!runsOn(f, day)) continue;
    let src, srcAmt = null;
    if (f.code === 'LOY') src = members[day.idx];
    else if (f.code === 'PRD') src = products[day.idx];
    else if (f.code === 'STO') src = day.iso < '2026-05-15' ? 641 : 642; // a store opened on 15 May
    else {
      const growth = 1 + 0.0011 * (day.idx / 7);
      src = Math.round(f.base * f.wd[day.dow] * growth * jitter(0.05));
      srcAmt = Math.round(src * f.avgVal * jitter(0.012));
    }
    if (f.code === 'EDI' && day.iso === '2026-06-22') { src = EDI_22.src; srcAmt = EDI_22.srcAmt; }
    let wh = src, whAmt = srcAmt;
    const short = (SHORTFALL[f.code] || {})[day.iso];
    if (short) { wh = src - short.dRows; if (srcAmt !== null) whAmt = srcAmt - short.dAmt; }
    let arrive = Math.round(f.arrive + (rand() - 0.5) * 24);
    if ((LATE[f.code] || {})[day.iso]) arrive = LATE[f.code][day.iso];
    let recv = f.files;
    if (day.iso === LAST_LOAD) {
      const a = LAST[f.code];
      src = a.src; wh = a.wh; arrive = a.arrive; recv = a.recv;
      if (f.hasAmount) { srcAmt = a.srcAmt; whAmt = a.whAmt; }
    }
    if (!f.hasAmount) { srcAmt = null; whAmt = null; } // no value to reconcile: blank, not zero
    loads.push({ day, f, src, wh, srcAmt, whAmt, files: f.files, recv, arrive, raw: rawArrival(f.code, arrive, day.idx) });
  }
}
const loadOf = Object.fromEntries(loads.map((l) => [`${l.f.code}|${l.day.iso}`, l]));

// ---------------------------------------------------------------- rule results
const results = [];
for (const day of LOAD_DAYS) {
  for (const f of FEEDS) {
    const load = loadOf[`${f.code}|${day.iso}`];
    if (!load) continue;
    for (const [id, , , dim, unit, , , , , , activeFrom] of rulesOf(f.code)) {
      if (activeFrom && day.iso < activeFrom) continue; // R-021 joined the rulebook on 15 May
      let checked, failed = 0, late = null;
      if (dim === 'Timeliness') {
        checked = load.files; failed = load.files - load.recv; late = Math.max(0, load.arrive - 300);
      } else if (unit === 'pounds') {
        checked = load.srcAmt; failed = Math.abs(load.srcAmt - load.whAmt);
      } else if (ROW_COUNT_RULES.has(id)) {
        checked = load.src; failed = Math.abs(load.src - load.wh);
      } else {
        checked = load.wh;
        if (id === 'R-014') failed = day.iso === LAST_LOAD ? R014_LAST : Math.round(load.wh * R014_RATE(day.iso));
        else failed = (RULE_EVENTS[id] || {})[day.iso] || 0;
      }
      results.push({ day, id, feed: f.code, seq: 1, checked, failed, late });
    }
  }
}
// The 14 Jun store sales checks ran twice: a first set that understated the shortfall,
// then the rerun with the true figures. The model keeps the latest run_seq.
for (const r of results.filter((x) => x.feed === 'POS' && x.day.iso === '2026-06-14')) {
  const first = { ...r, seq: 1 };
  if (r.id === 'R-001') first.failed = 49900;
  if (r.id === 'R-004') first.failed = 381236;
  r.seq = 2;
  results.push(first);
}
results.sort((a, b) => a.day.iso.localeCompare(b.day.iso) || a.id.localeCompare(b.id) || a.seq - b.seq);

// ---------------------------------------------------------------- issue log
// Open at the last load: 14 issues, 3 critical. Each data area's most recent open issue
// says where its problem stands, in the words the Status page quotes.
const OPEN = [
  ['2026-06-20', 'PRD', 'Schema change', 'Critical', 'Change raised with the ERP team'],
  ['2026-06-21', 'EDI', 'Late arrival', 'High', 'Monitoring since the gateway change'],
  ['2026-06-22', 'EDI', 'Rows missing', 'Critical', 'Waiting on the supplier to resend'],
  ['2026-06-22', 'GL', 'Schema change', 'High', 'Loader change for the new extract column in test'],
  ['2026-06-23', 'ECOM', 'Duplicate records', 'High', 'Fix in code review'],
  ['2026-06-24', 'EDI', 'Value difference', 'Medium', 'Investigating a small recurring difference'],
  ['2026-06-26', 'EDI', 'Late arrival', 'Medium', 'Supplier upload window under review'],
  ['2026-06-26', 'LOY', 'Duplicate records', 'Low', 'Fix scheduled for 1 July'],
  ['2026-06-27', 'ECOM', 'Rows missing', 'Low', 'Linked to the refund timing issue'],
  ['2026-06-27', 'LOY', 'Rule breach', 'Medium', 'Invalid emails rising, sign-up form under investigation'],
  ['2026-06-28', 'ECOM', 'Value difference', 'Medium', 'Refunds posted after the extract closes, fix agreed'],
  ['2026-06-28', 'POS', 'Schema change', 'High', 'New till software field under review'],
  ['2026-06-28', 'PRD', 'Duplicate records', 'Medium', 'Duplicate barcodes traced to a catalogue upload'],
  ['2026-06-29', 'EDI', 'Missing file', 'Critical', 'Waiting on the supplier to resend file 2'],
];
// Resolved in the last week: opened 20 to 22 Jun, closed 23 to 26 Jun. [opened, days to resolve, feed, category, severity]
const RECENT = [
  ['2026-06-20', 3, 'EDI', 'Late arrival', 'Low'], ['2026-06-20', 4, 'POS', 'Value difference', 'Medium'],
  ['2026-06-21', 2, 'LOG', 'Late arrival', 'Low'], ['2026-06-21', 3, 'ECOM', 'Rows missing', 'Medium'],
  ['2026-06-21', 4, 'LOY', 'Duplicate records', 'Low'], ['2026-06-22', 1, 'GL', 'Late arrival', 'Low'],
  ['2026-06-22', 2, 'EDI', 'Rows missing', 'High'], ['2026-06-22', 3, 'PRD', 'Duplicate records', 'Low'],
  ['2026-06-22', 4, 'EDI', 'Value difference', 'Medium'],
];
// Earlier history: 44 resolved issues spread over 1 Apr to 19 Jun, plus the 14 Jun store sales incident.
const CATEGORIES = ['Late arrival', 'Rows missing', 'Value difference', 'Duplicate records', 'Missing file', 'Schema change'];
const CATEGORY_WEIGHTS = [0.3, 0.22, 0.18, 0.14, 0.1, 0.06];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const SEVERITY_WEIGHTS = [0.42, 0.34, 0.18, 0.06];
const FEED_WEIGHTS = [['EDI', 0.3], ['ECOM', 0.2], ['LOY', 0.12], ['POS', 0.12], ['LOG', 0.1], ['GL', 0.06], ['PRD', 0.06], ['STO', 0.04]];
const pick = (items, weights) => {
  const r = rand();
  let acc = 0;
  for (let i = 0; i < items.length; i++) { acc += weights[i]; if (r < acc) return items[i]; }
  return items[items.length - 1];
};
const history = [];
{
  const last = LOAD_DAYS.findIndex((d) => d.iso === '2026-06-19');
  let acc = 0;
  for (let i = 0; i <= last; i++) {
    acc += 44 / (last + 1);
    while (acc >= 1) {
      acc -= 1;
      const opened = LOAD_DAYS[i].iso;
      const feed = pick(FEED_WEIGHTS.map((x) => x[0]), FEED_WEIGHTS.map((x) => x[1]));
      const days = [0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6][Math.floor(rand() * 15)];
      let resolved = addDays(opened, days);
      if (resolved > '2026-06-22') resolved = '2026-06-22'; // keep the last week's flow as set above
      history.push({ opened, resolved, feed, cat: pick(CATEGORIES, CATEGORY_WEIGHTS), sev: pick(SEVERITIES, SEVERITY_WEIGHTS) });
    }
  }
  history.push({ opened: '2026-06-14', resolved: '2026-06-15', feed: 'POS', cat: 'Rows missing', sev: 'Critical' });
  // A data-entry slip: one issue closed two days before it was opened. Left in the log for the model to catch.
  history[19].opened = '2026-05-12';
  history[19].resolved = '2026-05-10';
}
const issues = [
  ...history.map((h) => ({ ...h, status: 'Resolved' })),
  ...RECENT.map(([opened, days, feed, cat, sev]) => ({ opened, resolved: addDays(opened, days), feed, cat, sev, status: 'Resolved' })),
  ...OPEN.map(([opened, feed, cat, sev, status]) => ({ opened, resolved: null, feed, cat, sev, status, open: true })),
];
// Number by date opened, resolved issues before open ones on the same day, except on 20 Jun,
// where the open schema change comes first so that it is ISS-0171.
const sameDayOrder = (x) => ((x.opened === '2026-06-20' ? !x.open : x.open) ? 1 : 0);
issues.sort((a, b) => a.opened.localeCompare(b.opened) || sameDayOrder(a) - sameDayOrder(b));
issues.forEach((x, i) => { x.id = `ISS-${String(126 + i).padStart(4, '0')}`; });

// ---------------------------------------------------------------- write CSVs
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const esc = (x) => { const s = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const write = (file, header, rows) => fs.writeFileSync(path.join(dataDir, file), [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n', 'utf8');
const scheduleName = { daily: 'Every night', weekdays: 'Monday to Friday', monsat: 'Monday to Saturday' };

write('date.csv', ['date', 'weekday', 'month'], DAYS.map((d) => [d.iso, WEEKDAYS[d.dow], d.month]));
write('feed.csv', ['feed_code', 'data_area', 'feed', 'source_system', 'feeds_into', 'record_name', 'schedule', 'owner', 'has_value', 'files_expected', 'sort_order'],
  FEEDS.map((f, i) => [f.code, f.area, f.name, f.source, f.feedsInto, f.record, scheduleName[f.schedule], f.owner, f.hasAmount, f.files, i + 1]));
write('rule.csv', ['rule_id', 'rule_name', 'feed_code', 'quality_dimension', 'unit', 'is_load_check', 'warn_above_pct', 'fail_above_pct', 'warn_late_mins', 'fail_late_mins', 'active_from', 'problem'],
  RULES.map((r) => [r[0], r[2], r[1], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11]]));
write('feed_run.csv', ['date', 'feed_code', 'source_rows', 'warehouse_rows', 'source_value', 'warehouse_value', 'files_expected', 'files_received', 'arrival_time'],
  loads.map((l) => [l.day.iso, l.f.code, l.src, l.wh, l.srcAmt, l.whAmt, l.files, l.recv, l.raw]));
write('check_result.csv', ['date', 'rule_id', 'feed_code', 'run_seq', 'units_checked', 'units_failed', 'minutes_late'],
  results.map((r) => [r.day.iso, r.id, r.feed, r.seq, r.checked, r.failed, r.late]));
write('issue_log.csv', ['issue_id', 'opened', 'resolved', 'feed_code', 'category', 'severity', 'owner', 'status'],
  issues.map((x) => [x.id, x.opened, x.resolved, x.feed, x.cat, x.sev, feedByCode[x.feed].owner, x.status]));

// ---------------------------------------------------------------- check summary
// Every verdict worked out the way the model does: latest run_seq, thresholds from the rule table,
// load checks deciding the status of a data area.
const ruleById = Object.fromEntries(RULES.map((r) => [r[0], r]));
const latest = {};
for (const r of results) { const k = `${r.id}|${r.day.iso}`; if (!latest[k] || r.seq > latest[k].seq) latest[k] = r; }
const checks = Object.values(latest);
function rank(c) { // 0 pass, 1 warning, 2 fail
  const r = ruleById[c.id];
  if (r[3] === 'Timeliness') return c.failed > 0 || c.late > r[9] ? 2 : c.late > r[8] ? 1 : 0;
  const rate = c.checked ? (100 * c.failed) / c.checked : 0;
  return rate > r[7] ? 2 : rate > r[6] ? 1 : 0;
}
const STATUS = ['Ready', 'Use with care', 'Not ready'];
const areaRank = (code, iso) => {
  const load = checks.filter((c) => c.feed === code && c.day.iso === iso && ruleById[c.id][5]);
  return load.length ? Math.max(...load.map(rank)) : null;
};
const fmt = (n) => n.toLocaleString('en-GB');
console.log(`Seed ${SEED}. ${loads.length} loads, ${results.length} rule results (${checks.length} after keeping the latest run), ${issues.length} issues.`);

console.log(`\nLast load, ${LAST_LOAD}`);
for (const f of FEEDS) {
  const l = loadOf[`${f.code}|${LAST_LOAD}`];
  const notes = checks.filter((c) => c.feed === f.code && c.day.iso === LAST_LOAD && !ruleById[c.id][5] && rank(c) > 0)
    .map((c) => `${c.id} ${fmt(c.failed)} ${ruleById[c.id][11]}`);
  console.log(`  ${f.area.padEnd(18)} ${STATUS[areaRank(f.code, LAST_LOAD)].padEnd(14)} rows ${fmt(l.src)} / ${fmt(l.wh)}` +
    (f.hasAmount ? `, value ${fmt(l.srcAmt)} / ${fmt(l.whAmt)}` : '') + `, files ${l.recv} of ${l.files}, ${hhmm(l.arrive)}` + (notes.length ? `  [${notes.join('; ')}]` : ''));
}
const lastChecks = checks.filter((c) => c.day.iso === LAST_LOAD);
const byRank = (k) => lastChecks.filter((c) => rank(c) === k).length;
console.log(`  rules: ${lastChecks.length} run, ${byRank(0)} passed, ${byRank(1)} with a warning, ${byRank(2)} failed;` +
  ` failing: ${lastChecks.filter((c) => rank(c) === 2).map((c) => c.id).join(' ')}`);
const lastLoads = loads.filter((l) => l.day.iso === LAST_LOAD);
const srcRows = lastLoads.reduce((s, l) => s + l.src, 0), diffRows = lastLoads.reduce((s, l) => s + Math.abs(l.src - l.wh), 0);
console.log(`  ${fmt(srcRows)} rows compared, ${(100 * (1 - diffRows / srcRows)).toFixed(2)}% matched`);

console.log('\nStatus by night, last 14 loads (R ready, C use with care, N not ready, - no load)');
const last14 = LOAD_DAYS.slice(-14);
for (const f of FEEDS) {
  console.log(`  ${f.area.padEnd(18)} ${last14.map((d) => { const k = areaRank(f.code, d.iso); return k === null ? '-' : 'RCN'[k]; }).join(' ')}`);
}

const win30 = new Set(LOAD_DAYS.slice(-30).map((d) => d.iso));
const dims = {};
for (const c of checks.filter((x) => win30.has(x.day.iso))) {
  const d = ruleById[c.id][3];
  dims[d] = dims[d] || { n: 0, ok: 0 };
  dims[d].n++;
  if (rank(c) === 0) dims[d].ok++;
}
console.log('\nChecks passed by quality dimension, last 30 nights');
for (const [d, v] of Object.entries(dims).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n)) console.log(`  ${d.padEnd(13)} ${((100 * v.ok) / v.n).toFixed(1)}% (${v.ok} of ${v.n})`);
const loads14 = loads.filter((l) => l.day.iso === '2026-06-14');
console.log(`  14 Jun: ${(100 * (1 - loads14.reduce((s, l) => s + Math.abs(l.src - l.wh), 0) / loads14.reduce((s, l) => s + l.src, 0))).toFixed(2)}% of rows matched`);

const openOn = (iso) => issues.filter((x) => x.opened <= iso && (!x.resolved || x.resolved > iso));
const open = openOn(LAST_LOAD);
const ages = open.map((x) => (Date.parse(LAST_LOAD) - Date.parse(x.opened)) / 86400000).sort((a, b) => a - b);
const oldest = open.reduce((a, b) => (a.opened < b.opened ? a : b));
const ttr = issues.filter((x) => x.resolved && x.resolved >= addDays(LAST_LOAD, -27) && x.resolved <= LAST_LOAD && x.resolved >= x.opened);
console.log('\nIssues');
console.log(`  open ${open.length}: ${['Critical', 'High', 'Medium', 'Low'].map((s) => `${open.filter((x) => x.sev === s).length} ${s.toLowerCase()}`).join(', ')};` +
  ` ${open.filter((x) => x.feed === 'EDI').length} on supplier invoices; ${openOn(addDays(LAST_LOAD, -7)).length} open a week earlier`);
console.log(`  oldest ${oldest.id} (${ages[ages.length - 1]} days), median age ${(ages[6] + ages[7]) / 2} days`);
console.log(`  last 7 nights: ${issues.filter((x) => x.opened > addDays(LAST_LOAD, -7)).length} opened, ${issues.filter((x) => x.resolved && x.resolved > addDays(LAST_LOAD, -7) && x.resolved <= LAST_LOAD).length} resolved`);
console.log(`  average days to resolve, last 28 nights: ${(ttr.reduce((s, x) => s + (Date.parse(x.resolved) - Date.parse(x.opened)) / 86400000, 0) / ttr.length).toFixed(1)} over ${ttr.length} issues`);
console.log(`  ids ${issues[0].id} to ${issues[issues.length - 1].id}`);

console.log('\nData problems');
console.log(`  no load scheduled: finance ledger ${LOAD_DAYS.filter((d) => !runsOn(feedByCode.GL, d)).length} nights, supplier invoices ${LOAD_DAYS.filter((d) => !runsOn(feedByCode.EDI, d)).length}`);
console.log(`  14 Jun store sales checks written twice: ${results.filter((r) => r.feed === 'POS' && r.day.iso === '2026-06-14').length} rows for ${checks.filter((c) => c.feed === 'POS' && c.day.iso === '2026-06-14').length} checks`);
console.log(`  R-021 first run on ${results.find((r) => r.id === 'R-021').day.iso}`);
console.log(`  DepotTrack arrival times in ${new Set(loads.filter((l) => l.f.code === 'LOG').map((l) => l.raw.length)).size} formats`);
const slip = issues.find((x) => x.resolved && x.resolved < x.opened);
console.log(`  ${slip.id} resolved ${slip.resolved}, before it was opened on ${slip.opened}`);
console.log(`  loads with no value to reconcile: ${loads.filter((l) => l.srcAmt === null).length}`);
