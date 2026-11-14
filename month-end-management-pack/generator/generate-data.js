'use strict';
// Writes the ledger extract, trial balance, timesheet hours and reference lists in ../data,
// and the contents of the finance workbooks in ./workbooks.
// Run with: node generate-data.js, then build-workbooks.ps1 to write the Excel files.

const fs = require('fs');
const path = require('path');

// mulberry32: a small seeded generator, so every run writes the same files.
const SEED = 20261031;
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
const between = (lo, hi) => lo + rand() * (hi - lo);

// Actuals run from January 2025 to October 2026. The budgets cover both full years.
const BANK_HOLIDAYS = new Set([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
]);
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function workingDays(y, m) {
  const out = [];
  for (let d = 1; d <= daysIn(y, m); d++) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd !== 0 && wd !== 6 && !BANK_HOLIDAYS.has(iso(y, m, d))) out.push(d);
  }
  return out;
}
const MONTHS = [];
for (const y of [2025, 2026]) {
  for (let m = 1; m <= 12; m++) {
    MONTHS.push({ y, m, key: `${y}-${pad(m)}`, label: `${MONTH_NAMES[m - 1]} ${y}`, days: workingDays(y, m), actual: y === 2025 || m <= 10 });
  }
}
const ACTUALS = MONTHS.filter((mo) => mo.actual);
const lastWorkingDay = (mo, onOrBefore = 31) => mo.days.filter((d) => d <= onOrBefore).pop();
const workingDayBetween = (mo, from, to) => {
  const days = mo.days.filter((d) => d >= from && d <= to);
  return days[Math.floor(rand() * days.length)];
};

const ENTITIES = [['LLP', 'Ashcombe Partners LLP'], ['AMS', 'Ashcombe Managed Services Ltd'], ['APL', 'Ashcombe Projects Ltd']];
const SERVICE_LINES = [
  { code: 'ADV', name: 'Advisory', entity: 'LLP', revenue: '4100' },
  { code: 'MSV', name: 'Managed Services', entity: 'AMS', revenue: '4200' },
  { code: 'PRJ', name: 'Projects', entity: 'APL', revenue: '4300' },
  { code: 'SUP', name: 'Support', entity: 'LLP', revenue: '4400' },
];
const ACCOUNTS = [
  ['4100', 'Advisory fees', 'Revenue'], ['4200', 'Managed services fees', 'Revenue'],
  ['4300', 'Project fees', 'Revenue'], ['4400', 'Support fees', 'Revenue'],
  ['5100', 'Delivery staff', 'Direct costs'], ['5200', 'Subcontractors', 'Direct costs'], ['5300', 'Recharged expenses', 'Direct costs'],
  ['6100', 'Admin staff', 'Overheads'], ['6200', 'Premises', 'Overheads'], ['6300', 'Technology', 'Overheads'],
  ['6400', 'Marketing', 'Overheads'], ['6500', 'Professional fees', 'Overheads'], ['6600', 'Depreciation', 'Overheads'],
  ['6900', 'Other admin', 'Overheads'],
];
const ACCOUNT_NAME = Object.fromEntries(ACCOUNTS.map(([c, n]) => [c, n]));
const CLIENTS = [
  ['PEV001', 'Peverel Group', 2019], ['CAS001', 'Castleton Retail', 2021], ['TRE001', 'Trentham Group', 2018],
  ['NYL001', 'Nyle Logistics', 2020], ['ASH001', 'Ashfield Care', 2023], ['OAK001', 'Oakline Foods', 2018],
  ['BRA001', 'Bramwell Media', 2021], ['MAR001', 'Marrow Klein', 2024], ['VAN001', 'Vantis Retail', 2025],
  ['HAR001', 'Harding & Co', 2022], ['COR001', 'Corven Group', 2020], ['DEL001', 'Delphi Works', 2024],
  ['KEL001', 'Kelby Foods', 2022],
];
const CLIENT_NAME = Object.fromEntries(CLIENTS.map(([c, n]) => [c, n]));

