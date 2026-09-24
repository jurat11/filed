# Filed

**Which employers actually file H-1B paperwork for entry-level software and finance roles, and at what pay.**

Filed is a search tool built only from U.S. government records: every Labor Condition Application in the Department of Labor disclosure files for FY2023 to FY2026 (2,136,934 cases) and the USCIS H-1B Employer Data Hub. Type a company to see how many LCAs it filed, for which roles, at what wage level and pay, and how many petitions USCIS approved. Or go the other way: which employers in Virginia file Level I software LCAs.

Every figure on the site carries a source tag (for example "DOL LCA FY2025 Q1-Q4, 728 rows") that links to the file it came from.

Live site: https://filed.vercel.app

## Numbers

| Check | Result | Report |
| --- | --- | --- |
| Raw rows loaded vs rows in the source files | 100% on all 17 DOL files and the USCIS file | `data/manifest.json` |
| Reconcile: certified, withdrawn, denied and filed counts per year, recomputed from the raw xlsx with pandas | **0 differences** across FY2023 to FY2026 | [eval/reconcile.md](eval/reconcile.md) |
| Name normalizer on 60 hand-labeled pairs | precision 87.9%, recall 82.9% | [eval/employers.md](eval/employers.md) |
| Full resolver (FEIN first) on the same pairs | precision 100%, recall 100% | [eval/employers.md](eval/employers.md) |
| USCIS to LCA join, FY2023 | 74.0% of USCIS employers, 85.9% of approvals | [eval/join.md](eval/join.md) |
| Wages excluded as unit errors | 4,570 of 2,136,934 (0.21%) | [eval/wages.md](eval/wages.md) |

## Data sources

- **DOL OFLC LCA disclosure data** (H-1B, H-1B1, E-3), https://www.dol.gov/agencies/eta/foreign-labor/performance. All four quarterly files for FY2023 to FY2025 (they are not cumulative, despite what one might assume) and FY2026 Q3 (October 1, 2025 to June 30, 2026), plus the worksites file for each year.
- **USCIS H-1B Employer Data Hub**, FY2023 file, https://www.uscis.gov/archive/h-1b-employer-data-hub-files. Later years are only published in the hub's interactive viewer.

Definitions are in [docs/definitions.md](docs/definitions.md). Every judgment call (column drift, blank rows, placeholder FEINs, how FY2023 rows without a FEIN are linked) is in [docs/decisions.md](docs/decisions.md).

## How it works

```
data/raw/        DOL xlsx and USCIS csv (not committed) + data/manifest.json (hash, rows)
etl/ingest.py    per-file column maps, row count check against the sheet XML, DuckDB
etl/wages.py     annualize wages, flag unit errors
etl/employers.py group by FEIN, normalize names, record possible links, never merge FEINs
etl/uscis_join.py match USCIS to LCA employers on name + state + last 4 tax ID digits
etl/aggregate.py per employer per fiscal year tables, explore cube, entry-level signal
etl/load.py      COPY into a new Neon schema, swap it in inside one transaction
web/             Next.js 15 server components reading Postgres (pg_trgm search)
```

Run the pipeline (files listed in [docs/download.md](docs/download.md) must be in `data/raw/`):

```bash
uv sync
uv run filed ingest && uv run filed wages && uv run filed resolve
uv run filed uscis && uv run filed aggregate
DATABASE_URL=... uv run filed load
uv run python scripts/reconcile.py
```

## Limitations

- An LCA is filed before a petition. It shows that an employer intended to hire into a role, not that a visa was approved.
- USCIS data lags. The latest USCIS year loaded is FY2023.
- Employers are matched by federal tax ID (FEIN) and name, so one company can be split across legal entities (Amazon.com Services and Amazon Web Services are separate employers) and a few USCIS records fail to join. FY2023 LCA files omit the FEIN, so FY2023 cases are linked by name and state (94.4% linked).
- Cap-exempt employers (universities, some nonprofits) are not flagged separately.
- Internships usually run on CPT and first jobs on OPT, which these files do not cover.

Not legal advice. Past filings do not guarantee future sponsorship.
