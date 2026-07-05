'use strict';
// Deterministic mock data generator for the Month-End Management Pack.
// Ground truth for shapes and volumes: docs/spec-month-end.md.
// Run: node generate-data.js  (writes CSVs to ../data and prints a verification summary)
//
// Core convention (spec section 3): every Amount is a signed profit contribution -
// revenue positive, all costs negative - so SUM(Amount) is profit at any level and
// Variance = Actual - Budget carries the favourable/unfavourable sign for every line.
// Amounts are emitted in whole pounds; the report formats to GBP thousands.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- randomness
const SEED = 20260630;
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
const MONTHS = [];
for (let y = 2025; y <= 2026; y++)
  for (let m = 1; m <= 12; m++)
    if (y === 2025 || m <= 6) {
      const key = y * 100 + m;
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) + ' ' + y;
      MONTHS.push({ y, m, key, label, start: `${y}-${String(m).padStart(2, '0')}-01`,
        quarter: 'Q' + Math.ceil(m / 3), fp: 'P' + String(m).padStart(2, '0') + ' ' + y, idx: MONTHS.length });
    }
const JUNE = MONTHS[MONTHS.length - 1]; // Jun 2026, the current month

// ---------------------------------------------------------------- dimensions
const SCENARIOS = ['Actual', 'Budget'];

const ENTITIES = [
  ['LLP', 'Ashcombe Partners LLP'],
  ['MSL', 'Ashcombe Managed Services Ltd'],
  ['PRJ', 'Ashcombe Projects Ltd'],
];

const SERVICE_LINES = [
  ['Advisory', true, 'LLP'],
  ['Managed Services', true, 'MSL'],
  ['Projects', true, 'PRJ'],
  ['Support', true, 'LLP'],
  ['Central', false, null],
];
const entityOf = Object.fromEntries(SERVICE_LINES.map((s) => [s[0], s[2]]));

const ACCOUNTS = [
  // code, name, category, sortOrder, isCost
  ['REV-ADV', 'Advisory fees', 'Revenue', 11, false],
  ['REV-MAN', 'Managed services fees', 'Revenue', 12, false],
  ['REV-PRJ', 'Project fees', 'Revenue', 13, false],
  ['REV-SUP', 'Support fees', 'Revenue', 14, false],
  ['DC-STAFF', 'Delivery staff', 'Direct costs', 21, true],
  ['DC-SUBS', 'Subcontractors', 'Direct costs', 22, true],
  ['DC-EXP', 'Recharged expenses', 'Direct costs', 23, true],
  ['OH-ADMIN', 'Admin staff', 'Overheads', 41, true],
  ['OH-PREM', 'Premises', 'Overheads', 42, true],
  ['OH-TECH', 'Technology', 'Overheads', 43, true],
  ['OH-MKT', 'Marketing', 'Overheads', 44, true],
  ['OH-PROF', 'Professional fees', 'Overheads', 45, true],
  ['OH-DEP', 'Depreciation', 'Overheads', 46, true],
  ['OH-OTHER', 'Other admin', 'Overheads', 47, true],
];
const revAccountOf = { Advisory: 'REV-ADV', 'Managed Services': 'REV-MAN', Projects: 'REV-PRJ', Support: 'REV-SUP' };
const DIRECT_SPLIT = [['DC-STAFF', 0.733], ['DC-SUBS', 0.212], ['DC-EXP', 0.055]];

const PL_LINES = [
  [1, 'Revenue', 10, 'group', 'Revenue'],
  [2, 'Advisory fees', 11, 'detail', 'REV-ADV'],
  [3, 'Managed services fees', 12, 'detail', 'REV-MAN'],
  [4, 'Project fees', 13, 'detail', 'REV-PRJ'],
  [5, 'Support fees', 14, 'detail', 'REV-SUP'],
  [6, 'Direct costs', 20, 'group', 'Direct costs'],
  [7, 'Gross profit', 30, 'subtotal', 'GrossProfit'],
  [8, 'Overheads', 40, 'group', 'Overheads'],
  [9, 'Admin staff', 41, 'detail', 'OH-ADMIN'],
  [10, 'Premises', 42, 'detail', 'OH-PREM'],
  [11, 'Technology', 43, 'detail', 'OH-TECH'],
  [12, 'Marketing', 44, 'detail', 'OH-MKT'],
  [13, 'Professional fees', 45, 'detail', 'OH-PROF'],
  [14, 'Depreciation', 46, 'detail', 'OH-DEP'],
  [15, 'Other admin', 47, 'detail', 'OH-OTHER'],
  [16, 'Operating profit', 50, 'subtotal', 'OperatingProfit'],
];

