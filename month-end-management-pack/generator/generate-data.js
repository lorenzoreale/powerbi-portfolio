'use strict';
// Deterministic data generator for the Month-End Management Pack.
// The figures the report has to show are listed in the project README.
// Run: node generate-data.js   (writes CSVs to ../data and prints a check summary)
//
// Every month is built from operating drivers, the way a professional-services
// firm actually earns its money:
//   available hours  = team capacity x working days, less leave
//   billable hours   = available hours x utilisation
//   revenue          = billable hours x average billing rate
//   delivery staff   = available hours x staff cost per hour (paid whether billed or not)
//   subcontractors   = a share of revenue;  recharged expenses = a share of revenue
// The budget is flexed: budget utilisation (82%) and the rate card are applied to
// the actual available hours, so the gap between them is pure utilisation and rate.
//
// Amounts are signed profit contributions in whole pounds: revenue positive, costs
// negative. June 2026, the month of the pack, is pinned to fixed figures.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- randomness
// Embedded PRNG (mulberry32), so the output is identical on every machine.
const SEED = 20260630;
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
const noise = (spread) => 1 + (rand() - 0.5) * spread;

// ---------------------------------------------------------------- calendar
// January 2025 to June 2026. Working days are weekdays less England and Wales bank holidays.
const BANK_HOLIDAYS = new Set([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
]);
const iso = (d) => d.toISOString().slice(0, 10);
function workingDays(y, m) {
  let n = 0;
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !BANK_HOLIDAYS.has(iso(d))) n++;
  }
  return n;
}
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = [];
for (let y = 2025; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === 2026 && m > 6) break;
    MONTHS.push({
      i: MONTHS.length, y, m, key: y * 100 + m,
      label: MONTH_NAMES[m - 1] + ' ' + y,
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      days: workingDays(y, m),
    });
  }
}
const JUNE = MONTHS[MONTHS.length - 1];
const isJune = (mo) => mo.key === JUNE.key;

// ---------------------------------------------------------------- dimensions
const ENTITIES = [['LLP', 'Ashcombe Partners LLP'], ['MSL', 'Ashcombe Managed Services Ltd'], ['PRJ', 'Ashcombe Projects Ltd']];
const LINES = ['Advisory', 'Managed Services', 'Projects', 'Support'];
const ENTITY_OF = { Advisory: 'LLP', 'Managed Services': 'MSL', Projects: 'PRJ', Support: 'LLP' };
const REVENUE_ACCOUNT = { Advisory: 'REV-ADV', 'Managed Services': 'REV-MAN', Projects: 'REV-PRJ', Support: 'REV-SUP' };
const ACCOUNTS = [
  // code, name, category, sort order
  ['REV-ADV', 'Advisory fees', 'Revenue', 11], ['REV-MAN', 'Managed services fees', 'Revenue', 12],
  ['REV-PRJ', 'Project fees', 'Revenue', 13], ['REV-SUP', 'Support fees', 'Revenue', 14],
  ['DC-STAFF', 'Delivery staff', 'Direct costs', 21], ['DC-SUBS', 'Subcontractors', 'Direct costs', 22],
  ['DC-EXP', 'Recharged expenses', 'Direct costs', 23],
  ['OH-ADMIN', 'Admin staff', 'Overheads', 41], ['OH-PREM', 'Premises', 'Overheads', 42],
  ['OH-TECH', 'Technology', 'Overheads', 43], ['OH-MKT', 'Marketing', 'Overheads', 44],
  ['OH-PROF', 'Professional fees', 'Overheads', 45], ['OH-DEP', 'Depreciation', 'Overheads', 46],
  ['OH-OTHER', 'Other admin', 'Overheads', 47],
];

