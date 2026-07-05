# Mock data generator

Generates every CSV in `../data` for the Month-End Management Pack. The shapes, volumes and deliberate wrinkles it produces are specified in [`docs/spec-month-end.md`](../../docs/spec-month-end.md); if this script and the spec disagree, the spec wins.

## Running it

```
node generate-data.js
```

No dependencies, any recent Node. Output is **fully deterministic**: the script embeds its own PRNG (mulberry32, seed `20260630`), so every run produces byte-identical CSVs. The run prints a verification summary (the June P&L against its anchors, revenue by service line, YTD, utilisation, wrinkle counts) so the numbers can be checked after any change.

## Outputs

| File | Grain | Rows |
|---|---|---|
| `calendar.csv` | one month | 18 |
| `scenario.csv` | Actual / Budget | 2 |
| `entity.csv` | one legal entity | 3 |
| `service_line.csv` | one service line | 5 |
| `account.csv` | one P&L account | 14 |
| `client.csv` | one client | 13 |
| `pl_line.csv` | one P&L statement line | 16 |
| `ledger.csv` | Month x Scenario x Entity x Service Line x Account x Client | ~3,000 |
| `capacity.csv` | Month x Scenario x Service Line | 144 |

## The core convention: signed amounts

Every `amount` in `ledger.csv` is a **signed profit contribution**: revenue positive, all costs negative. So `SUM(amount)` is the profit at any level of the P&L, and `Actual - Budget` carries the favourable/unfavourable sign for every line without special-casing (spec section 3). Amounts are in whole pounds; the report formats to thousands.

## How the story is anchored

The June 2026 Group figures are fixed to the seeded design targets and everything else is derived from them:

- Revenue 4,281 vs 4,500, Gross profit 1,635 vs 1,800, Operating profit 612 vs 720; margins 38.2% / 40.0% and 14.3% / 16.0%.
- Revenue by service line: Advisory 1,180, Managed Services 1,760, Projects 890, Support 451 (each split across its clients).
- Direct cost per client is a fixed share of that client's revenue, so client gross margin falls out naturally.
- Other months scale the June decomposition by a gentle budget ramp and a performance jitter, so budget-vs-actual is realistic in every period; only June is displayed, and YTD is the honest sum of Jan to June.
- Utilisation 78% actual vs 82% target, weakest in Managed Services, which explains the revenue miss.

## Deliberate data-quality wrinkles (spec section 7)

| # | What the script plants | Where |
|---|---|---|
| W1 | Depreciation is unbudgeted (no budget row) but actualised, so its variance is undefined | `ledger.csv` |
| W2 | A re-exported late-journal batch duplicates 6 June actual rows | `ledger.csv` |
| W3 | 12 actual revenue rows carry a dirty client name (trailing space, UPPERCASE, doubled space) | `ledger.csv` |
| W4 | Overhead rows have a blank client | `ledger.csv` |
| W5 | One June delivery-staff cost is posted with the wrong (positive) sign | `ledger.csv` |
| W6 | Four sub-pound rounding rows that vanish once shown in thousands | `ledger.csv` |

The semantic model handles each in the open: dedupe, blank-to-Unallocated mapping, sign coercion by account category, and a divide-by-zero guard on Variance %. The handling is documented in the project README and the spec.
