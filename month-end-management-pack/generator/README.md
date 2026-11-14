# Data generator

Writes the files the Month-End Management Pack is built from: the ledger extract, trial balance, timesheet hours and reference lists in [`../data`](../data/), and the contents of the finance workbooks in [`workbooks`](workbooks/).

```
node generate-data.js
powershell -File build-workbooks.ps1
```

The first script has no dependencies. The random numbers are seeded, so every run writes the same files, and it ends with a summary of the figures the report should show. The second needs Excel: it writes `Budget 2025.xlsx`, `Budget 2026.xlsx` and `Close commentary.xlsx` in [`../finance`](../finance/) from the CSV files in `workbooks`, which are there so the budgets can also be read without Excel.

| File | Rows |
|---|---|
| `journal_lines.csv` | 2,629: 2,622 journal lines, 7 of them loaded twice |
| `trial_balance.csv` | 704, the monthly movement per company and account |
| `hours.csv` | 88, available and billable hours per month, company and service line |
| `accounts.csv`, `clients.csv`, `entities.csv`, `service_lines.csv` | 14, 13, 3 and 5 |
| `workbooks/budget_2025.csv`, `budget_2026.csv` | 32 each, months across, costs as positive amounts |
| `workbooks/assumptions_2025.csv`, `assumptions_2026.csv` | 4 each: rate card, target utilisation and planned hours |
| `workbooks/commentary.csv` | 13, the finance director's notes for August to October 2026 |

Actuals run from January 2025 to October 2026. Each month is built from operating drivers: available hours from working days and leave, utilisation, client billing rates, staff cost per hour, and subcontractors and expenses as a share of revenue. The budget applies 82% utilisation and the rate card to the planned hours.

Problems planted on purpose: the purchase invoices of 23 October 2026 loaded again by the extract three days later, manual journals on revenue with no client, a laptop lease posted as a credit, depreciation with actuals but no budget line, and an account code typed with a trailing space in the 2026 workbook.