// Clients by service line, with their share of the line's revenue in June 2026 (GBP 000)
// and a margin offset: extra delivery cost as a share of revenue. Oakline Foods and
// Nyle Distribution are the low-margin accounts the Clients page has to surface.
const CLIENTS = {
  'Managed Services': [['Peverel Group', 640, -0.04], ['Castleton Retail', 520, -0.02], ['Trentham Group', 300, -0.01], ['Nyle Distribution', 180, 0.11], ['Ashfield Care', 120, 0.06]],
  Advisory: [['Oakline Foods', 415, 0.16], ['Bramwell Media', 360, -0.02], ['Marrow Klein', 235, -0.05], ['Vantis Retail', 170, -0.03]],
  Projects: [['Harding & Co', 470, -0.02], ['Delphi Works', 240, -0.03], ['Corven Group', 180, -0.04]],
  Support: [['Kelby Foods', 150, 0.05], ['Ashfield Care', 110, 0.06], ['Nyle Distribution', 100, 0.11], ['Castleton Retail', 91, -0.02]],
};
const CLIENT_SINCE = {
  'Peverel Group': 2019, 'Castleton Retail': 2021, 'Trentham Group': 2018, 'Nyle Distribution': 2020, 'Ashfield Care': 2023,
  'Oakline Foods': 2018, 'Bramwell Media': 2021, 'Marrow Klein': 2024, 'Vantis Retail': 2025,
  'Harding & Co': 2022, 'Delphi Works': 2024, 'Corven Group': 2020, 'Kelby Foods': 2022,
};

// ---------------------------------------------------------------- drivers
// June 2026 capacity (available hours) and the budget rate card (GBP per billable hour).
// 2025 rates and staff costs are a year earlier: rates 4% lower, pay 3% lower.
const JUNE_AVAILABLE = { Advisory: 3200, 'Managed Services': 6000, Projects: 3000, Support: 1800 };
const JUNE_BILLABLE = { Advisory: 2500, 'Managed Services': 4500, Projects: 2520, Support: 1460 };
const RATE_CARD_2026 = { Advisory: 486, 'Managed Services': 386, Projects: 350, Support: 315 };
const BUDGET_UTILISATION = 0.82;

// Team size relative to June 2026: the firm grew through 2025.
const headcount = (sl, mo) => {
  const start = { Advisory: 0.94, 'Managed Services': 0.9, Projects: 0.95, Support: 0.97 }[sl];
  return isJune(mo) ? 1 : start + (1 - start) * (mo.i / JUNE.i);
};
// Annual leave: summer and Christmas.
const LEAVE = { 7: 0.95, 8: 0.88, 12: 0.9 };

// Actual utilisation, month by month (January 2025 to June 2026).
// Managed Services slides every month in 2026; Projects stays strong.
const UTILISATION = {
  Advisory:           [80.5, 81.8, 82.4, 81.2, 82.9, 83.1, 81.6, 80.2, 82.7, 83.4, 82.1, 79.8, 81.0, 80.6, 79.9, 79.4, 78.8],
  'Managed Services': [82.4, 83.0, 82.1, 81.7, 82.6, 83.2, 82.0, 80.9, 82.3, 82.8, 81.9, 80.6, 80.6, 79.6, 78.5, 77.4, 76.2],
  Projects:           [83.1, 84.2, 82.9, 83.8, 84.6, 85.0, 83.7, 82.4, 84.1, 84.9, 83.8, 82.2, 83.4, 84.1, 84.6, 83.9, 84.4],
  Support:            [81.4, 82.2, 81.9, 82.5, 81.7, 82.4, 81.1, 80.3, 82.0, 82.6, 81.8, 80.7, 81.5, 81.9, 82.3, 81.4, 81.6],
};
// Average billing rate against the rate card. Advisory starts discounting in 2026.
const RATE_PREMIUM = {
  Advisory: (mo) => (mo.y === 2025 ? 0.004 : -0.006 * (mo.m - 0.5)),
  'Managed Services': () => 0.012,
  Projects: () => 0.01,
  Support: () => -0.012,
};