// ---------------------------------------------------------------- June 2026 anchor
// Revenue by service line and client (GBP 000). Per-line sums must equal the
// seeded design figures: Advisory 1,180 / Managed 1,760 / Projects 890 / Support 451.
const REV_ACTUAL = {
  'Managed Services': [['Peverel Group', 640], ['Castleton Retail', 520], ['Trentham Group', 300], ['Nyle Distribution', 180], ['Ashfield Care', 120]],
  Advisory: [['Oakline Foods', 415], ['Bramwell Media', 360], ['Marrow Klein', 235], ['Vantis Retail', 170]],
  Projects: [['Harding & Co', 470], ['Delphi Works', 240], ['Corven Group', 180]],
  Support: [['Kelby Foods', 150], ['Ashfield Care', 110], ['Nyle Distribution', 100], ['Castleton Retail', 91]],
};
const REV_BUDGET_LINE = { Advisory: 1275, 'Managed Services': 1900, Projects: 860, Support: 465 };
// Direct cost as a share of revenue (1 - gross margin), tuned so per-line direct
// totals hit Advisory 684 / Managed 1,038 / Projects 608 / Support 316 (actual)
// and Advisory 727 / Managed 1,102 / Projects 550 / Support 321 (budget).
const DIRECT_RATE_ACTUAL = { Advisory: 684 / 1180, 'Managed Services': 1038 / 1760, Projects: 608 / 890, Support: 316 / 451 };
const DIRECT_RATE_BUDGET = { Advisory: 727 / 1275, 'Managed Services': 1102 / 1900, Projects: 550 / 860, Support: 321 / 465 };

const OVERHEADS = { // account -> [actual000, budget000]
  // W1: Depreciation is not in the budget (budget 0, so no budget row is emitted),
  // yet has an actual. Its 25 sits in Other admin's budget so overheads still total
  // 1,080 and budget operating profit stays 720; only Depreciation's variance is
  // undefined, which the model flags rather than dividing by zero.
  'OH-ADMIN': [560, 520], 'OH-PREM': [180, 175], 'OH-TECH': [145, 150], 'OH-MKT': [60, 90],
  'OH-PROF': [30, 45], 'OH-DEP': [25, 0], 'OH-OTHER': [23, 100],
};
const OH_ENTITY_SPLIT = [['LLP', 0.5], ['MSL', 0.3], ['PRJ', 0.2]];

const CAPACITY = { // service line -> [available, billableActual, billableBudget]
  Advisory: [3200, 2500, 2624], 'Managed Services': [6000, 4500, 4920], Projects: [3000, 2520, 2460], Support: [1800, 1460, 1476],
};

// ---------------------------------------------------------------- build June rows
// row = { scenario, entity, sl, account, client, amt000 }
function buildAnchorRows(scenario) {
  const rows = [];
  const directRate = scenario === 'Actual' ? DIRECT_RATE_ACTUAL : DIRECT_RATE_BUDGET;
  for (const sl of Object.keys(REV_ACTUAL)) {
    const ent = entityOf[sl];
    const actualLine = REV_ACTUAL[sl];
    const lineTotalActual = actualLine.reduce((s, c) => s + c[1], 0);
    const lineRevenue = scenario === 'Actual' ? lineTotalActual : REV_BUDGET_LINE[sl];
    for (const [client, revA] of actualLine) {
      const weight = revA / lineTotalActual;
      const rev = lineRevenue * weight;
      rows.push({ scenario, entity: ent, sl, account: revAccountOf[sl], client, amt000: rev });
      const direct = rev * directRate[sl];
      for (const [acc, share] of DIRECT_SPLIT)
        rows.push({ scenario, entity: ent, sl, account: acc, client, amt000: -direct * share });
    }
  }
  for (const [acc, [actual000, budget000]] of Object.entries(OVERHEADS)) {
    const tot = scenario === 'Actual' ? actual000 : budget000;
    for (const [ent, share] of OH_ENTITY_SPLIT)
      rows.push({ scenario, entity: ent, sl: 'Central', account: acc, client: '', amt000: -tot * share });
  }
  return rows;
}
const anchorActual = buildAnchorRows('Actual');
const anchorBudget = buildAnchorRows('Budget');

// ---------------------------------------------------------------- monthly multipliers
// Budget ramps gently to 1.0 at June 2026; actual = budget shape x performance noise.
function budgetMult(idx) { return idx === JUNE.idx ? 1 : 0.95 + 0.05 * (idx / JUNE.idx) + 0.012 * Math.sin(idx / 2); }
function actualMult(idx) { return idx === JUNE.idx ? 1 : budgetMult(idx) * jitter(0.05); }