// Each service line's clients, with their usual share of its billable hours and the subcontractor used.
const BOOK = {
  ADV: [['OAK001', 0.35, 'Halden Associates'], ['BRA001', 0.30, 'Halden Associates'], ['MAR001', 0.20, 'Halden Associates'], ['VAN001', 0.15, 'Halden Associates']],
  MSV: [['PEV001', 0.34, 'Calder Network Services'], ['CAS001', 0.26, 'Calder Network Services'], ['TRE001', 0.18, 'Calder Network Services'],
    ['NYL001', 0.13, 'Northway Service Desk'], ['ASH001', 0.09, 'Calder Network Services']],
  PRJ: [['HAR001', 0.45, 'Pell Resourcing'], ['COR001', 0.32, 'Corran Technical'], ['DEL001', 0.23, 'Pell Resourcing']],
  SUP: [['KEL001', 0.34, 'Ardent Field Support'], ['ASH001', 0.26, 'Ardent Field Support'], ['NYL001', 0.22, 'Ardent Field Support'], ['CAS001', 0.18, 'Ardent Field Support']],
};

// Budget drivers by year: delivery headcount, rate card (per billable hour) and staff cost per available hour.
const PLAN = {
  2025: { fte: { ADV: 19, MSV: 43, PRJ: 19, SUP: 14 }, rate: { ADV: 188, MSV: 92, PRJ: 130, SUP: 68 }, cost: { ADV: 75, MSV: 44, PRJ: 56, SUP: 32 } },
  2026: { fte: { ADV: 20, MSV: 45, PRJ: 20, SUP: 14 }, rate: { ADV: 195, MSV: 95, PRJ: 135, SUP: 70 }, cost: { ADV: 78, MSV: 46, PRJ: 58, SUP: 33 } },
};
const TARGET_UTILISATION = 0.82;
const HOURS_A_DAY = 7.5;
const PLANNED_LEAVE = [0.07, 0.07, 0.08, 0.10, 0.09, 0.09, 0.14, 0.18, 0.09, 0.09, 0.08, 0.16];
const plannedHours = (sl, mo) => Math.round((PLAN[mo.y].fte[sl] * HOURS_A_DAY * mo.days.length * (1 - PLANNED_LEAVE[mo.m - 1])) / 50) * 50;
const SUBS_BUDGET = { ADV: 0.05, MSV: 0.11, PRJ: 0.16, SUP: 0.04 };
const EXPENSE_SHARE = { ADV: 0.03, MSV: 0.015, PRJ: 0.03, SUP: 0.02 };

// Overheads budget a month, and how each account is shared between the companies.
const MARKETING = { 2025: [9, 9, 20, 12, 12, 19, 10, 7, 20, 14, 18, 18], 2026: [12, 12, 22, 14, 14, 20, 12, 8, 22, 16, 20, 20] };
const OVERHEADS = {
  2025: { 6100: 98000, 6200: 40000, 6300: 28000, 6500: 12000, 6900: 23000 },
  2026: { 6100: 105000, 6200: 41000, 6300: 30000, 6500: 12500, 6900: 24000 },
};
const overheadBudget = (account, mo) => (account === '6400' ? MARKETING[mo.y][mo.m - 1] * 1000 : OVERHEADS[mo.y][account]);
const SPLIT = {
  6100: { LLP: 0.55, AMS: 0.27, APL: 0.18 }, 6200: { LLP: 0.6, AMS: 0.25, APL: 0.15 }, 6300: { LLP: 0.5, AMS: 0.35, APL: 0.15 },
  6400: { LLP: 1 }, 6500: { LLP: 0.6, AMS: 0.2, APL: 0.2 }, 6600: { LLP: 0.5, AMS: 0.3, APL: 0.2 }, 6900: { LLP: 0.5, AMS: 0.3, APL: 0.2 },
};
// Depreciation has no budget line: finance budgeted it inside Other admin.
const DEPRECIATION = { 2025: 9000, 2026: 9500 };