// Direct costs. Staff cost per available hour (2026) and budget shares of revenue.
const STAFF_COST_2026 = { Advisory: 175, 'Managed Services': 760000 / 6000, Projects: 110, Support: 250000 / 1800 };
const SUBS_SHARE = { Advisory: 0.0863, 'Managed Services': 0.1264, Projects: 0.209, Support: 0.0968 };
const EXPENSE_SHARE = { Advisory: 0.0447, 'Managed Services': 0.0537, Projects: 0.0465, Support: 0.056 };
// Projects leans on subcontractors from April 2026 and its margin falls.
const SUBS_OVERRUN = (sl, mo) => (sl === 'Projects' && mo.y === 2026 && mo.m >= 4 ? [1.12, 1.2][mo.m - 4] || 1.27 : 1);

// Overheads, monthly budget for 2026 (GBP 000). Depreciation has no budget line:
// its 25 a month was budgeted inside Other admin.
const OVERHEAD_BUDGET = { 'OH-ADMIN': 520, 'OH-PREM': 175, 'OH-TECH': 150, 'OH-MKT': 90, 'OH-PROF': 45, 'OH-DEP': 0, 'OH-OTHER': 100 };
// Phasing against the monthly budget (1 = the June figure above).
const MARKETING_PHASING = { 3: 1.5, 9: 1.5, 8: 0.5, 12: 0.5 };
const PROF_PHASING = { 1: 1.8, 2: 1.4 };
function overheadActual(acc, mo, budget) {
  if (acc === 'OH-DEP') return 25;
  if (acc === 'OH-ADMIN') return mo.y === 2025 ? budget * noise(0.03) : [519, 523, 541, 552, 558][mo.m - 1] || 560;
  if (acc === 'OH-MKT' && mo.y === 2026) return budget * 0.7 * noise(0.1);
  if (acc === 'OH-OTHER') return 75 * (mo.y === 2026 ? 1 : 0.96) * noise(0.08);
  return budget * noise(0.08);
}
const OVERHEAD_JUNE_ACTUAL = { 'OH-ADMIN': 560, 'OH-PREM': 180, 'OH-TECH': 145, 'OH-MKT': 60, 'OH-PROF': 30, 'OH-DEP': 25, 'OH-OTHER': 23 };
const OVERHEAD_ENTITY_SPLIT = [['LLP', 0.5], ['MSL', 0.3], ['PRJ', 0.2]];

// June 2026 pinned figures (GBP 000), so the pack tells the story in the spec.
const JUNE_REVENUE_ACTUAL = { Advisory: 1180, 'Managed Services': 1760, Projects: 890, Support: 451 };
const JUNE_DIRECT = { // [actual, budget] per account
  Advisory: { 'DC-STAFF': [560, 560], 'DC-SUBS': [84, 110], 'DC-EXP': [50, 57] },
  'Managed Services': { 'DC-STAFF': [760, 760], 'DC-SUBS': [180, 240], 'DC-EXP': [88, 102] },
  Projects: { 'DC-STAFF': [330, 330], 'DC-SUBS': [236, 180], 'DC-EXP': [42, 40] },
  Support: { 'DC-STAFF': [250, 250], 'DC-SUBS': [42, 45], 'DC-EXP': [24, 26] },
};
// June cost drift by client, in the order of CLIENTS (share of revenue, positive = more cost),
// so each client's margin moves a little differently from its service line's.
const JUNE_CLIENT_DRIFT = {
  'Managed Services': [0.01, -0.008, 0.012, -0.004, -0.006],
  Advisory: [0.004, -0.01, 0.012, -0.004],
  Projects: [0.006, -0.012, 0.004],
  Support: [-0.008, 0.006, 0.004, -0.01],
};

// ---------------------------------------------------------------- helpers
// Split a whole-pound total across weights so the parts add up exactly.
function split(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = Math.round(total) - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, k) => [v - Math.floor(v), k]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}
const pounds = (x) => Math.round(x);

// ---------------------------------------------------------------- build
const ledger = [];   // month_key, scenario, entity, service_line, account_code, client, amount
const capacity = []; // month_key, scenario, service_line, billable_hours, available_hours
const post = (mo, scenario, sl, account, client, amount) => {
  if (amount !== 0) ledger.push([mo.key, scenario, sl === 'Central' ? null : ENTITY_OF[sl], sl, account, client, amount]);
};

