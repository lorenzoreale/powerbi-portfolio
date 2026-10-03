# Data generator

Writes the CSVs in [`../data`](../data/) for the Site Inspection Performance report.

```
node generate-data.js
```

No dependencies. The random numbers are seeded, so every run writes the same files. The script ends with a summary of the figures the report should show.

| File | Rows |
|---|---|
| `sites.csv` | 42 |
| `people.csv` | 10 |
| `questions.csv` | 24 |
| `inspections.csv` | 868, of which 5 are duplicates |
| `responses.csv` | 20,712 |
| `actions.csv` | 484, one pointing at a missing inspection |
| `monthly_targets.csv` | 18 |

Dates run to 26 June 2026, the last inspection, never the real clock. The constants at the top of the script set the story: compliance improving to just above target, South West the weakest region, three sites left unvisited past the 60-day rule, and actions closing later than a year earlier.

Problems planted on purpose: five inspections exported twice, ten site names with stray spaces or capitals, two actions with no owner, one action pointing at an inspection that does not exist, about 4% of answers marked N/A, and months with no visit at some sites.
