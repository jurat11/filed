# Decisions

Calls made where the brief, the spec or the data left a choice open. Each has the reason.

## Data acquisition

**D1. Which DOL files.** The brief assumes quarterly releases are cumulative within a fiscal year, so only the last one is needed. The files say otherwise. Measured from the DECISION_DATE range of every file:

| File | Decisions from | to | Rows |
| --- | --- | --- | --- |
| FY2023 Q1 | 2022-10-01 | 2022-12-31 | 98,735 |
| FY2023 Q2 | 2022-10-01 | 2023-03-31 | 231,544 |
| FY2023 Q3 | 2023-04-01 | 2023-06-30 | 186,389 |
| FY2023 Q4 | 2023-07-01 | 2023-09-30 | 127,939 |
| FY2024 Q1 to Q4 | one quarter each | | 99,692 / 123,978 / 216,470 / 120,897 |
| FY2025 Q1 to Q4 | one quarter each | | 107,414 / 132,133 / 238,425 / 118,580 |
| FY2026 Q3 | 2025-10-01 | 2026-06-30 | 437,496 |

Loading only "Q4" would have kept about 22% of FY2023 to FY2025. So all four quarterly files are loaded for FY2023 to FY2025, and the single FY2026 Q3 file (the latest on dol.gov as of September 23, 2026) for FY2026. Within a fiscal year a case that appears in more than one file keeps the row from the latest file, since CASE_STATUS is the status after the last significant event. This drops 102,758 repeated rows: 100,197 in FY2023 (FY2023 Q2 repeats all of Q1) and 1,731 in FY2025 (cases decided in one quarter and withdrawn in a later one). The union of each year's main files was checked against that year's worksites file: every worksites case is in the main files for FY2023 and FY2026, while 9,604 (FY2024) and 8,872 (FY2025) worksites cases have no main-file row, which is a gap in DOL's releases and is listed as a limitation.

The brief says the worksites file starts in FY2026, but dol.gov publishes an `LCA_Worksites` file for every year. It is loaded and row-count checked for every year.

**D2. Files downloaded by hand.** dol.gov answers 403 to scripted downloads, so the files were downloaded in a browser and put in `data/raw/`. The download date in `data/manifest.json` is the file's modification time, and the source URL is the link on the DOL performance page.

**D11. FY2023 has no employer FEIN.** The FY2023 record layout lists EMPLOYER_FEIN as withheld PII, and the column is absent from all four FY2023 files. FY2023 rows (and the few later rows with a malformed or placeholder FEIN) are attached to a FEIN employer in this order: (a) one FEIN holds at least 95% of the FY2024 to FY2026 rows with the same normalized name and employer state; (b) the name and state have no FEIN rows, but the normalized name maps to exactly one FEIN in any state. Otherwise they form a name-based employer. Result: 94.4% of FY2023 cases (513,345 of 543,580) join a FEIN employer; the rest stay name-based. The 95% share, rather than "exactly one FEIN", is there because single typo rows are common: one "Amazon.com Services LLC" row filed under another company's FEIN would otherwise have stranded 11,534 FY2023 Amazon cases. It never merges two FEINs; it only decides where a row without a FEIN goes.

**D12. Worksite state = first worksite on the main file.** The main file carries the first worksite (city, state, wage, wage level) for every case; the worksites file lists additional locations. So that each LCA counts once, state filters and "top worksite states" use the main file's first worksite.

**D13. Yes/No fields.** The layouts describe H-1B_DEPENDENT and WILLFUL_VIOLATOR as Y/N, but the files hold "Yes", "No" and "N/A". Y, YES, N and NO are parsed; N/A is null.

**D14. Column name drift inside a year.** FY2025 Q1 names the dependency column "H-1B_DEPENDENT" where every other file says "H_1B_DEPENDENT", so column maps are keyed by fiscal year and quarter. The worksites files spell out state names ("MINNESOTA") and are converted to USPS codes.

**D15. Blank rows in the sheets.** Several DOL sheets carry hundreds of thousands of formatted but empty rows after the data (FY2026 Q3: 437,496 data rows, 595,239 blank). DuckDB's `read_xlsx` stops at the first empty row by default; the loader reads the whole sheet and drops rows with no CASE_NUMBER, and the raw count is taken from the sheet XML by a separate reader that counts rows with any value. Every blank row sits after the last data row.

**D16. Placeholder FEINs.** 12-3456789 appears on 102 cases from 18 unrelated employers (a filler value), and 98-7654321 and 55-5555555 appear too. FEINs that are a placeholder sequence, one repeated digit, or start with 00 are treated as missing, and those rows resolve by name.

**D17. Public employers share FEINs.** Many state agencies and universities file under one state FEIN (for example 52-6002033 covers the University of Maryland, the Maryland Department of Health and others). One FEIN is one employer in Filed, so these appear as one employer under the most frequent name, with every name listed as a variant. Stray single rows filed under a big company's FEIN by another company (for example 1 "Neurolens, Inc." row under Meta's FEIN) stay in that employer's variant list with their row count, since nothing in the data says which field is wrong.