for (const mo of MONTHS) {
  const rateCardYear = mo.y === 2026 ? 1 : 1 / 1.04;
  const payYear = mo.y === 2026 ? 1 : 1 / 1.03;

  for (const sl of LINES) {
    // hours
    const available = isJune(mo) ? JUNE_AVAILABLE[sl]
      : Math.round(JUNE_AVAILABLE[sl] * (mo.days / JUNE.days) * (LEAVE[mo.m] || 1) * headcount(sl, mo));
    const billable = isJune(mo) ? JUNE_BILLABLE[sl] : Math.round(available * UTILISATION[sl][mo.i] / 100);
    const budgetBillable = Math.round(available * BUDGET_UTILISATION);
    capacity.push([mo.key, 'Actual', sl, billable, available], [mo.key, 'Budget', sl, budgetBillable, available]);

    // revenue
    const rateCard = Math.round(RATE_CARD_2026[sl] * rateCardYear);
    const revenueActual = isJune(mo) ? JUNE_REVENUE_ACTUAL[sl] * 1000 : pounds(billable * rateCard * (1 + RATE_PREMIUM[sl](mo)) * noise(0.012));
    const revenueBudget = budgetBillable * rateCard;

    // direct costs by account
    const staffCost = available * STAFF_COST_2026[sl] * payYear;
    const direct = {
      Actual: isJune(mo) ? mapValues(JUNE_DIRECT[sl], (v) => v[0] * 1000) : {
        'DC-STAFF': pounds(staffCost * noise(0.03)),
        'DC-SUBS': pounds(revenueActual * SUBS_SHARE[sl] * SUBS_OVERRUN(sl, mo) * noise(0.16) * (sl === 'Managed Services' && mo.y === 2026 ? 0.9 : 1)),
        'DC-EXP': pounds(revenueActual * EXPENSE_SHARE[sl] * noise(0.12)),
      },
      Budget: isJune(mo) ? mapValues(JUNE_DIRECT[sl], (v) => v[1] * 1000) : {
        'DC-STAFF': pounds(staffCost),
        'DC-SUBS': pounds(revenueBudget * SUBS_SHARE[sl]),
        'DC-EXP': pounds(revenueBudget * EXPENSE_SHARE[sl]),
      },
    };

    // spread revenue and direct costs over the line's clients
    const clients = CLIENTS[sl];
    const weights = clients.map(([, share]) => share * (isJune(mo) ? 1 : noise(0.1)));
    for (const scenario of ['Actual', 'Budget']) {
      const revenue = scenario === 'Actual' ? revenueActual : revenueBudget;
      const revByClient = split(revenue, scenario === 'Actual' ? weights : clients.map(([, share]) => share));
      // a client's direct cost leans on its margin offset and its drift, each measured from the
      // line's revenue-weighted average, so the line total is unchanged
      const lineCost = Object.values(direct[scenario]).reduce((s, v) => s + v, 0);
      const averageOffset = clients.reduce((s, [, , offset], k) => s + revByClient[k] * offset, 0) / revenue;
      const drift = scenario === 'Budget' ? clients.map(() => 0)
        : isJune(mo) ? JUNE_CLIENT_DRIFT[sl] : clients.map(() => (rand() - 0.5) * 0.024);
      const averageDrift = clients.reduce((s, c, k) => s + revByClient[k] * drift[k], 0) / revenue;
      const costWeights = clients.map(([, , offset], k) => revByClient[k] * (lineCost / revenue + offset - averageOffset + drift[k] - averageDrift));
      clients.forEach(([client], k) => post(mo, scenario, sl, REVENUE_ACCOUNT[sl], client, revByClient[k]));
      for (const [account, total] of Object.entries(direct[scenario])) {
        split(total, costWeights).forEach((v, k) => post(mo, scenario, sl, account, clients[k][0], -v));
      }
    }
  }

  // overheads, held centrally and split across the three entities
  for (const [account, budget2026] of Object.entries(OVERHEAD_BUDGET)) {
    const phasing = (account === 'OH-MKT' ? MARKETING_PHASING[mo.m] : account === 'OH-PROF' ? PROF_PHASING[mo.m] : 1) || 1;
    const budget = budget2026 * (mo.y === 2026 ? 1 : 0.96) * phasing;
    const actual = isJune(mo) ? OVERHEAD_JUNE_ACTUAL[account] : overheadActual(account, mo, budget);
    for (const [scenario, total] of [['Actual', actual], ['Budget', budget]]) {
      const parts = split(pounds(total * 1000), OVERHEAD_ENTITY_SPLIT.map(([, w]) => w));
      OVERHEAD_ENTITY_SPLIT.forEach(([entity], k) => {
        if (parts[k] !== 0) ledger.push([mo.key, scenario, entity, 'Central', account, null, -parts[k]]);
      });
    }
  }
}
function mapValues(o, f) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])); }

