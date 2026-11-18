# Data generator

Writes the monitoring tables and the issue log export in [`../data`](../data/) for the Data Reconciliation Monitor.

```
node generate-data.js
..\sql\build.cmd
```

No dependencies. The random numbers are seeded, so every run writes the same files. The script ends with a summary that works out every status the way the model does: the last load by data area, the last 14 nights, the checks flagged by quality dimension, and the issue log. `build.cmd` then loads the files into SQL Server.

| File | Rows |
|---|---|
| `feed.csv` | 8 data areas |
| `rule.csv` | 48 rules with their limits |
| `feed_run.csv` | 682, one per area per night it loaded, 2 August to 30 October 2026 |
| `check_result.csv` | 4,055, of which 7 are a rerun |
| `issue_log.csv` | 68 |

The files hold measurements about the data, never a status. The constants near the top set the story: the last load (`LAST`), earlier shortfalls such as the truncated store sales extract of 15 October, late arrivals, quality rule failures, and the issues open on 30 October.

Problems planted on purpose: nights with no load scheduled, the 15 October store sales checks written twice, DepotTrack arrival times in three formats, a rule added on 15 September, four data areas with no money to reconcile, and one issue resolved before it was opened.
