# Operations

How the data gets from DOL and USCIS to the live site, and what each piece needs.

## Workflows

| Workflow | When | What |
| --- | --- | --- |
| `ci` | every push and pull request | ruff, pytest (with a throwaway Postgres), tsc, next lint, Vitest, Playwright on a database seeded from the fixtures |
| `release-watch` | Mondays, or by hand | reads the DOL performance page and the USCIS archive page in a headless browser and opens an issue listing files newer than the loaded ones |
| `etl` | the 3rd of each month, or by hand | restores `data/raw/` from the raw store, runs every step whose inputs changed, reconciles, loads Neon, revalidates the site |

The `etl` workflow stops before Neon is touched if any row count check fails (ingest, USCIS
parsing), or if the reconcile of the raw files against the local build is not 0. After the
load it reconciles against Neon too. Reports (`eval/`, `data/manifest.json`) are uploaded
as a run artifact. If nothing changed since the last load, `filed all` sees the same
fingerprint in `filed.meta` and skips the load and the revalidation.

## Secrets (Settings > Secrets and variables > Actions)

| Secret | Used by | Value |
| --- | --- | --- |
| `DATABASE_URL` | etl | Neon connection string (the direct, non-pooled one) |
| `FILED_SITE_URL` | etl | `https://filed-gray.vercel.app` |
| `REVALIDATE_SECRET` | etl, and Vercel | a long random string, the same in both places |
| `FILED_STORE_URL` | etl | `s3://<bucket>/<prefix>` (docs/raw-store.md) |
| `FILED_STORE_ENDPOINT` | etl | S3 endpoint for non-AWS storage, else leave unset |
| `FILED_STORE_REGION` | etl | optional |
| `FILED_STORE_ACCESS_KEY_ID` | etl | access key for the bucket |
| `FILED_STORE_SECRET_ACCESS_KEY` | etl | its secret |

Vercel (Project > Settings > Environment Variables): `DATABASE_URL` (already set),
`REVALIDATE_SECRET` (same value as the Actions secret), optionally `NEXT_PUBLIC_SITE_URL`.

## A new DOL quarter

1. The `release-watch` issue lists the file. Download it in a browser to `data/raw/dol/`.
2. Add its `RawFile` in `etl/columns.py` (and a column map if it starts a new fiscal
   year). `uv run filed status` shows which steps will run.
3. `uv run filed all --no-load` restages only the changed files; then
   `uv run python scripts/reconcile.py --against duckdb` must print 0.
4. `uv run filed push-raw`, commit `data/manifest.json`, the code and `eval/`, open a PR.
5. After merge, run the `etl` workflow (or wait for the monthly run).