// Actual drivers, January 2025 to October 2026.
const UTILISATION = {
  ADV: [81.8, 82.4, 82.9, 81.6, 82.7, 83.0, 81.9, 80.8, 82.6, 83.2, 82.4, 80.9, 82.0, 81.6, 82.3, 81.4, 81.9, 82.2, 81.1, 80.6, 81.8, 81.5],
  MSV: [82.6, 83.1, 82.4, 82.0, 82.8, 83.3, 82.2, 81.4, 82.5, 82.9, 82.1, 81.0, 81.6, 81.0, 80.3, 79.7, 79.0, 78.4, 77.9, 77.1, 76.6, 75.8],
  PRJ: [83.4, 84.1, 83.0, 83.7, 84.5, 84.9, 83.6, 82.6, 84.0, 84.7, 83.9, 82.4, 83.6, 84.2, 84.8, 84.0, 84.5, 85.1, 83.9, 83.2, 84.6, 84.3],
  SUP: [81.6, 82.3, 81.9, 82.6, 81.8, 82.5, 81.3, 80.6, 82.1, 82.7, 81.9, 80.8, 81.7, 82.0, 82.4, 81.6, 81.8, 82.3, 81.5, 80.9, 81.9, 82.2],
};
// Available hours against plan. Managed Services carried two vacancies in July and August 2026.
function capacityFactor(sl, mo) {
  if (mo.y === 2026 && mo.m === 10) return { ADV: 1.004, MSV: 0.993, PRJ: 1.006, SUP: 0.998 }[sl];
  if (sl === 'MSV' && mo.y === 2026 && (mo.m === 7 || mo.m === 8)) return 0.955;
  return between(0.982, 1.018);
}
const PREMIUM = { OAK001: 0.005, BRA001: 0, MAR001: -0.005, VAN001: 0.01, PEV001: 0.01, CAS001: 0, TRE001: 0.005, NYL001: -0.01, ASH001: 0, HAR001: 0.01, COR001: 0, DEL001: -0.005, KEL001: 0.005 };
// Advisory clients kept their 2025 rates when the 2026 rate card went up.
function clientRate(sl, client, y) {
  if (sl === 'ADV' && y === 2026) return clientRate(sl, client, 2025);
  return Math.round(PLAN[y].rate[sl] * (1 + PREMIUM[client]));
}
// Corven Group's subcontractors run further over budget every month of 2026.
const CORVEN_2026 = [0.20, 0.21, 0.23, 0.26, 0.29, 0.32, 0.35, 0.38, 0.41, 0.44];
function subsShare(sl, client, mo) {
  if (client === 'COR001') return mo.y === 2025 ? 0.18 : CORVEN_2026[mo.m - 1];
  if (client === 'NYL001' && sl === 'MSV') return 0.30;
  return { ADV: 0.05, MSV: 0.08, PRJ: 0.15, SUP: 0.04 }[sl];
}
const ADMIN_2026 = (m) => 101200 + 1350 * (m - 1);

// Splits a whole number into integer parts in proportion to the weights.
function allocate(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, x) => s + x, 0);
  exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}
const pence = (pounds) => Math.round(pounds * 100);

const journals = [];
const journal = (date, type, entity, lines) => journals.push({ date, type, entity, lines });
const line = (account, sl, client, text, amount) => ({ account, sl, client, text, amount });
const hoursRows = [];
const drivers = [];

