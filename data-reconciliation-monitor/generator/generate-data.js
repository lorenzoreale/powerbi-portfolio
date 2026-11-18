'use strict';
// Writes the monitoring tables and the issue log export in ../data.
// Run with: node generate-data.js
// The files hold measurements about the data, never a status: the model works every status out
// from these figures and the thresholds in the rulebook, and so does the summary at the end.

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
const jitter = (spread) => 1 + (rand() - 0.5) * spread;

// 90 nights, the last load on Friday 30 October 2026.
const FIRST_LOAD = '2026-08-02';
const LAST_LOAD = '2026-10-30';
const DAYS = [];
for (let t = Date.parse(FIRST_LOAD); t <= Date.parse(LAST_LOAD); t += 86400000) {
  const d = new Date(t);
  DAYS.push({ iso: d.toISOString().slice(0, 10), dow: d.getUTCDay(), idx: DAYS.length });
}
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// base: typical rows a night, avgVal: average value of a row in pounds, wd: volume by weekday (Sun to Sat),
// arrive: usual arrival in minutes after midnight. The deadline is 05:00, minute 300.
const FEEDS = [
  { code: 'POS', area: 'Store sales', name: 'POS transactions', source: 'Storeline POS', feedsInto: 'Sales, margin and stock', record: 'transactions',
    schedule: 'daily', owner: 'L. Prentice', hasValue: true, files: 4, base: 2300000, avgVal: 7.64, wd: [1.05, 0.98, 0.94, 0.96, 1.0, 1.12, 1.25], arrive: 232 },
  { code: 'ECOM', area: 'Online orders', name: 'E-commerce orders', source: 'Webshop', feedsInto: 'Online sales and returns', record: 'orders',
    schedule: 'daily', owner: 'L. Prentice', hasValue: true, files: 1, base: 141000, avgVal: 7.08, wd: [1.05, 1.08, 1.0, 0.98, 0.99, 1.02, 0.92], arrive: 251 },
  { code: 'GL', area: 'Finance ledger', name: 'ERP GL journal', source: 'Ledger ERP', feedsInto: 'Management accounts', record: 'journal lines',
    schedule: 'weekdays', owner: 'J. Meads', hasValue: true, files: 1, base: 91000, avgVal: 444.0, wd: [0, 1.0, 1.0, 1.0, 1.0, 1.05, 0], arrive: 155 },
  { code: 'EDI', area: 'Supplier invoices', name: 'Supplier EDI invoices', source: 'EDI gateway', feedsInto: 'Accounts payable and supplier spend', record: 'invoices',
    schedule: 'monsat', owner: 'D. Okafor', hasValue: true, files: 3, base: 8700, avgVal: 178.3, wd: [0, 1.15, 1.0, 0.98, 0.97, 1.02, 0.9], arrive: 272 },
  { code: 'LOG', area: 'Deliveries', name: 'Logistics shipments', source: 'DepotTrack', feedsInto: 'Logistics and availability', record: 'shipments',
    schedule: 'daily', owner: 'S. Varga', hasValue: false, files: 2, base: 29500, avgVal: 0, wd: [0.72, 1.06, 1.04, 1.02, 1.03, 1.05, 0.95], arrive: 282 },
  { code: 'LOY', area: 'Loyalty members', name: 'Loyalty members', source: 'Loyalty CRM', feedsInto: 'Customer and marketing', record: 'members',
    schedule: 'daily', owner: 'S. Varga', hasValue: false, files: 1, arrive: 202 },
  { code: 'PRD', area: 'Products', name: 'Product master', source: 'Ledger ERP', feedsInto: 'All product reporting', record: 'products',
    schedule: 'daily', owner: 'J. Meads', hasValue: false, files: 1, arrive: 172 },
  { code: 'STO', area: 'Stores', name: 'Store master', source: 'Ledger ERP', feedsInto: 'All store reporting', record: 'stores',
    schedule: 'daily', owner: 'J. Meads', hasValue: false, files: 1, arrive: 174 },
];
const feedByCode = Object.fromEntries(FEEDS.map((f) => [f.code, f]));
// The ledger does not load at weekends, supplier invoices not on Sundays.
const runsOn = (f, d) => (f.schedule === 'daily' ? true : f.schedule === 'weekdays' ? d.dow >= 1 && d.dow <= 5 : d.dow >= 1);

