# Data generator

Writes the CSVs in [`../data`](../data/) for the Month-End Management Pack.

```
node generate-data.js
```

No dependencies. The random numbers are seeded, so every run writes the same files. The script ends with a summary of revenue, operating profit, margin and utilisation by month, the June hours and rate effects, and client margins.

| File | Rows |
|---|---|
| `calendar.csv` | 18 months, January 2025 to June 2026 |
| `entity.csv` | 3 |
| `service_line.csv` | 5, including Central for overheads |
| `account.csv` | 14 |
| `client.csv` | 13 |
| `ledger.csv` | 3,012, of which 6 are duplicates |
| `capacity.csv` | 144 |

Each month is built from operating drivers: available hours from working days and leave, utilisation, billing rates against the rate card, staff cost per hour, and subcontractors and expenses as a share of revenue. The budget applies 82% utilisation and the rate card to the same available hours. June 2026 is pinned to fixed figures.

Problems planted on purpose: a June journal batch exported twice, ten client names with stray spaces or capitals, overheads with no client, one delivery staff cost posted with the wrong sign, and depreciation with actuals but no budget line.