## Wages

**D3. Offered wage = `WAGE_RATE_OF_PAY_FROM`.** The LCA gives a wage range. The lower bound is always filled in and is the figure the employer commits to. `WAGE_RATE_OF_PAY_TO` is often blank, so it is kept but not used in statistics.

**D4. Unit spelling.** Units are matched ignoring case and spaces, and "BiWeekly" is read as "Bi-Weekly". Any other unit gives no annual wage, and the row counts as having no usable wage.

## Employer names

**D5. Extra legal suffixes.** Besides the spec's list (INC, LLC, LLP, CORP, CORPORATION, CO, LTD, LP, PLLC, THE), the normalizer also removes INCORPORATED, LIMITED, COMPANY and PC. These are long forms or near forms of listed suffixes ("FORD MOTOR COMPANY" and "FORD MOTOR CO" must agree). Suffixes are removed only from the end of the name, repeatedly ("CO LTD"), and "THE" only from the start, so words in the middle of a name are never touched.

**D6. Connectors dropped; periods and apostrophes join.** "&", "+" and the word "AND" all become a space, so "AT&T", "AT & T" and "AT and T" agree. A first version turned "&" into "AND"; that failed to match USCIS, which writes "ERNST YOUNG US LLP" for Ernst & Young U.S. LLP. Periods and apostrophes are deleted without a space so "L.L.C." becomes "LLC" and "MACY'S" becomes "MACYS".

**D7. DBA.** Text after "DBA" or "D/B/A" in a name is cut off. The legal name comes first, and the trade name is in its own column.

## USCIS

**D18. USCIS years loaded: FY2023 only.** USCIS publishes Employer Data Hub files as CSV up to FY2023 (https://www.uscis.gov/archive/h-1b-employer-data-hub-files). FY2024 to FY2026 are only in the hub's interactive Tableau view, which cannot be scripted and was not downloaded by hand for this build. The FY2023 export has USCIS's own "Initial Approval" and "Continuing Approval" columns, so D8 below is not needed for it. The site labels USCIS figures FY2023, and the entry-level signal shows USCIS initial approvals for FY2025 to FY2026 as "not loaded", never as zero.

**D8. Initial and continuing.** The Employer Data Hub now reports six categories (New Employment, New Concurrent, Continuation, Change with Same Employer, Change of Employer, Amended), but its own documentation still describes counts of "initial" and "continuing" approvals. Filed uses initial = New Employment + New Concurrent and continuing = the other four. This is the split USCIS used when the hub published two columns, and it puts F-1 to H-1B changes of status under initial. New Employment is also stored and shown on its own.

**D9. USCIS tax ID.** The hub gives the last four digits of the employer's tax ID. The brief joins on normalized name plus state; the last four FEIN digits are used as an extra check to break ties when one normalized name and state matches several LCA employers. A match found that way is labeled `several_candidates_tax4` in `eval/join.md`; `several_candidates` is kept for ties the last four digits cannot break, which stay unmatched. (Before this split both were labeled `several_candidates`, so that row of the FY2023 report mixed matched and unmatched employers.)

**D19. USCIS FY2024 and later: file layouts.** Later years can only be downloaded from the hub's viewer, and the download can arrive in more than one shape, so `etl/uscis_files.py` recognizes the layout from the header instead of assuming one: the legacy archive layout (Initial and Continuing columns), the six-category layout (one Approval and one Denial column per category; what a Crosstab download of the table view gives), and the long layout of a Tableau "Data" download (`Measure Names` / `Measure Values`), which is pivoted back to one row per employer line. UTF-16 with tabs (Tableau's format) and thousands separators are handled. A six-category file must have all twelve category columns or it is refused; an unknown measure name is refused. Headers are matched after removing case, spaces and punctuation, with a small alias list ("Employer (Petitioner) Name", "Petitioner State", ...), since the hub has renamed columns between releases. The row count check compares the parser's data rows with an independent count of non-empty records. Files go in `data/raw/uscis/` as `uscis_hub_FY{year}.csv` (docs/download.md); a registered year is loaded when its file is present, and a file whose Fiscal Year column disagrees with its name is refused. A blank six-category cell is missing, not zero: a row's initial (or continuing) count is the sum of the parts that are present, and missing when every part is missing. The layout was written from the hub's published column list and tested on fixtures built to match it; the first real FY2024 download should be checked against `tests/fixtures/uscis/` before its numbers are trusted.

**D20. Missing is never shown as 0.** An audit of every place a missing value could turn into a number changed these:

| Where | Before | Now |
| --- | --- | --- |
| `employers.uscis_initial_total` for an employer with no USCIS match | 0 | NULL; explore and CSV show a dash / empty cell |
| `employers.certified_total`, `lca_rows` for a USCIS-only employer | 0 ("0 certified LCAs" in search) | NULL; search says "no LCA match" |
| `lca_year.certified_workers` when certified rows state no worker count | 0 | NULL (0 only when there are no certified rows) |
| `lca_cube.wage_sum` with no valid wage | 0 | NULL (the mean was already guarded) |
| entry signal USCIS figure when only some of its years are loaded | partial sum | NULL, labeled "not loaded"; "no USCIS record matched" when the years are loaded but the employer is not in them |
| `pct()` on the site with a missing part | "0%" | a dash |
| `scripts/reconcile.py`, a fiscal year missing from the database | compared with 0 | reported as "missing" and counted as a difference |