// ---------------------------------------------------------------- emit ledger
const DIRTY = [ (n) => n + ' ', (n) => n.toUpperCase(), (n) => n.replace(' ', '  ') ];
const ledger = [];
let dirtyCount = 0;
for (const mo of MONTHS) {
  for (const scenario of SCENARIOS) {
    const anchor = scenario === 'Actual' ? anchorActual : anchorBudget;
    const mult = scenario === 'Actual' ? actualMult(mo.idx) : budgetMult(mo.idx);
    for (const r of anchor) {
      let client = r.client;
      // W3: a scatter of actual revenue rows carry a dirty client name.
      if (scenario === 'Actual' && r.account.startsWith('REV') && dirtyCount < 12 && rand() < 0.06) {
        client = DIRTY[dirtyCount % 3](client); dirtyCount++;
      }
      const amt = Math.round(r.amt000 * mult * 1000);
      if (amt === 0) continue;
      ledger.push([mo.key, scenario, r.entity, r.sl, r.account, client, amt]);
    }
  }
}

// W2: a re-exported late-journal batch duplicates 6 June actual rows verbatim.
const dupSource = ledger.filter((r) => r[0] === JUNE.key && r[1] === 'Actual' && r[4].startsWith('REV')).slice(0, 6);
for (const r of dupSource) ledger.push(r.slice());

// W5: one June actual delivery-staff cost is posted with the wrong (positive) sign.
const wrongSign = ledger.find((r) => r[0] === JUNE.key && r[1] === 'Actual' && r[4] === 'DC-STAFF');
if (wrongSign) wrongSign[6] = Math.abs(wrongSign[6]);

// W6: a handful of tiny sub-pound rounding rows that vanish once shown in thousands.
for (let i = 0; i < 4; i++)
  ledger.push([JUNE.key, 'Actual', 'LLP', 'Central', 'OH-OTHER', '', (rand() < 0.5 ? 1 : -1) * (rand() * 0.6)]);

// ---------------------------------------------------------------- capacity
const capacity = [];
for (const mo of MONTHS)
  for (const scenario of SCENARIOS) {
    const mult = scenario === 'Actual' ? actualMult(mo.idx) : budgetMult(mo.idx);
    for (const [sl, [avail, billA, billB]] of Object.entries(CAPACITY)) {
      const available = Math.round(avail * (scenario === 'Budget' ? budgetMult(mo.idx) : mult));
      const billable = Math.round((scenario === 'Actual' ? billA : billB) * mult);
      capacity.push([mo.key, scenario, sl, billable, available]);
    }
  }

// ---------------------------------------------------------------- clients dimension
const clientLead = {};
for (const sl of Object.keys(REV_ACTUAL)) for (const [c] of REV_ACTUAL[sl]) if (!(c in clientLead)) clientLead[c] = sl;
const CLIENTS = Object.keys(clientLead).map((c) => [c, clientLead[c], 2018 + randInt(0, 7)]);
function randInt(a, b) { return a + Math.floor(rand() * (b - a + 1)); }