// [id, area, name, dimension, unit, load check, warn above %, fail above %, warn late mins, fail late mins, active from, what fails]
const RULES = [
  ['R-001', 'POS', 'Row count against source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-002', 'POS', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-003', 'POS', 'Basket total equals line sum', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'Basket total differs from its lines'],
  ['R-004', 'POS', 'Sales value against source', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-005', 'POS', 'Transaction line id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate transaction line'],
  ['R-006', 'POS', 'Store code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown store code'],
  ['R-007', 'ECOM', 'Order line id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate order line'],
  ['R-008', 'ECOM', 'Customer id present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'Order with no customer id'],
  ['R-009', 'ECOM', 'Row count against source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-010', 'GL', 'Row count against source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-011', 'GL', 'Debits equal credits', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'Journal out of balance'],
  ['R-012', 'GL', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-013', 'LOY', 'Row count against source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-014', 'LOY', 'Email format valid', 'Validity', 'rows', false, 0.25, 1.0, null, null, null, 'Invalid email'],
  ['R-015', 'LOY', 'Member id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate member id'],
  ['R-016', 'ECOM', 'Order value against source', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-017', 'EDI', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-018', 'EDI', 'Invoice number unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate invoice number'],
  ['R-019', 'EDI', 'Invoice count against manifest', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-020', 'EDI', 'Supplier code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown supplier code'],
  ['R-021', 'PRD', 'Barcode unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, '2026-09-15', 'Duplicate barcode'],
  ['R-022', 'EDI', 'Invoice value against manifest', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-023', 'ECOM', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-024', 'GL', 'Journal line id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate journal line'],
  ['R-025', 'GL', 'Account code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown account code'],
  ['R-026', 'GL', 'Journal value against source', 'Consistency', 'pounds', true, 0, 0.05, null, null, null, ''],
  ['R-027', 'LOG', 'Row count against source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-028', 'LOG', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-029', 'LOG', 'Shipment id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate shipment'],
  ['R-030', 'LOG', 'Depot code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown depot'],
  ['R-031', 'LOG', 'Status changes in order', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'Impossible status change'],
  ['R-032', 'LOY', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-033', 'LOY', 'Mandatory member fields present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'Member missing a mandatory field'],
  ['R-034', 'LOY', 'Join date not in the future', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'Join date in the future'],
  ['R-035', 'PRD', 'Row count against source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-036', 'PRD', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-037', 'PRD', 'Product key unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate product key'],
  ['R-038', 'PRD', 'Category reference valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown category'],
  ['R-039', 'PRD', 'Unit price not negative', 'Consistency', 'rows', false, 0, 0.5, null, null, null, 'Negative price'],
  ['R-040', 'STO', 'Row count against source', 'Completeness', 'rows', true, 0, 0.5, null, null, null, ''],
  ['R-041', 'STO', 'Files arrived by 05:00', 'Timeliness', 'files', true, null, null, 0, 60, null, ''],
  ['R-042', 'STO', 'Store id unique', 'Uniqueness', 'rows', false, 0, 0.05, null, null, null, 'Duplicate store id'],
  ['R-043', 'STO', 'Postcode format valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Invalid postcode'],
  ['R-044', 'STO', 'Region reference valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown region'],
  ['R-045', 'ECOM', 'Currency code valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown currency'],
  ['R-046', 'ECOM', 'Order status valid', 'Validity', 'rows', false, 0, 0.5, null, null, null, 'Unknown order status'],
  ['R-047', 'EDI', 'Mandatory invoice fields present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'Invoice missing a mandatory field'],
  ['R-048', 'POS', 'Basket id present', 'Completeness', 'rows', false, 0, 0.5, null, null, null, 'Transaction with no basket id'],
];
const rulesOf = (code) => RULES.filter((r) => r[1] === code);
const ROW_COUNT_RULES = new Set(RULES.filter((r) => r[5] && r[4] === 'rows').map((r) => r[0]));

// The last load, area by area.
const LAST = {
  POS: { src: 2608417, wh: 2608417, srcAmt: 19927306, whAmt: 19927306, arrive: 229, recv: 4 },
  ECOM: { src: 145912, wh: 145909, srcAmt: 1033084, whAmt: 1032672, arrive: 288, recv: 1 },
  GL: { src: 96410, wh: 96410, srcAmt: 42806114, whAmt: 42806114, arrive: 161, recv: 1 },
  EDI: { src: 8940, wh: 7736, srcAmt: 1594208, whAmt: 1379600, arrive: 341, recv: 2 },
  LOG: { src: 31254, wh: 31254, arrive: 286, recv: 2 },
  LOY: { src: 1872455, wh: 1872455, arrive: 205, recv: 1 },
  PRD: { src: 84312, wh: 84312, arrive: 168, recv: 1 },
  STO: { src: 642, wh: 642, arrive: 171, recv: 1 },
};
// Earlier nights when the warehouse fell short of the source.
const SHORTFALL = {
  POS: { '2026-10-15': { dRows: 50040, dAmt: 382306 } },
  EDI: { '2026-10-23': { dRows: 287, dAmt: 51326 }, '2026-10-26': { dRows: 0, dAmt: 470 } },
  ECOM: { '2026-10-28': { dRows: 1, dAmt: 139 }, '2026-10-29': { dRows: 2, dAmt: 260 } },
};
const EDI_23 = { src: 9124, srcAmt: 1631540 };
const LATE = {
  EDI: { '2026-08-05': 309, '2026-08-22': 318, '2026-09-07': 306, '2026-09-19': 322, '2026-10-02': 311,
    '2026-10-05': 312, '2026-10-09': 317, '2026-10-12': 305, '2026-10-19': 326, '2026-10-27': 314 },
  LOG: { '2026-08-29': 313, '2026-10-06': 311, '2026-10-25': 320 },
  GL: { '2026-08-10': 310 },
};
// Records failing a quality rule on given nights.
const RULE_EVENTS = {
  'R-008': { '2026-10-30': 214 },
  'R-021': { '2026-10-29': 14, '2026-10-30': 14 },
  'R-015': { '2026-09-12': 82, '2026-10-27': 374 },
  'R-007': { '2026-10-24': 18 },
};
// Invalid emails: a low background rate that crosses the 0.25% warning line on 28 October.
const R014_RATE = (iso) => (iso === '2026-10-29' ? 0.0047 : iso === '2026-10-28' ? 0.0031 : 0.0018 + rand() * 0.0006);
const R014_LAST = 12480;

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// DepotTrack writes its arrival time three ways: 05:41, 05:41:22 and 5:41.
const rawArrival = (code, m, idx) => {
  if (code !== 'LOG' || idx % 3 === 0) return hhmm(m);
  if (idx % 3 === 1) return `${hhmm(m)}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
// Members and products are full snapshots every night, so they are walked back from the last load.
function walkBack(lastValue, nights, step) {
  const values = [lastValue];
  for (let i = 1; i < nights; i++) values.unshift(values[0] - step());
  return values;
}
const members = walkBack(LAST.LOY.src, DAYS.length, () => 280 + Math.floor(rand() * 130));
const products = walkBack(LAST.PRD.src, DAYS.length, () => Math.floor(rand() * 13));

const loads = [];
for (const day of DAYS) {
  for (const f of FEEDS) {
    if (!runsOn(f, day)) continue;
    let src, srcAmt = null;
    if (f.code === 'LOY') src = members[day.idx];
    else if (f.code === 'PRD') src = products[day.idx];
    else if (f.code === 'STO') src = day.iso < '2026-09-15' ? 641 : 642;
    else {
      const growth = 1 + 0.0011 * (day.idx / 7);
      src = Math.round(f.base * f.wd[day.dow] * growth * jitter(0.05));
      srcAmt = Math.round(src * f.avgVal * jitter(0.012));
    }
    if (f.code === 'EDI' && day.iso === '2026-10-23') { src = EDI_23.src; srcAmt = EDI_23.srcAmt; }
    let wh = src, whAmt = srcAmt;
    const short = (SHORTFALL[f.code] || {})[day.iso];
    if (short) { wh = src - short.dRows; if (srcAmt !== null) whAmt = srcAmt - short.dAmt; }
    let arrive = Math.round(f.arrive + (rand() - 0.5) * 24);
    if ((LATE[f.code] || {})[day.iso]) arrive = LATE[f.code][day.iso];
    let recv = f.files;
    if (day.iso === LAST_LOAD) {
      const a = LAST[f.code];
      src = a.src; wh = a.wh; arrive = a.arrive; recv = a.recv;
      if (f.hasValue) { srcAmt = a.srcAmt; whAmt = a.whAmt; }
    }
    // Four areas carry no money, so their value is left empty.
    if (!f.hasValue) { srcAmt = null; whAmt = null; }
    loads.push({ day, f, src, wh, srcAmt, whAmt, files: f.files, recv, arrive, raw: rawArrival(f.code, arrive, day.idx) });
  }
}
const loadOf = Object.fromEntries(loads.map((l) => [`${l.f.code}|${l.day.iso}`, l]));

const results = [];
for (const day of DAYS) {
  for (const f of FEEDS) {
    const load = loadOf[`${f.code}|${day.iso}`];
    if (!load) continue;
    for (const [id, , , dim, unit, , , , , , activeFrom] of rulesOf(f.code)) {
      // R-021 joined the rulebook part-way through the window.
      if (activeFrom && day.iso < activeFrom) continue;
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
// The store sales checks of 15 October were written twice: a first run that understated the
// shortfall, then the rerun with the true figures.
for (const r of results.filter((x) => x.feed === 'POS' && x.day.iso === '2026-10-15')) {
  const first = { ...r, seq: 1 };
  if (r.id === 'R-001') first.failed = 49900;
  if (r.id === 'R-004') first.failed = 381236;
  r.seq = 2;
  results.push(first);
}
results.sort((a, b) => a.day.iso.localeCompare(b.day.iso) || a.id.localeCompare(b.id) || a.seq - b.seq);

// Issues open at the last load: [opened, area, category, severity, where it stands]
const OPEN = [
  ['2026-10-21', 'PRD', 'Schema change', 'Critical', 'Change raised with the ERP team'],
  ['2026-10-22', 'EDI', 'Late arrival', 'High', 'Monitoring since the gateway change'],
  ['2026-10-23', 'EDI', 'Rows missing', 'Critical', 'Waiting on the supplier to resend'],
  ['2026-10-23', 'GL', 'Schema change', 'High', 'Loader change for the new extract column in test'],
  ['2026-10-24', 'ECOM', 'Duplicate records', 'High', 'Fix in code review'],
  ['2026-10-26', 'EDI', 'Value difference', 'Medium', 'Investigating a small recurring difference'],
  ['2026-10-27', 'EDI', 'Late arrival', 'Medium', 'Supplier upload window under review'],
  ['2026-10-27', 'LOY', 'Duplicate records', 'Low', 'Fix scheduled for 2 November'],
  ['2026-10-28', 'ECOM', 'Rows missing', 'Low', 'Linked to the refund timing issue'],
  ['2026-10-28', 'LOY', 'Rule breach', 'Medium', 'Invalid emails rising, sign-up form under investigation'],
  ['2026-10-29', 'ECOM', 'Value difference', 'Medium', 'Refunds posted after the extract closes, fix agreed'],
  ['2026-10-29', 'POS', 'Schema change', 'High', 'New till software field under review'],
  ['2026-10-29', 'PRD', 'Duplicate records', 'Medium', 'Duplicate barcodes traced to a catalogue upload'],
  ['2026-10-30', 'EDI', 'Missing file', 'Critical', 'Waiting on the supplier to resend file 2'],
];
// Resolved in the last week: [opened, days to resolve, area, category, severity]
const RECENT = [
  ['2026-10-21', 3, 'EDI', 'Late arrival', 'Low'], ['2026-10-21', 4, 'POS', 'Value difference', 'Medium'],
  ['2026-10-22', 2, 'LOG', 'Late arrival', 'Low'], ['2026-10-22', 3, 'ECOM', 'Rows missing', 'Medium'],
  ['2026-10-22', 4, 'LOY', 'Duplicate records', 'Low'], ['2026-10-23', 1, 'GL', 'Late arrival', 'Low'],
  ['2026-10-23', 2, 'EDI', 'Rows missing', 'High'], ['2026-10-23', 3, 'PRD', 'Duplicate records', 'Low'],
  ['2026-10-23', 4, 'EDI', 'Value difference', 'Medium'],
];
const CATEGORIES = ['Late arrival', 'Rows missing', 'Value difference', 'Duplicate records', 'Missing file', 'Schema change'];
const CATEGORY_WEIGHTS = [0.3, 0.22, 0.18, 0.14, 0.1, 0.06];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const SEVERITY_WEIGHTS = [0.42, 0.34, 0.18, 0.06];
const AREA_WEIGHTS = [['EDI', 0.3], ['ECOM', 0.2], ['LOY', 0.12], ['POS', 0.12], ['LOG', 0.1], ['GL', 0.06], ['PRD', 0.06], ['STO', 0.04]];
const pick = (items, weights) => {
  const r = rand();
  let acc = 0;
  for (let i = 0; i < items.length; i++) { acc += weights[i]; if (r < acc) return items[i]; }
  return items[items.length - 1];
};
// Earlier history: 44 issues opened and resolved up to 20 October, plus the store sales incident.
const history = [];
{
  const last = DAYS.findIndex((d) => d.iso === '2026-10-20');
  let acc = 0;
  for (let i = 0; i <= last; i++) {
    acc += 44 / (last + 1);
    while (acc >= 1) {
      acc -= 1;
      const opened = DAYS[i].iso;
      const area = pick(AREA_WEIGHTS.map((x) => x[0]), AREA_WEIGHTS.map((x) => x[1]));
      const days = [0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6][Math.floor(rand() * 15)];
      let resolved = addDays(opened, days);
      if (resolved > '2026-10-23') resolved = '2026-10-23';
      history.push({ opened, resolved, area, cat: pick(CATEGORIES, CATEGORY_WEIGHTS), sev: pick(SEVERITIES, SEVERITY_WEIGHTS), status: 'Resolved' });
    }
  }
  history.push({ opened: '2026-10-15', resolved: '2026-10-16', area: 'POS', cat: 'Rows missing', sev: 'Critical', status: 'Resolved' });
  // A slip in the ticketing tool: one issue closed two days before it was opened.
  history[19].opened = '2026-09-12';
  history[19].resolved = '2026-09-10';
}
const issues = [
  ...history,
  ...RECENT.map(([opened, days, area, cat, sev]) => ({ opened, resolved: addDays(opened, days), area, cat, sev, status: 'Resolved' })),
  ...OPEN.map(([opened, area, cat, sev, status]) => ({ opened, resolved: null, area, cat, sev, status })),
];
issues.sort((a, b) => a.opened.localeCompare(b.opened) || (a.resolved ? 0 : 1) - (b.resolved ? 0 : 1));
issues.forEach((x, i) => { x.id = `ISS-${String(126 + i).padStart(4, '0')}`; });

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const esc = (x) => { const s = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const write = (file, header, rows) => fs.writeFileSync(path.join(dataDir, file), [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n', 'utf8');
const scheduleName = { daily: 'Every night', weekdays: 'Monday to Friday', monsat: 'Monday to Saturday' };
const bit = (b) => (b ? 1 : 0);

write('feed.csv', ['feed_code', 'data_area', 'feed_name', 'source_system', 'feeds_into', 'record_name', 'schedule', 'owner', 'has_value', 'files_expected', 'sort_order'],
  FEEDS.map((f, i) => [f.code, f.area, f.name, f.source, f.feedsInto, f.record, scheduleName[f.schedule], f.owner, bit(f.hasValue), f.files, i + 1]));
write('rule.csv', ['rule_id', 'feed_code', 'rule_name', 'quality_dimension', 'unit', 'is_load_check', 'warn_above_pct', 'fail_above_pct', 'warn_late_mins', 'fail_late_mins', 'active_from', 'failing_record'],
  RULES.map((r) => [r[0], r[1], r[2], r[3], r[4], bit(r[5]), r[6], r[7], r[8], r[9], r[10], r[11]]));
write('feed_run.csv', ['run_date', 'feed_code', 'source_rows', 'warehouse_rows', 'source_value', 'warehouse_value', 'files_expected', 'files_received', 'arrival_time'],
  loads.map((l) => [l.day.iso, l.f.code, l.src, l.wh, l.srcAmt, l.whAmt, l.files, l.recv, l.raw]));
write('check_result.csv', ['run_date', 'rule_id', 'feed_code', 'run_seq', 'units_checked', 'units_failed', 'minutes_late'],
  results.map((r) => [r.day.iso, r.id, r.feed, r.seq, r.checked, r.failed, r.late]));
write('issue_log.csv', ['issue_id', 'opened', 'resolved', 'feed_code', 'category', 'severity', 'owner', 'status'],
  issues.map((x) => [x.id, x.opened, x.resolved, x.area, x.cat, x.sev, feedByCode[x.area].owner, x.status]));

// Summary: every status worked out the way the model does, from the latest run of each check.
const ruleById = Object.fromEntries(RULES.map((r) => [r[0], r]));
const latest = {};
for (const r of results) { const k = `${r.id}|${r.day.iso}`; if (!latest[k] || r.seq > latest[k].seq) latest[k] = r; }
const checks = Object.values(latest);
function rank(c) {
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
console.log(`Seed ${SEED}. ${loads.length} loads, ${results.length} check results (${checks.length} after the rerun), ${issues.length} issues.`);

console.log(`\nLast load, ${LAST_LOAD}`);
for (const f of FEEDS) {
  const l = loadOf[`${f.code}|${LAST_LOAD}`];
  const notes = checks.filter((c) => c.feed === f.code && c.day.iso === LAST_LOAD && !ruleById[c.id][5] && rank(c) > 0).map((c) => `${c.id} ${fmt(c.failed)}`);
  console.log(`  ${f.area.padEnd(18)} ${STATUS[areaRank(f.code, LAST_LOAD)].padEnd(14)} rows ${fmt(l.src)} / ${fmt(l.wh)}` +
    (f.hasValue ? `, value ${fmt(l.srcAmt)} / ${fmt(l.whAmt)}` : '') + `, files ${l.recv} of ${l.files}, ${hhmm(l.arrive)}` + (notes.length ? `  [${notes.join('; ')}]` : ''));
}
const lastChecks = checks.filter((c) => c.day.iso === LAST_LOAD);
const byRank = (k) => lastChecks.filter((c) => rank(c) === k).length;
console.log(`  checks: ${lastChecks.length} run, ${byRank(0)} passed, ${byRank(1)} warning, ${byRank(2)} failed: ${lastChecks.filter((c) => rank(c) === 2).map((c) => c.id).join(' ')}`);

console.log('\nLast 14 nights (R ready, C use with care, N not ready, - no load)');
const last14 = DAYS.slice(-14);
console.log(`  ${''.padEnd(18)} ${last14.map((d) => d.iso.slice(8)).join(' ')}`);
for (const f of FEEDS) {
  console.log(`  ${f.area.padEnd(18)} ${last14.map((d) => { const k = areaRank(f.code, d.iso); return (k === null ? '-' : 'RCN'[k]).padStart(2); }).join(' ')}`);
}

const win30 = new Set(DAYS.slice(-30).map((d) => d.iso));
const dims = {};
for (const c of checks.filter((x) => win30.has(x.day.iso))) {
  const d = ruleById[c.id][3];
  dims[d] = dims[d] || { n: 0, bad: 0 };
  dims[d].n++;
  if (rank(c) > 0) dims[d].bad++;
}
console.log('\nChecks with a warning or a failure by dimension, last 30 nights');
for (const [d, v] of Object.entries(dims).sort((a, b) => b[1].bad / b[1].n - a[1].bad / a[1].n)) console.log(`  ${d.padEnd(13)} ${((100 * v.bad) / v.n).toFixed(1)}% (${v.bad} of ${v.n})`);

const openOn = (iso) => issues.filter((x) => x.opened <= iso && (!x.resolved || x.resolved > iso));
const open = openOn(LAST_LOAD);
const ageOf = (x) => (Date.parse(LAST_LOAD) - Date.parse(x.opened)) / 86400000;
const ttr = issues.filter((x) => x.resolved && x.resolved > addDays(LAST_LOAD, -28) && x.resolved <= LAST_LOAD && x.resolved >= x.opened);
console.log('\nIssues');
console.log(`  open ${open.length}: ${SEVERITIES.slice().reverse().map((s) => `${open.filter((x) => x.sev === s).length} ${s.toLowerCase()}`).join(', ')};` +
  ` ${open.filter((x) => x.area === 'EDI').length} on supplier invoices; ${openOn(addDays(LAST_LOAD, -28)).length} open four weeks earlier`);
console.log(`  oldest open ${Math.max(...open.map(ageOf))} days`);
console.log(`  last 7 nights: ${issues.filter((x) => x.opened > addDays(LAST_LOAD, -7) && x.opened <= LAST_LOAD).length} opened, ` +
  `${issues.filter((x) => x.resolved && x.resolved > addDays(LAST_LOAD, -7) && x.resolved <= LAST_LOAD && x.resolved >= x.opened).length} resolved`);
console.log(`  days to resolve, last 28 nights: ${(ttr.reduce((s, x) => s + (Date.parse(x.resolved) - Date.parse(x.opened)) / 86400000, 0) / ttr.length).toFixed(2)} over ${ttr.length} issues`);

console.log('\nPlanted problems');
console.log(`  no load scheduled: finance ledger ${DAYS.filter((d) => !runsOn(feedByCode.GL, d)).length} nights, supplier invoices ${DAYS.filter((d) => !runsOn(feedByCode.EDI, d)).length}`);
console.log(`  store sales checks of 15 Oct written twice: ${results.filter((r) => r.feed === 'POS' && r.day.iso === '2026-10-15').length} rows for ${checks.filter((c) => c.feed === 'POS' && c.day.iso === '2026-10-15').length} checks`);
console.log(`  R-021 first ran on ${results.find((r) => r.id === 'R-021').day.iso}`);
console.log(`  DepotTrack arrival times: ${loads.filter((l) => l.f.code === 'LOG' && l.raw.length !== 5).length} of ${loads.filter((l) => l.f.code === 'LOG').length} not written as HH:MM`);
const slip = issues.find((x) => x.resolved && x.resolved < x.opened);
console.log(`  ${slip.id} resolved ${slip.resolved}, before it was opened on ${slip.opened}`);
console.log(`  loads with no value to reconcile: ${loads.filter((l) => l.srcAmt === null).length}`);