// ---------------------------------------------------------------- data problems
// The kind of faults a real ledger export has. The model handles each one.
// 1. Depreciation has actuals but no budget line (its budget sits in Other admin): built in above.
// 2. A late journal batch was exported twice: six June revenue rows appear twice.
const actualRevenueJune = ledger.filter((r) => r[0] === JUNE.key && r[1] === 'Actual' && r[4].startsWith('REV'));
for (const r of actualRevenueJune.slice(0, 6)) ledger.push(r.slice());
// 3. Client names typed by hand in the billing system: trailing spaces, capitals, double spaces.
const untidy = [(n) => n + ' ', (n) => n.toUpperCase(), (n) => n.replace(' ', '  ')];
let untidyCount = 0;
for (const r of ledger) {
  if (untidyCount < 12 && r[1] === 'Actual' && r[4].startsWith('REV') && r[0] < JUNE.key && rand() < 0.04) {
    r[5] = untidy[untidyCount % 3](r[5]);
    untidyCount++;
  }
}
// 4. Overheads carry no client: the model maps them to an Unallocated client.
// 5. One June delivery staff cost was posted with the wrong sign.
const wrongSign = ledger.find((r) => r[0] === JUNE.key && r[1] === 'Actual' && r[4] === 'DC-STAFF');
wrongSign[6] = Math.abs(wrongSign[6]);