// ---------------------------------------------------------------- CSV output
const esc = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file, header, rows) => {
  fs.writeFileSync(file, [header.join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n') + '\n', 'utf8');
  return rows.length;
};
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

writeCsv(path.join(dataDir, 'calendar.csv'), ['month_key', 'month', 'month_start', 'quarter', 'year', 'financial_period'],
  MONTHS.map((m) => [m.key, m.label, m.start, m.quarter, m.y, m.fp]));
writeCsv(path.join(dataDir, 'scenario.csv'), ['scenario'], SCENARIOS.map((s) => [s]));
writeCsv(path.join(dataDir, 'entity.csv'), ['entity_short', 'entity_name'], ENTITIES);
writeCsv(path.join(dataDir, 'service_line.csv'), ['service_line', 'is_client_facing'], SERVICE_LINES.map((s) => [s[0], s[1]]));
writeCsv(path.join(dataDir, 'account.csv'), ['account_code', 'account', 'category', 'sort_order', 'is_cost'], ACCOUNTS);
writeCsv(path.join(dataDir, 'client.csv'), ['client_name', 'lead_service_line', 'client_since'], CLIENTS);
writeCsv(path.join(dataDir, 'pl_line.csv'), ['line_key', 'pl_line', 'sort_order', 'line_type', 'category_filter'], PL_LINES);
writeCsv(path.join(dataDir, 'ledger.csv'), ['month_key', 'scenario', 'entity', 'service_line', 'account_code', 'client', 'amount'], ledger);
writeCsv(path.join(dataDir, 'capacity.csv'), ['month_key', 'scenario', 'service_line', 'billable_hours', 'available_hours'], capacity);

// ---------------------------------------------------------------- verification
// Computed from the clean in-memory model (post-dedupe, sign-corrected) in GBP 000.
const clean = (name) => name.trim().toUpperCase();
const seen = new Set();
const rows000 = [];
for (const r of ledger) {
  const [mk, sc, ent, sl, acc, client, amt] = r;
  const nk = [mk, sc, ent, sl, acc, clean(client)].join('|');
  if (seen.has(nk)) continue;           // W2 dedupe
  seen.add(nk);
  const cat = ACCOUNTS.find((a) => a[0] === acc)[2];
  const isCost = ACCOUNTS.find((a) => a[0] === acc)[4];
  let a = amt / 1000;
  if (isCost) a = -Math.abs(a);          // W5 sign coercion
  rows000.push({ mk, sc, sl, acc, cat, a });
}
const sum = (f) => rows000.filter(f).reduce((s, r) => s + r.a, 0);
const j = (sc, cat) => sum((r) => r.mk === JUNE.key && r.sc === sc && r.cat === cat);
const f1 = (x) => x.toFixed(1);

console.log(`Seed ${SEED} - current month ${JUNE.label}`);
console.log(`rows: ledger ${ledger.length} (incl 6 dup + 4 tiny) - capacity ${capacity.length} - clients ${CLIENTS.length} - months ${MONTHS.length}`);

console.log('\nJune 2026 Group P&L (GBP 000) - Actual / Budget / Variance:');
const revA = j('Actual', 'Revenue'), revB = j('Budget', 'Revenue');
const dcA = j('Actual', 'Direct costs'), dcB = j('Budget', 'Direct costs');
const ohA = j('Actual', 'Overheads'), ohB = j('Budget', 'Overheads');
const gpA = revA + dcA, gpB = revB + dcB, opA = gpA + ohA, opB = gpB + ohB;
const line = (n, a, b) => console.log(`  ${n.padEnd(16)} ${f1(a).padStart(9)} ${f1(b).padStart(9)} ${f1(a - b).padStart(8)}`);
line('Revenue', revA, revB);
line('Direct costs', dcA, dcB);
line('Gross profit', gpA, gpB);
line('Overheads', ohA, ohB);
line('Operating profit', opA, opB);
console.log(`  Gross margin     ${f1(100 * gpA / revA)}% actual / ${f1(100 * gpB / revB)}% budget`);
console.log(`  Operating margin ${f1(100 * opA / revA)}% actual / ${f1(100 * opB / revB)}% budget`);
console.log('  Expected anchors: Revenue 4281/4500, GP 1635/1800, OP 612/720');

console.log('\nJune revenue by service line (Actual / Budget):');
for (const sl of Object.keys(REV_ACTUAL)) {
  const a = sum((r) => r.mk === JUNE.key && r.sc === 'Actual' && r.cat === 'Revenue' && r.sl === sl);
  const b = sum((r) => r.mk === JUNE.key && r.sc === 'Budget' && r.cat === 'Revenue' && r.sl === sl);
  console.log(`  ${sl.padEnd(16)} ${f1(a).padStart(8)} ${f1(b).padStart(8)} ${f1(a - b).padStart(7)}`);
}

const ytd = (sc, cat) => sum((r) => r.sc === sc && r.cat === cat && r.mk >= 202601 && r.mk <= JUNE.key);
const yRevA = ytd('Actual', 'Revenue'), yRevB = ytd('Budget', 'Revenue');
const yOpA = yRevA + ytd('Actual', 'Direct costs') + ytd('Actual', 'Overheads');
const yOpB = yRevB + ytd('Budget', 'Direct costs') + ytd('Budget', 'Overheads');
console.log(`\nYTD 2026 (Jan-Jun): Revenue ${f1(yRevA)}/${f1(yRevB)} - Operating profit ${f1(yOpA)}/${f1(yOpB)}`);

const util = (sc) => {
  const b = capacity.filter((c) => c[0] === JUNE.key && c[1] === sc).reduce((s, c) => s + c[3], 0);
  const av = capacity.filter((c) => c[0] === JUNE.key && c[1] === sc).reduce((s, c) => s + c[4], 0);
  return 100 * b / av;
};
console.log(`Utilisation June: ${f1(util('Actual'))}% actual / ${f1(util('Budget'))}% target`);

const missingBudget = new Set(rows000.filter((r) => r.mk === JUNE.key && r.sc === 'Actual').map((r) => r.acc + '|' + r.sl))
  .size - new Set(rows000.filter((r) => r.mk === JUNE.key && r.sc === 'Budget').map((r) => r.acc + '|' + r.sl)).size;
console.log(`\nWrinkles: W1 missing-budget lines ${missingBudget} (Depreciation) - W2 dup rows ${dupSource.length} - W3 dirty client names ${dirtyCount} - W4 overhead rows have blank client (mapped to Unallocated) - W5 wrong-sign cost 1 - W6 sub-pound rows 4`);