ACTUALS.forEach((mo, i) => {
  const d = (day) => iso(mo.y, mo.m, day);
  const monthEnd = d(daysIn(mo.y, mo.m));
  const payroll = {};
  for (const [entity] of ENTITIES) payroll[entity] = [];

  for (const sl of SERVICE_LINES) {
    const planned = plannedHours(sl.code, mo);
    const available = Math.round(planned * capacityFactor(sl.code, mo));
    const billable = Math.round((available * UTILISATION[sl.code][i]) / 100);
    hoursRows.push([iso(mo.y, mo.m, 1), sl.entity, sl.code, available, billable]);
    const book = BOOK[sl.code];
    const clientHours = allocate(billable, book.map(([, share]) => share * between(0.94, 1.06)));
    const staff = pence(available * PLAN[mo.y].cost[sl.code] * between(0.996, 1.006));
    drivers.push({ mo, sl: sl.code, planned, available, billable });

    let timeCost = 0;
    const subsBySupplier = {};
    const expenseLines = [];
    book.forEach(([client, , supplier], k) => {
      const hours = clientHours[k];
      const rate = clientRate(sl.code, client, mo.y);
      const revenue = hours * rate * 100;
      // Advisory and Projects invoice twice a month, the two services once at month end.
      const twice = sl.code === 'ADV' || sl.code === 'PRJ';
      const firstHalf = Math.round((hours * mo.days.filter((x) => x <= 15).length) / mo.days.length);
      if (twice) {
        journal(d(lastWorkingDay(mo, 15)), 'SI', sl.entity, [line(sl.revenue, sl.code, client, `Fees 1-15 ${mo.label}`, -firstHalf * rate * 100)]);
        journal(d(lastWorkingDay(mo)), 'SI', sl.entity, [line(sl.revenue, sl.code, client, `Fees 16-${daysIn(mo.y, mo.m)} ${mo.label}`, -(revenue - firstHalf * rate * 100))]);
      } else {
        journal(d(lastWorkingDay(mo)), 'SI', sl.entity, [line(sl.revenue, sl.code, client, `${sl.name} fees, ${mo.label}`, -revenue)]);
      }
      const cost = Math.round((staff * hours) / available);
      timeCost += cost;
      payroll[sl.entity].push(line('5100', sl.code, client, `Time cost, ${CLIENT_NAME[client]}`, cost));
      const subs = Math.round(revenue * subsShare(sl.code, client, mo) * between(0.95, 1.05));
      (subsBySupplier[supplier] ||= []).push(line('5200', sl.code, client, `${supplier}, ${CLIENT_NAME[client]}, ${mo.label}`, subs));
      const expenses = Math.round(revenue * EXPENSE_SHARE[sl.code] * between(0.85, 1.15));
      expenseLines.push(line('5300', sl.code, client, `Travel and subsistence, ${CLIENT_NAME[client]}`, expenses));
    });
    payroll[sl.entity].push(line('5100', sl.code, null, 'Non-chargeable time', staff - timeCost));
    for (const lines of Object.values(subsBySupplier)) {
      const day = mo.y === 2026 && mo.m === 10 && sl.code === 'PRJ' ? 23 : workingDayBetween(mo, 18, 28);
      journal(d(day), 'PI', sl.entity, lines);
    }
    journal(d(mo.days[mo.days.length - 2]), 'PI', sl.entity, expenseLines);
  }

  // Overheads
  const actual = {
    6100: mo.y === 2025 ? overheadBudget('6100', mo) * between(0.99, 1.01) : ADMIN_2026(mo.m) + between(-150, 150),
    6200: overheadBudget('6200', mo) * between(0.995, 1.005),
    6300: overheadBudget('6300', mo) * between(0.90, 0.96),
    6400: overheadBudget('6400', mo) * (mo.y === 2025 ? between(0.9, 1.0) : between(0.5, 0.6)),
    6500: overheadBudget('6500', mo) * between(0.7, 0.9),
    6600: DEPRECIATION[mo.y],
    6900: (overheadBudget('6900', mo) - DEPRECIATION[mo.y]) * between(0.93, 1.0),
  };
  const byEntity = (account) => {
    const shares = Object.entries(SPLIT[account]);
    const parts = allocate(pence(actual[account]), shares.map(([, s]) => s));
    return shares.map(([entity], k) => [entity, parts[k]]);
  };
  for (const [entity, amount] of byEntity('6100')) payroll[entity].push(line('6100', 'CEN', null, 'Admin staff', amount));
  for (const [entity, lines] of Object.entries(payroll)) journal(d(lastWorkingDay(mo, 26)), 'PAY', entity, lines);

  const invoices = {
    6200: [['Office rent', 0.78, 'rent'], ['Service charge', 0.14], ['Energy and water', 0.08]],
    6300: [['Software subscriptions', 0.47], ['IT support contract', 0.30], ['Laptop leases', 0.23]],
    6400: [['Events and sponsorship', 0.6], ['Website and design', 0.4]],
    6500: [['Audit fee accrual', 0.55, 'accrual'], ['Legal advice', 0.45]],
    6900: [['Insurance', 0.35], ['Training', 0.25], ['Recruitment', 0.25], ['Office supplies', 0.15]],
  };
  for (const [account, pieces] of Object.entries(invoices)) {
    for (const [entity, amount] of byEntity(account)) {
      const parts = allocate(amount, pieces.map(([, s]) => s));
      pieces.forEach(([text, , kind], k) => {
        let value = parts[k];
        // A laptop lease invoice posted as a credit in October 2026.
        if (account === '6300' && text === 'Laptop leases' && entity === 'LLP' && mo.y === 2026 && mo.m === 10) value = -value;
        if (kind === 'accrual') journal(monthEnd, 'MJ', entity, [line(account, 'CEN', null, `${text}, ${mo.label}`, value)]);
        else journal(d(kind === 'rent' ? mo.days[0] : workingDayBetween(mo, 4, 26)), 'PI', entity, [line(account, 'CEN', null, `${text}, ${mo.label}`, value)]);
      });
    }
  }
  for (const [entity, amount] of byEntity('6600')) journal(monthEnd, 'DEP', entity, [line('6600', 'CEN', null, `Depreciation, ${mo.label}`, amount)]);
});

