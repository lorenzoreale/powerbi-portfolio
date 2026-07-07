# Mock data generator

Generates every CSV in `../data` for the Data Reconciliation and Quality Monitor. The shapes, volumes and deliberate wrinkles it produces are specified in [`docs/spec-data-reconciliation.md`](../../docs/spec-data-reconciliation.md); if this script and the spec disagree, the spec wins.

## Running it

```
node generate-data.js
```

No dependencies, any recent Node. Output is **fully deterministic**: the script embeds its own PRNG (mulberry32, seed `20260629`), so every run produces byte-identical CSVs. The run prints a verification summary that re-derives every verdict exactly as the DAX will (thresholds from the rule table, keep-latest on `run_seq`, load checks driving the feed verdict) and checks the seeded anchors: the 29 Jun figures, the 14 Jun dip, dimension pass rates, and the break-register flow.

## Outputs

| File | Grain | Rows |
|---|---|---|
| `date.csv` | one day, 01 Apr - 30 Jun 2026 | 91 |
| `feed.csv` | one monitored feed | 8 |
| `rule.csv` | one quality rule, with its thresholds | 48 |
| `feed_run.csv` | feed x scheduled night: pairwise counts, amounts, files, arrival | 681 |
| `check_result.csv` | rule x scheduled night: units checked, units failed, minutes late | 4,049 |
| `break_register.csv` | one discrepancy raised (14 still open at 29 Jun) | 68 |

## The core conventions

- **The facts are measurements about data, not the data itself.** `feed_run.csv` records that last night's POS extract had 2,412,384 rows at source and 2,412,384 landed; it does not contain the rows. ~4,700 fact rows describe the movement of ~4.65m source rows a night.
- **Verdicts are never stored.** There is no status column in any fact. Pass / warn / fail derives from `units_failed / units_checked` (or `minutes_late` and missing files, for timeliness rules) against the `warn_above_pct` / `fail_above_pct` / `*_late_mins` thresholds on `rule.csv`. Change a tolerance there and every verdict re-derives.
- **Units are rule-defined**: rows for count and in-warehouse rules, pounds for amount reconciliations, files for arrival checks. `rule.csv` carries the unit; `is_load_check` marks the rules (row count, amount, arrival) whose worst verdict is the feed's verdict on the status board.
- Row grain in the counts is **line grain** (till lines, order lines, journal lines, invoice lines), which is why the average line values are small (POS ~£7.64, EDI invoice lines ~£178).

## How the story is anchored

The 29 Jun 2026 run is fixed to the seeded design targets and everything else is derived around it:

- 4,654,459 source rows compared, row match rate 99.97% against the 99.90% threshold; 6 feeds pass, 1 warns, 1 fails.
- Supplier EDI invoices fail: file 2 of 3 absent, 7,736 rows landed vs 8,940 manifested (-1,204), amounts 1,379,600 vs 1,594,208 (-214,608), arrival 05:41. All three failing rules that night (R-017, R-019, R-022) are EDI's.
- E-commerce orders warn for the third consecutive night (-3 rows, -412 on amounts, 0.039%, inside the 0.05% tolerance): the refund-timing story.
- The 14 Jun POS truncation (~50k rows short) drops that night's match rate to 98.91% and is still visible in every 30-night trend. Its break opened 14 Jun, resolved next day.
- EDI is chronically late (six warn nights in the trailing 30) so Timeliness is the weakest quality dimension at 95.6%; the other dimensions run 97.2-99.0%.
- Breaks: 68 in the register (BRK-0126 to BRK-0193), 14 open at 29 Jun (3 critical, 4 high; 5 of the 14 on EDI), oldest BRK-0171 (product master schema drift, 9 days), median open age 3 days, MTTR 2.7 days over the trailing 28 nights against a 3.0-day target; the last 7 nights resolved 9 while opening 10.
- Snapshot feeds walk backwards from their 29 Jun anchor (loyalty members grow ~340/day to 1,872,455; the store master steps 641 to 642 on 15 May: a store opening).

## Deliberate data-quality wrinkles (spec section 7)

| # | What the script plants | Where |
|---|---|---|
| W1 | No-run nights: GL loads weekdays only (26 absent nights), EDI Mon-Sat (13) - absent from the facts, never failures | `feed_run.csv`, `check_result.csv` |
| W2 | The 14 Jun POS checks ran twice: a first result set understating the shortfall, then the corrected rerun (`run_seq` 2). Keep-latest gives the true figures | `check_result.csv` |
| W3 | R-021 (barcode unique) joined the rulebook on 15 May, mid-window, so denominators must count evaluations, not nights x rules | `rule.csv`, `check_result.csv` |
| W4 | DepotTrack writes arrival times in three formats ("04:52", "04:44:40", "4:52") in the raw column | `feed_run.csv` |
| W5 | BRK-0147 is resolved before it opened (a data-entry slip), flagged and excluded from MTTR, left visible | `break_register.csv` |
| W6 | The four non-monetary feeds have genuinely blank amount columns (360 runs), rendered as a dash, never zero | `feed_run.csv` |