// ---------------------------------------------------------------- write CSVs
const esc = (x) => { const s = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const write = (file, header, rows) => fs.writeFileSync(path.join(dataDir, file), [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n', 'utf8');

write('calendar.csv', ['month_key', 'month', 'month_start', 'year', 'month_number', 'working_days'], MONTHS.map((mo) => [mo.key, mo.label, mo.start, mo.y, mo.m, mo.days]));
write('entity.csv', ['entity_code', 'entity_name'], ENTITIES);
write('service_line.csv', ['service_line', 'entity_code', 'client_facing'], [...LINES.map((sl) => [sl, ENTITY_OF[sl], 'true']), ['Central', '', 'false']]);
write('account.csv', ['account_code', 'account', 'category', 'sort_order'], ACCOUNTS);
const clientRows = [];
for (const sl of LINES) for (const [client] of CLIENTS[sl]) if (!clientRows.some((c) => c[0] === client)) clientRows.push([client, sl, CLIENT_SINCE[client]]);
write('client.csv', ['client', 'lead_service_line', 'client_since'], clientRows);
write('ledger.csv', ['month_key', 'scenario', 'entity_code', 'service_line', 'account_code', 'client', 'amount'], ledger);
write('capacity.csv', ['month_key', 'scenario', 'service_line', 'billable_hours', 'available_hours'], capacity);

// ---------------------------------------------------------------- check summary
// Recomputed from the clean data (duplicates removed, signs fixed), in GBP 000.
const seen = new Set();
const clean = [];
for (const r of ledger) {
  const key = r.join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  const category = ACCOUNTS.find((a) => a[0] === r[4])[2];
  clean.push({ key: r[0], scenario: r[1], sl: r[3], account: r[4], client: (r[5] || '').trim().replace(/\s+/g, ' ').toLowerCase(), category, amount: category === 'Revenue' ? r[6] : -Math.abs(r[6]) });
}
const total = (f) => clean.filter(f).reduce((s, r) => s + r.amount, 0) / 1000;
const pl = (scenario, keys) => {
  const t = (cat) => total((r) => keys.includes(r.key) && r.scenario === scenario && r.category === cat);
  const revenue = t('Revenue'), gp = revenue + t('Direct costs'), op = gp + t('Overheads');
  return { revenue, gp, op };
};
const hours = (scenario, keys, sl) => capacity.filter((c) => keys.includes(c[0]) && c[1] === scenario && (!sl || c[2] === sl)).reduce((s, c) => [s[0] + c[3], s[1] + c[4]], [0, 0]);
const f0 = (x) => x.toFixed(0).padStart(7);
const pct = (x) => (100 * x).toFixed(1) + '%';

console.log(`Seed ${SEED}. Ledger ${ledger.length} rows, capacity ${capacity.length} rows, ${MONTHS.length} months.`);
console.log('\nMonth          Revenue A/B          Op profit A/B        GM A      Util A');
for (const mo of MONTHS) {
  const a = pl('Actual', [mo.key]), b = pl('Budget', [mo.key]);
  const [bh, ah] = hours('Actual', [mo.key]);
  console.log(`${mo.label.padEnd(10)} ${f0(a.revenue)} ${f0(b.revenue)}   ${f0(a.op)} ${f0(b.op)}   ${pct(a.gp / a.revenue).padStart(6)}  ${pct(bh / ah).padStart(6)}`);
}
const ytd = MONTHS.filter((mo) => mo.y === 2026).map((mo) => mo.key);
const ya = pl('Actual', ytd), yb = pl('Budget', ytd);
console.log(`\nYear to date 2026: revenue ${ya.revenue.toFixed(0)} against ${yb.revenue.toFixed(0)}, operating profit ${ya.op.toFixed(0)} against ${yb.op.toFixed(0)} (${(ya.op - yb.op).toFixed(0)})`);
const y25 = MONTHS.filter((mo) => mo.y === 2025).map((mo) => mo.key);
const a25 = pl('Actual', y25), b25 = pl('Budget', y25);
console.log(`Full year 2025: operating profit ${a25.op.toFixed(0)} against ${b25.op.toFixed(0)} (${(a25.op - b25.op).toFixed(0)})`);
console.log('\nJune 2026 by service line: utilisation A/B, hours effect, rate effect (GBP 000)');
let he = 0, re = 0;
for (const sl of LINES) {
  const [ba, av] = hours('Actual', [JUNE.key], sl); const [bb] = hours('Budget', [JUNE.key], sl);
  const rate = RATE_CARD_2026[sl];
  const rev = total((r) => r.key === JUNE.key && r.scenario === 'Actual' && r.sl === sl && r.category === 'Revenue');
  const h = (ba - bb) * rate / 1000, x = rev - ba * rate / 1000;
  he += h; re += x;
  console.log(`  ${sl.padEnd(17)} ${pct(ba / av)} / ${pct(bb / av)}   ${h.toFixed(1).padStart(7)}  ${x.toFixed(1).padStart(7)}`);
}
console.log(`  Total             hours effect ${he.toFixed(1)}, rate effect ${re.toFixed(1)}`);
const clientName = new Map(Object.values(CLIENTS).flat().map(([c]) => [c.toLowerCase(), c]));
const juneMargins = [...clientName.keys()].map((c) => {
  const t = (cat) => total((r) => r.key === JUNE.key && r.scenario === 'Actual' && r.client === c && r.category === cat);
  return [clientName.get(c), (t('Revenue') + t('Direct costs')) / t('Revenue')];
}).sort((a, b) => a[1] - b[1]);
console.log('\nJune 2026 gross margin by client, lowest first (floor 30%)');
console.log('  ' + juneMargins.map(([c, m]) => `${c} ${pct(m)}`).join(', '));
console.log(`\nData problems: duplicate rows 6, untidy client names ${untidyCount}, wrong-sign cost 1, unbudgeted account Depreciation, overheads with no client`);
