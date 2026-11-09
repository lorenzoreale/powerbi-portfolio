# Data generator

Writes the files in [`../data`](../data/) for the Site Inspection Performance report.

```
node generate-data.js
```

No dependencies. The random numbers are seeded, so every run writes the same files. The script ends with a summary of the figures the report should show.

| File | Rows |
|---|---|
| `exports/inspections_YYYY-MM.csv` | 22 files, 1,073 rows: 1,069 inspections, 4 of them exported twice |
| `actions.csv` | 569, one pointing at an inspection that does not exist |
| `sites.csv` | 42 |
| `checklist.csv` | 24 |
| `inspection_plan.csv` | 132, one row per region and month |
| `region_access.csv` | 6, one regional manager per region |

Each export has one row per inspection and one column per checklist question, answered `Pass`, `Fail - High`, `Fail - Medium`, `Fail - Low` or `N/A`.

Dates run from January 2025 to 30 October 2026, the last inspection, never the real clock. The constants at the top of the script set the story: compliance improving to just above target, South West the weakest region and Signage the weakest section, actions closing later than a year earlier, and three sites left past the 60-day visit rule while others are visited far more often than they need.

Problems planted on purpose: four inspections edited after submission and exported again the next month, dates written as dd/mm/yyyy from the August 2026 export, ten site names in the actions list with stray spaces or capitals, two overdue actions with no owner, one action pointing at an inspection that does not exist, and about 4% of answers marked N/A.