The CSV export writes missing values as empty cells. Each case has a test (`tests/test_aggregate.py`, `tests/test_load.py`, `tests/test_reconcile.py`, `web/test/format.test.ts`, `web/e2e/smoke.spec.ts`).

## Database

**D10. Neon holds aggregates, not every case row.** The Neon project is on the free plan, with a 512 MB limit per branch. About 2.5 to 3 million canonical LCA rows would not fit with indexes. The canonical table is kept in DuckDB (`data/work/filed.duckdb`) and exported as Parquet. Neon gets the aggregate tables, including a cube of certified counts by employer, fiscal year, role group, worksite state and wage level, which is what `/explore` filters. To leave room for the schema swap (old and new copies exist together until the swap commits), only what the site shows is stored: top titles and states for each employer's latest fiscal year, role groups for the last two years, and one entry-level role selection. The database is about 229 MB, so two copies fit in 512 MB. The reconcile script compares the Neon aggregate counts with counts computed straight from the raw files. (Update, D23: `employers.search_text` and its trigram index were dropped; search uses a trigram index on `aliases.norm` instead.)

## Tests

**D21. Test database from the fixtures, not a hand-picked 50.** The brief suggested a seed of about 50 employers. `filed seed` instead runs the full pipeline (`etl/seed.py`) on every committed fixture slice: about 800 real LCA rows sampled from all 17 DOL files, which resolve to 572 LCA employers, plus the synthetic USCIS files in `tests/fixtures/uscis/` (clearly labeled; the counts are made up). Using all of them keeps one data set for three jobs: the fixture reconcile (`tests/test_reconcile.py`, the pandas path of `scripts/reconcile.py` against the pipeline, which must show 0 differences), the load tests against a throwaway Postgres, and the site's Playwright tests. Trimming to 50 employers would have needed a second selection rule and would have broken the reconcile. The seed loads in about a second. `filed seed` refuses a Neon URL, so fixture data cannot reach the production database.

**D22. /explore input.** Query strings are untrusted. Role groups, wage levels and states must be on fixed lists (states: USPS codes), the fiscal year must be a loaded year, `min` and `page` must be plain digits and are clamped, and the sort key must be an own key of the sort table (`?sort=constructor` used to pass an `in` check through the object prototype and break the query). Anything else falls back to the default rather than erroring. All values are bind parameters; the SQL text for hostile input is identical to the text for no input (`web/test/explore.test.ts`).

## Site

**D23. Search matches normalized names.** A query is normalized with a TypeScript port of the ETL normalizer (`web/lib/names.ts`; both are tested on `tests/fixtures/normalize_cases.json`), so "ernst and young", "Ernst & Young" and "ERNST YOUNG" find the same employer. It is compared with every name variant's normalized form (`aliases.norm`, LCA and USCIS spellings) and ranked: exact match, then prefix, then substring, each by certified LCAs; then trigram matches by similarity. The name variant that matched is shown under the result when it is not just another spelling of the display name (for example a search for "Government Employees Insurance" shows the GEICO employer whose most frequent spelling is "Government Employee Insurance Company (GEICO)"). This replaced a trigram search on one concatenated `search_text` column per employer, which ranked long alias lists oddly and cost an index of its own. The typeahead calls `/api/search`; the search form is a plain GET form, so it works without JavaScript.

**D24. Caching follows the loads.** The data changes only when `filed load` swaps in a schema, so every query result is cached under one tag (`unstable_cache`, tag "filed"), employer pages are rendered on first request and kept (ISR), and `/sources` and the sitemaps are static. At the end of a load, `filed load` POSTs the new `loaded_at` to `/api/revalidate` with a bearer secret. The route purges the tag only if `filed.meta.loaded_at` in the database already equals that value, and answers 409 otherwise (load.py retries), so a purge cannot re-cache the old data. A one-day revalidate is the fallback if the call fails; `filed load` then exits with an error after the data is committed, so the failure is visible.

**D25. Employer page additions.** Per-role wage percentiles come from the same certified, full-time, valid-wage rows as the overall ones, per fiscal year, for the last two loaded years (the table Neon already held for role groups). The trend line plots certified LCAs from `lca_year` and marks a partial year (a release with quarter < 4). "Related legal entities" lists `possible_links` pairs (different FEINs, same normalized name) on both employers' pages; they stay separate employers (rule: different FEINs are never merged). Amazon.com Services and Amazon Web Services do not share a normalized name, so they are not linked by this rule; a reviewed parent map is Phase 4. "Similar employers" are employers with the same most frequent NAICS code on their LCAs and the same employer state, ranked by certified LCAs over all loaded years. NAICS is the code the employer wrote on the LCA, so it is as reliable as the filer.
