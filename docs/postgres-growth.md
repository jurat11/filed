# Postgres growth

Neon holds only aggregate tables (docs/decisions.md D10), and each load builds a complete
new schema before swapping it in, so the database needs room for **two copies** of the
`filed` schema. On the free plan that is 512 MB, so the schema must stay under about
250 MB.

## Measure

```bash
DATABASE_URL=<neon direct url> uv run python scripts/db_sizes.py   # writes eval/db_sizes.md
```

The report lists each table and index with its size and how often each index has been
used since the last load, the rows of `lca_cube` per fiscal year, and the headroom:
512 MB minus twice the schema.

## What each index is for

| Index | Query (web/lib/queries.ts) |
| --- | --- |
| `employers (slug)` unique | employer page |
| `employers (employer_id)` unique | joins from aliases, links, lca_cube |
| `employers (naics, state, certified_total DESC)` | similar employers |
| `aliases (employer_id)` | name variants on the employer page |
| `aliases USING gin (norm gin_trgm_ops)` | search (exact, prefix, substring, fuzzy) |
| `lca_year (employer_id, fiscal_year)`, `lca_year_role (employer_id)`, `lca_year_top (employer_id)`, `entry_signal (employer_id)`, `uscis_year (employer_id)` | employer page |
| `links (employer_a)`, `links (employer_b)` | related legal entities |
| `lca_cube (fiscal_year, role_group, worksite_state, wage_level)` | /explore filters |

Dropped in this change, because no query uses them: `employers (uscis_initial_total)`
(explore sorts the aggregated result, not the table), `lca_cube (employer_id)` (explore
joins the cube to employers by the employers key), and the trigram index on
`employers.search_text` (search now uses `aliases.norm`; the column is gone too). If
`db_sizes.py` shows an index with 0 scans after a few weeks of traffic, it is the next
candidate.

## When the free plan stops being enough

At the last measured load the schema was about 229 MB (D10), with four fiscal years. Most
of it grows with the number of fiscal years (`lca_cube`, `lca_year`, `lca_year_top`), and
some does not (`employers`, `aliases`). If every table grew in proportion to the years,
one more fiscal year would add about 57 MB; that is an upper bound, and `db_sizes.py`
gives the real per-year cube rows. On that bound a fifth fiscal year (FY2027) takes the
schema to about 286 MB, and two copies (572 MB) no longer fit in 512 MB.

The rule: **when the headroom in `eval/db_sizes.md` is smaller than the size one more
fiscal year adds, choose one of these before loading that year.**

1. **Swap per fiscal year (stays free).** Partition `lca_cube`, `lca_year`,
   `lca_year_top` by `fiscal_year` (LIST partitions). A load builds only the changed
   years' partitions as standalone tables, then in one transaction detaches the old
   partitions, attaches the new ones, and swaps the small whole-table tables (`employers`,
   `aliases`, `links`, `entry_signal`, `uscis_year`, `meta`) as today. Readers still see
   either the old or the new data (DDL is transactional), and the second copy is only one
   fiscal year plus the small tables. This fits the incremental ETL (D26), where a new
   quarterly release changes one fiscal year. It is more code in `etl/load.py` and needs
   tests of its own against the CI Postgres.
2. **Keep fewer years in the cube.** Hold `lca_cube` for the last N fiscal years only and
   say so on /explore. Cheapest, but it removes data from the site.
3. **A paid Neon plan.** Larger storage per branch; the current load works unchanged.
   Check Neon's current plan limits and prices before deciding.

Partitioning also helps queries once the cube passes a few million rows: /explore with a
fiscal year filter reads one partition. Until then the single composite index is enough.