// Manual journals posted with no client. Accrued income moves revenue off the client's invoice
// until it is billed, and a rebate was agreed without saying with whom.
const ACCRUALS = [['2026-06-30', '2026-07-01', 1580000, 'Jun 2026'], ['2026-10-30', null, 1260000, 'Oct 2026']];
for (const [date, reversal, amount, label] of ACCRUALS) {
  const invoice = journals.find((j) => j.type === 'SI' && j.date === date && j.lines[0].client === 'PEV001');
  invoice.lines[0].amount += amount;
  journal(date, 'MJ', 'AMS', [line('4200', 'MSV', null, `Accrued income, Managed Services, ${label}`, -amount)]);
  if (reversal) {
    const next = journals.find((j) => j.type === 'SI' && j.date.slice(0, 7) === reversal.slice(0, 7) && j.lines[0].client === 'PEV001');
    next.lines[0].amount -= amount;
    journal(reversal, 'MJ', 'AMS', [line('4200', 'MSV', null, `Reversal of accrued income, ${label}`, amount)]);
  }
}
journal('2026-10-20', 'MJ', 'LLP', [line('4100', 'ADV', null, 'Fee rebate agreed, Advisory', 420000)]);

// Journal numbers follow the posting date.
const TYPE_ORDER = { SI: 1, PI: 2, PAY: 3, MJ: 4, DEP: 5 };
journals.sort((a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.entity.localeCompare(b.entity));
const extractRows = [];
const nextDay = (date) => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
journals.forEach((j, n) => {
  j.no = 100001 + n;
  j.lines.forEach((l, k) => extractRows.push({ j, l, lineNo: k + 1, extractedAt: `${nextDay(j.date)} 02:15:00` }));
});
// The extract was run again on 26 October 2026 and appended the purchase invoices of 23 October a second time.
const reloaded = extractRows.filter((r) => r.j.date === '2026-10-23' && r.j.type === 'PI').map((r) => ({ ...r, extractedAt: '2026-10-26 02:15:00' }));

// Files
const dataDir = path.join(__dirname, '..', 'data');
const workbookDir = path.join(__dirname, 'workbooks');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(workbookDir, { recursive: true });
const csvField = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(file, header, rows) {
  fs.writeFileSync(file, [header, ...rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n', 'utf8');
  return rows.length;
}
const money = (p) => (p / 100).toFixed(2);

writeCsv(path.join(dataDir, 'entities.csv'), ['entity_code', 'entity_name'], ENTITIES);
writeCsv(path.join(dataDir, 'service_lines.csv'), ['service_line_code', 'service_line', 'client_facing', 'sort_order'],
  [...SERVICE_LINES.map((s, k) => [s.code, s.name, 1, k + 1]), ['CEN', 'Central', 0, 5]]);
writeCsv(path.join(dataDir, 'accounts.csv'), ['account_code', 'account_name', 'account_type', 'sort_order'], ACCOUNTS.map((a, k) => [...a, k + 1]));
writeCsv(path.join(dataDir, 'clients.csv'), ['client_code', 'client_name', 'client_since'], CLIENTS);
const allRows = [...extractRows, ...reloaded].sort((a, b) => a.extractedAt.localeCompare(b.extractedAt) || a.j.no - b.j.no || a.lineNo - b.lineNo);
writeCsv(path.join(dataDir, 'journal_lines.csv'),
  ['journal_no', 'line_no', 'journal_type', 'posting_date', 'entity_code', 'account_code', 'service_line_code', 'client_code', 'description', 'debit', 'credit', 'extracted_at'],
  allRows.map(({ j, l, lineNo, extractedAt }) => [j.no, lineNo, j.type, j.date, j.entity, l.account, l.sl, l.client, l.text,
    money(Math.max(l.amount, 0)), money(Math.max(-l.amount, 0)), extractedAt]));

const tb = new Map();
for (const { j, l } of extractRows) {
  const key = `${j.date.slice(0, 7)}-01|${j.entity}|${l.account}`;
  tb.set(key, (tb.get(key) || 0) + l.amount);
}
writeCsv(path.join(dataDir, 'trial_balance.csv'), ['month', 'entity_code', 'account_code', 'movement'],
  [...tb.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => [...key.split('|'), money(amount)]));
writeCsv(path.join(dataDir, 'hours.csv'), ['month', 'entity_code', 'service_line_code', 'available_hours', 'billable_hours'], hoursRows);

// Workbook contents: budgets with costs as positive amounts, as finance types them.
for (const y of [2025, 2026]) {
  const months = MONTHS.filter((mo) => mo.y === y);
  const rows = [];
  for (const sl of SERVICE_LINES) {
    const revenue = months.map((mo) => (plannedHours(sl.code, mo) * 82 * PLAN[y].rate[sl.code]) / 100);
    rows.push([sl.entity, sl.name, sl.revenue, ACCOUNT_NAME[sl.revenue], ...revenue]);
    rows.push([sl.entity, sl.name, '5100', ACCOUNT_NAME['5100'], ...months.map((mo) => plannedHours(sl.code, mo) * PLAN[y].cost[sl.code])]);
    rows.push([sl.entity, sl.name, '5200', ACCOUNT_NAME['5200'], ...revenue.map((r) => Math.round(r * SUBS_BUDGET[sl.code]))]);
    rows.push([sl.entity, sl.name, '5300', ACCOUNT_NAME['5300'], ...revenue.map((r) => Math.round(r * EXPENSE_SHARE[sl.code]))]);
  }
  for (const [entity] of ENTITIES) {
    for (const account of ['6100', '6200', '6300', '6400', '6500', '6900']) {
      if (!SPLIT[account][entity]) continue;
      const amounts = months.map((mo) => {
        const shares = Object.entries(SPLIT[account]);
        return allocate(overheadBudget(account, mo), shares.map(([, s]) => s))[shares.findIndex(([e]) => e === entity)];
      });
      // In the 2026 workbook one account code was typed with a trailing space.
      const code = y === 2026 && entity === 'AMS' && account === '6300' ? '6300 ' : account;
      rows.push([entity, 'Central', code, ACCOUNT_NAME[account], ...amounts]);
    }
  }
  writeCsv(path.join(workbookDir, `budget_${y}.csv`), ['Company', 'Service line', 'Account', 'Account name', ...MONTH_NAMES], rows);
  writeCsv(path.join(workbookDir, `assumptions_${y}.csv`), ['Company', 'Service line', 'Rate card', 'Target utilisation', ...MONTH_NAMES],
    SERVICE_LINES.map((sl) => [sl.entity, sl.name, PLAN[y].rate[sl.code], TARGET_UTILISATION, ...months.map((mo) => plannedHours(sl.code, mo))]));
}

// The finance director's commentary for the last three closes.
const COMMENTARY = [
  ['2026-08-01', 'Headline', 'Operating profit £129k against a budget of £185k, £56k short.'],
  ['2026-08-01', 'Revenue', 'Two vacancies in Managed Services reduced available hours. That shows as capacity in the bridge, not as lost billable time. Utilisation in the line was 77.1%.'],
  ['2026-08-01', 'Margin', 'Projects gross margin 23.1% against 28.6% budget, on Corven Group subcontractor costs.'],
  ['2026-08-01', 'Costs', 'Overheads £3k under budget. Admin staff over budget again.'],
  ['2026-09-01', 'Headline', 'Operating profit £208k against a budget of £261k, £53k short.'],
  ['2026-09-01', 'Revenue', 'Managed Services utilisation fell to 76.6%, £35k of billable time against the 82% target. Advisory is still billing at 2025 rates.'],
  ['2026-09-01', 'Margin', 'Projects gross margin 21.5% against 28.6%. Corven Group subcontractor costs keep rising and its margin is 10.7%.'],
  ['2026-09-01', 'Costs', 'Overheads £8k under budget, mostly marketing. Admin staff £7k over.'],
  ['2026-10-01', 'Headline', 'Operating profit £206k against a budget of £267k, £61k short, and £272k behind budget for the year to date.'],
  ['2026-10-01', 'Revenue', 'Revenue £52k under budget. Managed Services utilisation has fallen every month since January, to 75.8%, and cost £39k of billable time. Advisory billed £20k below its rate card, including a £4k rebate posted without a client.'],
  ['2026-10-01', 'Margin', 'Projects gross margin 22.7% against 28.6%. Corven Group is at 10.8% and Nyle Logistics at 27.4%, both below the 30% floor.'],
  ['2026-10-01', 'Costs', 'Overheads £9k under budget. That includes a £3k laptop lease posted as a credit, which we are checking with the supplier. Admin staff costs are £8k over budget and have risen every month this year.'],
  ['2026-10-01', 'Actions', 'Partners to agree the Managed Services resourcing plan, and a pricing review for Corven Group before its next phase.'],
];
writeCsv(path.join(workbookDir, 'commentary.csv'), ['Month', 'Topic', 'Comment'], COMMENTARY);

// Summary of what the report should show, read back from the clean extract.
const f0 = (p) => Math.round(p / 100).toLocaleString('en-GB');
const sumBy = (pred) => extractRows.filter(pred).reduce((s, r) => s - r.l.amount, 0);
const inMonth = (key) => (r) => r.j.date.startsWith(key);
const ytd = (y, m) => (r) => r.j.date >= `${y}-01-01` && r.j.date <= `${y}-${pad(m)}-31`;
const typeOf = (code) => ACCOUNTS.find(([c]) => c === code)[2];
const type = (t) => (r) => typeOf(r.l.account) === t;
const and = (...ps) => (r) => ps.every((p) => p(r));
const budgetRows = (y) => fs.readFileSync(path.join(workbookDir, `budget_${y}.csv`), 'utf8').trim().split('\n').slice(1)
  .map((s) => s.match(/("[^"]*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '')));
function budget(y, fromM, toM, types) {
  let total = 0;
  for (const r of budgetRows(y)) {
    const t = typeOf(r[2].trim());
    if (!types.includes(t)) continue;
    for (let m = fromM; m <= toM; m++) total += (t === 'Revenue' ? 1 : -1) * Number(r[3 + m]) * 100;
  }
  return total;
}
for (const [label, pred, from, to] of [['Oct 2026', inMonth('2026-10'), 10, 10], ['YTD 2026', ytd(2026, 10), 1, 10]]) {
  const rev = sumBy(and(pred, type('Revenue'))), dc = sumBy(and(pred, type('Direct costs'))), oh = sumBy(and(pred, type('Overheads')));
  const bRev = budget(2026, from, to, ['Revenue']), bDc = budget(2026, from, to, ['Direct costs']), bOh = budget(2026, from, to, ['Overheads']);
  console.log(`${label}: revenue ${f0(rev)} (budget ${f0(bRev)}), direct costs ${f0(dc)} (${f0(bDc)}), gross margin ${(100 * (rev + dc) / rev).toFixed(1)}% (${(100 * (bRev + bDc) / bRev).toFixed(1)}%), overheads ${f0(oh)} (${f0(bOh)}), operating profit ${f0(rev + dc + oh)} (${f0(bRev + bDc + bOh)})`);
}
console.log('\nOct 2026 by service line: utilisation, billing rate against rate card, capacity / hours / rate effects');
for (const sl of SERVICE_LINES) {
  const dr = drivers.find((x) => x.sl === sl.code && x.mo.key === '2026-10');
  const rc = PLAN[2026].rate[sl.code];
  const rev = sumBy(and(inMonth('2026-10'), (r) => r.l.account === sl.revenue));
  const cap = (dr.available - dr.planned) * TARGET_UTILISATION * rc, hrs = (dr.billable - dr.available * TARGET_UTILISATION) * rc, rate = rev / 100 - dr.billable * rc;
  console.log(`  ${sl.name.padEnd(17)} ${(100 * dr.billable / dr.available).toFixed(1)}%  ${(rev / 100 / dr.billable).toFixed(2)} vs ${rc}  ${cap.toFixed(0)} / ${hrs.toFixed(0)} / ${rate.toFixed(0)}`);
}
console.log('\nClient gross margin, Oct 2026 and 2026 to date');
const clientMargin = (code, pred) => {
  const rev = sumBy(and(pred, (r) => r.l.client === code, type('Revenue'))), dc = sumBy(and(pred, (r) => r.l.client === code, type('Direct costs')));
  return [rev, rev ? (100 * (rev + dc)) / rev : NaN];
};
for (const [code, name] of CLIENTS) {
  const [rev, m1] = clientMargin(code, inMonth('2026-10'));
  const [revY, mY] = clientMargin(code, ytd(2026, 10));
  console.log(`  ${name.padEnd(18)} ${f0(rev).padStart(8)} ${m1.toFixed(1).padStart(6)}%   ${f0(revY).padStart(10)} ${mY.toFixed(1).padStart(6)}%`);
}
const unallocated = sumBy(and(inMonth('2026-10'), (r) => !r.l.client, type('Revenue')));
const credits = extractRows.filter((r) => r.l.amount < 0 && !type('Revenue')(r));
console.log(`\nChecks: ${extractRows.length} journal lines, ${reloaded.length} loaded twice (${f0(reloaded.reduce((s, r) => s + r.l.amount, 0))}), unallocated revenue Oct 2026 ${f0(unallocated)}, cost lines in credit ${credits.length} (${credits.map((r) => `${r.j.date} ${r.l.text} ${f0(-r.l.amount)}`).join('; ')})`);
console.log('Admin staff 2026 by month: ' + ACTUALS.filter((mo) => mo.y === 2026).map((mo) => f0(-sumBy(and(inMonth(mo.key), (r) => r.l.account === '6100')))).join(', '));
console.log('Managed Services utilisation 2026: ' + drivers.filter((x) => x.sl === 'MSV' && x.mo.y === 2026).map((x) => (100 * x.billable / x.available).toFixed(1)).join(', '));
