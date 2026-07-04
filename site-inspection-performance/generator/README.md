# Mock data generator

Generates every CSV in `../data` for the Site Inspection Performance project. The shapes, volumes and deliberate wrinkles it produces are specified in [`docs/spec-site-inspection.md`](../../docs/spec-site-inspection.md); if this script and the spec disagree, the spec wins and the script is wrong.

## Running it

```
node generate-data.js
```

No dependencies, any recent Node (tested on v24). Output is **fully deterministic**: the script embeds its own PRNG (mulberry32, seed `20260628`) rather than using `Math.random`, so every run on every machine produces byte-identical CSVs. Regenerating is always safe; never edit the CSVs by hand.

The script ends by printing a verification summary (volumes, compliance by month, region and section, severity mix, staleness, action lifecycle, wrinkle counts) so the seeded narratives can be checked against the spec after any change.

## Outputs

| File | Grain | Rows |
|---|---|---|
| `sites.csv` | one row per site | 42 |
| `people.csv` | one row per inspector or site manager | 10 |
| `questions.csv` | one row per checklist question | 24 |
| `inspections.csv` | one row per inspection visit | 868 (863 real + 5 deliberate duplicates) |
| `responses.csv` | one row per question answered per inspection | 20,712 |
| `actions.csv` | one row per corrective action | 476 (475 real + 1 deliberate orphan) |
| `monthly_targets.csv` | one row per month | 18 |

All time-relative logic is anchored to the fixed as-at date **28 June 2026**, never the real clock.

## How the story is seeded

The fail probability of each checklist answer is `BASE_FAIL x time trend x section multiplier x (1 + region effect + site effect)`, so the narratives in spec section 3 fall out of a handful of constants at the top of the script:

- `TREND_DROP` improves compliance from the high 80s to the low 90s, crossing the 90% target in early spring 2026.
- `REGION_ADJ` makes North the strongest region and South West the weakest.
- `SECTION_MULT` plus `SIGNAGE_EXTRA_DROP` makes Signage the weakest section and the fastest improver, and Electrical the strongest.
- Site overrides make Kingsway Depot the repeat offender (two visits a month, findings every month) and Fenton Works the model site.
- `CUTOFF` stops inspecting Neath Yard, Ely Sidings and Perth North on fixed dates, creating the staleness story on the Coverage page (94, 72 and 62 days at the as-at date).
- A coverage floor (`COVERAGE_FLOOR_DAYS`) forces a visit to any other site unvisited for 55 days, so random gaps never outgrow the deliberate ones.
- `HIGH_START`/`HIGH_END` shift the severity mix away from High over the window.
- `STALL_P` leaves a small overdue tail open at the as-at date (10 actions, oldest 34 days overdue) and `DUE_SOON_HOLD_P` keeps a little work open that is due in the coming days.

## Deliberate data-quality wrinkles (spec section 7)

| # | What the script plants | Where |
|---|---|---|
| W1 | Coverage gaps and three stale sites | scheduling |
| W2 | 5 duplicate inspection rows appended verbatim (a re-exported mid-May 2026 batch) | `inspections.csv` |
| W3 | ~4% of answers are N/A | `responses.csv` |
| W4 | One action referencing inspection `SI-2026-0341`, which does not exist | `actions.csv` |
| W5 | Two actions with a blank `owner_id` | `actions.csv` |
| W6 | 10 action rows with dirty site names (trailing space, UPPERCASE, doubled space) | `actions.csv` |

The semantic model handles each of these visibly; the handling is documented in the project README and the spec.
