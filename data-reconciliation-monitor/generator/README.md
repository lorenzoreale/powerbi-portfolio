# Data generator

Writes the CSVs in [`../data`](../data/) for the Data Reconciliation Monitor.

```
node generate-data.js
```

No dependencies. The random numbers are seeded, so every run writes the same files. The script ends with a summary that works out every status the way the model does: the last load by data area, the last 14 nights, checks passed by quality dimension, and the issue log.

| File | Rows |
|---|---|
| `date.csv` | 90 nights, 1 April to 29 June 2026 |
| `feed.csv` | 8 data areas |
| `rule.csv` | 48 |
| `feed_run.csv` | 681 |
| `check_result.csv` | 4,049, of which 7 are a rerun |
| `issue_log.csv` | 68 |

The files hold measurements about the data, never a status. The constants near the top set the story: the last load (`LAST`), earlier shortfalls such as the truncated store sales extract of 14 June, late arrivals, quality-rule failures, and the issues open on 29 June.

Problems planted on purpose: nights with no load scheduled, the 14 June store sales checks written twice, DepotTrack arrival times in three formats, a rule added on 15 May, four data areas with no money to reconcile, and one issue resolved before it was opened.
