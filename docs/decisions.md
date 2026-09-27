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

**D18. USCIS years loaded: FY2023 only.** (Checked September 27, 2026: the hub's viewer now covers FY2009 to FY2026 Q3, so FY2024, FY2025 and FY2026 to date can be added by downloading them from the viewer; see D19 and docs/download.md. The DOL files loaded, through FY2026 Q3, are DOL's latest release; FY2026 Q4 comes after the fiscal year ends on September 30.) USCIS publishes Employer Data Hub files as CSV up to FY2023 (https://www.uscis.gov/archive/h-1b-employer-data-hub-files). FY2024 to FY2026 are only in the hub's interactive Tableau view, which cannot be scripted and was not downloaded by hand for this build. The FY2023 export has USCIS's own "Initial Approval" and "Continuing Approval" columns, so D8 below is not needed for it. The site labels USCIS figures FY2023, and the entry-level signal shows USCIS initial approvals for FY2025 to FY2026 as "not loaded", never as zero.

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

## Pipeline

**D26. Incremental, resumable ETL.** Each step has a fingerprint: a hash of the code of the modules that implement it, the SHA-256 of the raw files it reads, and the fingerprint of the step before it (`etl/steps.py`). After a step succeeds its fingerprint is written to `data/manifest.json` under `steps`; `filed all` skips a step whose fingerprint is unchanged and whose output tables exist in the local DuckDB, and `load` is skipped when `filed.meta.etl_fingerprint` in Neon already equals the aggregate fingerprint. A failed step records nothing, so the next run resumes there. The fingerprints go in the committed manifest, as asked, so the manifest also says which inputs produced the committed `eval/` reports; on a fresh clone there is no DuckDB, so every step runs anyway. `ingest` re-stages a raw file when its hash differs from the manifest (before, a corrected file under the same name was not re-read) and records a fingerprint per fiscal year. "A new quarterly release reprocesses only its fiscal year" holds for the slow part, reading xlsx (every other file's Parquet is reused), and the canonical tables are rebuilt from Parquet in seconds. `resolve`, `uscis` and `aggregate` always run over all years, because an FY2023 row is linked to an employer through FEINs seen in FY2024 to FY2026 (D11) and employer ids are assigned over the whole set; running them per year would change results. Raw file hashes are cached by size and modification time in `data/work/hash_cache.json`, so an unchanged 1.8 GB is not re-read to check it.

**D27. Raw store keyed by content.** Raw files are stored under their SHA-256 (`etl/store.py`, docs/raw-store.md), which the manifest already records, so the manifest is the index and no listing or naming scheme in the bucket has to be kept in sync. `fetch` verifies each download's hash before it replaces a local file; `push-raw` refuses a local file whose hash differs from the manifest, so the store never holds bytes the manifest does not describe. The backend is an S3 URL (any S3-compatible provider, chosen by the person who creates the bucket) or `file://` for tests and local backups; boto3 is an optional extra so the rest of the pipeline does not need it.

**D28. What stops the ETL workflow.** Before Neon is touched: a row count mismatch in ingest or USCIS parsing (both raise), or any difference between the raw files and the local build in `scripts/reconcile.py --against duckdb` (the same independent pandas path, compared with DuckDB instead of Neon). During the load, the per-table row count assertion. After it, the reconcile against Neon, which writes `eval/reconcile.md`. Secrets come only from Actions secrets; the workflow checks the store secrets are set before it starts.

**D29. Index audit.** Every index was matched to the query that uses it (docs/postgres-growth.md). `employers (uscis_initial_total)` and `lca_cube (employer_id)` serve no query and were dropped; with the `search_text` trigram index gone (D23) the load builds three fewer indexes. `scripts/db_sizes.py` reports index scans since the last load on Neon, which is the check for the next round.

## Data depth

**D30. "Likely cap-exempt" is a stated rule, not a fact.** Cap-exempt employers (institutions of higher education, their affiliated nonprofits, and nonprofit or government research organizations, 8 CFR 214.2(h)(8)(iii)(F)) do not go through the H-1B lottery, which matters to a reader deciding where to apply. No file Filed loads says whether an employer is cap-exempt, so the site shows "Likely cap-exempt" with the rule that fired, never "cap-exempt". The rules, in order (the first that fires is shown):

1. `irs_nonprofit`: the employer's FEIN is in the IRS Exempt Organizations Business Master File as a 501(c)(3) (subsection 03) with an NTEE code for higher education (B40 to B43, B50) or science and research (H, U). Loaded only when an IRS EO BMF extract is in `data/raw/irs/` (docs/download.md); the IRS publishes it at https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf.
2. `naics_611310`: the NAICS code on most of the employer's LCAs is 611310, Colleges, Universities, and Professional Schools.
3. `name_higher_ed`: the employer's display name contains the word UNIVERSITY or COLLEGE, or "INSTITUTE OF TECHNOLOGY", "SCHOOL OF MEDICINE" or "MEDICAL SCHOOL".

Rules 2 and 3 do not check nonprofit status, so a for-profit college matches them and is not cap-exempt; the page says so next to the flag. Rule 3 is left out when the NAICS code on the LCAs is outside education (61) and health care (62) (for example a software company named "College Pro Painting" or "University Loft"). A research nonprofit that is not in the IRS file and not a university is not flagged at all: a name rule for "research institute" would catch too many companies. /explore gets a filter to hide likely cap-exempt employers. The counts and pay shown for these employers do not change.

**D31. Related entities above FEIN: reviewed by a person, shown apart.** FEIN-level employers stay the source of truth (different FEINs are never merged). `data/parents.csv` groups FEINs under a parent, one row per FEIN, with the evidence (a link to a public filing such as an SEC 10-K exhibit 21 subsidiary list, or the company's own statement), who reviewed it and when. Only rows with `status = reviewed` reach the site; `proposed` rows are for review. A FEIN may belong to one group only; an unknown FEIN is reported and skipped. The site shows a group on its own page and as a "Related entities (reviewed)" section on each member's page: every member keeps its own figures, and the only combined number is a sum of certified LCAs labeled as a sum of separate employers. Nothing on the FEIN-level pages changes. The file ships with one proposed group (Amazon.com Services LLC and Amazon Web Services, Inc.), which needs a review and evidence link before it shows.

**D32. Wage context and places.** The LCA gives, next to the offered wage, the prevailing wage DOL requires for that occupation, area and level (PREVAILING_WAGE, PW_UNIT_OF_PAY). The employer page's per-role table adds the median annualized prevailing wage beside the median offered wage, from the same certified, full-time rows, with the same $15,000 to $1,000,000 validity range applied to the prevailing wage. That is occupation and area context from the files themselves, not an estimate. A metro-area view is not built yet. Worksite cities are free text ("NEW YORK", "NEW YORK CITY", "NYC", "BROOKLYN"), and turning city + state into a metro area needs the Census Bureau's CBSA delineation file and a place-to-county crosswalk (government files, so allowed by rule 1). The plan: map (state, normalized city) to a CBSA through Census places, report the share of certified LCAs that map (as the USCIS join does), keep unmapped cities as their own rows, and store metro counts in place of the state dimension of `lca_cube` so the database does not grow by a second cube (docs/postgres-growth.md). It needs those two downloads first.

## Design

**D33. A calmer, card-based interface that explains itself.** The site moved from a plain document layout to a small design system (`web/app/globals.css`, `web/components/ui.tsx`): neutral surfaces, one blue accent, cards, a sticky header, and a light/dark theme that follows the operating system unless the reader picks one (remembered in that browser only). The aim is that a first-time reader can answer "does this employer file for roles like mine, at what level and pay" without knowing what an LCA is:

- The home page leads with the search, then four headline numbers (each with its source tag) and a three-step "how to read this".
- Employer pages open with four "at a glance" tiles (certified LCAs and median pay for the latest year, the entry-level share, USCIS initial approvals), each with a one-line meaning and its source tag, then sections behind an in-page menu. Each section has a "What does this mean?" disclosure that works without JavaScript.
- A new /guide page defines every term in plain English and says how current the data is.
- "Up to date through" dates are computed from the loaded data (the latest fiscal year and quarter in `lca_year`), never typed into the page, so they cannot go stale after a load.

Charts follow one rule set: thin marks, hairline recessive grids, labels in text colors, one series blue, and wage levels on an ordered single-hue ramp (I light to IV dark in light mode, reversed in dark mode), validated for step contrast against both card surfaces. Every chart has its numbers next to it (a table, a legend with counts, or direct labels), so nothing is only in a tooltip. Axe runs on every page in both themes, including the new guide and the 404 page. No new policy statements were added; the weighted-lottery sentence is still the only one.
