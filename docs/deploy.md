# Deploying the site

The site runs on Vercel and reads Neon Postgres. Neither needs a server kept up by hand:

- **Vercel** serves pages from serverless functions and its CDN, on demand, at any hour.
  A push to `main` builds and deploys production automatically (Git integration).
- **Neon** (free plan) suspends its compute after a few minutes without queries and
  resumes on the next one, so the first visit after a quiet spell waits a moment longer.
  Pages cache their queries for up to a day (`unstable_cache`, tag `filed`), so most visits
  do not reach Neon at all.
- **Data** stays current through the `etl` workflow (monthly, docs/operations.md) and the
  `release-watch` workflow, which opens an issue when DOL or USCIS publish a newer file.

## The build refuses stale data

`pnpm build` runs `web/scripts/check-schema.mjs` before `next build`. It reads
`schema_version` from `filed.meta` and stops the build when the database was loaded by an
older ETL than the code needs (`SCHEMA_VERSION` in `etl/load.py`, currently 2). On Vercel a
failed build leaves the previous deployment serving, so merging code that needs new tables
never puts broken pages live. The build also stops if `DATABASE_URL` is not set for that
Vercel environment, or Neon cannot be reached. Local builds without `DATABASE_URL` skip it.

When a change adds a table or column a web query reads, bump both constants (a test checks
they match).

## First deploy of the rebuild (PRs 1 to 7)

The live site runs the code on `main` against data loaded by that code. The new code reads
tables the old load does not have, and the old code's search reads a column the new load
drops, so the order matters: merge, load, redeploy.

Nothing large is uploaded anywhere in any of this. Vercel only ever receives the
repository (a few MB of code); the 1.8 GB of raw government files are inputs to the ETL and
never leave the machine that reads them; Neon receives the aggregate tables the site
queries (about 229 MB with indexes).

### Steps (no raw files needed on your machine)

1. **Vercel settings** (Project > Settings > Environment Variables, Production and Preview):
   - `DATABASE_URL`: already set. The pooled Neon string (host with `-pooler`) suits
     serverless functions.
   - `REVALIDATE_SECRET`: a new random value, for example from `openssl rand -hex 32`.
2. **GitHub Actions secrets** (Settings > Secrets and variables > Actions):
   `DATABASE_URL` (the **direct**, non-pooled Neon string), `FILED_SITE_URL`
   (`https://filed-gray.vercel.app`) and the same `REVALIDATE_SECRET`. Nothing else: the
   `etl` workflow downloads the raw files from dol.gov and uscis.gov itself.
3. **Merge the stack into `main` as one change.** Each PR is based on the previous phase,
   so merge from the top down, which does not touch `main` until the last step:
   PR 7 into its base, then 6, 5, 4, 3, 2, and finally PR 1 into `main` (merge commits, in
   the GitHub web page, so the commit author is you; see "Preview deployments" below).
   Vercel then builds `main`. That build **fails at check-schema, as intended**: Neon still
   holds the old load, and the old deployment keeps serving.
4. **Load Neon from GitHub Actions**: Actions > `etl` > Run workflow, on `main`, with
   "Load Neon" checked. It downloads the 26 raw files (about 6 seconds on a runner,
   each hash checked against `data/manifest.json`), rebuilds every step, reconciles
   against the raw files, loads Neon in one transaction and calls `/api/revalidate`. It
   stops before Neon if any row count or the reconcile disagrees.
5. **Redeploy**: Vercel > Deployments > the failed `main` deployment > Redeploy.
   (Or add a Deploy Hook for `main` under Settings > Git and `curl -X POST <hook url>`.)
   Between the load and the end of this build, about two minutes, the old site's search
   box errors; employer, Explore and Sources pages keep working.
6. **Check**: the page footer says "DOL LCA data through" the latest quarter, `/sources`
   lists the loaded files, and a search returns employers.

If step 4 fails, nothing changed: the load swaps the new schema in only after every row
count matches, inside one transaction.

### The same thing from your own machine

If you would rather run it locally, and you have `data/raw/` (or let `filed fetch` download
it), step 4 becomes:

```sh
git checkout main && git pull
uv sync
export DATABASE_URL='postgresql://...'   # Neon direct (non-pooled) connection string
uv run filed fetch                       # only if data/raw/ is missing or incomplete
uv run filed all                         # rebuilds what changed, loads, swaps the schema
uv run python scripts/reconcile.py       # must print 0 differences
```

Either way the bytes that cross the network are the aggregates going into Neon. What the
ETL needs beyond that is CPU: reading the xlsx files takes minutes, on a runner or a laptop.

## Preview deployments

On the Vercel Hobby plan, a deployment is only built for commits whose author is a member
of the Vercel account. Commits made in a Claude Code session are authored by Claude, so
their preview deployments fail within seconds; that is the red "Vercel" status on those
PRs, and GitHub Actions CI is the check that matters there. Merges you make in the GitHub
web page are authored by you, so `main` deploys normally. To get previews for such PRs,
either redeploy them from the Vercel dashboard, or move to a Vercel Pro team and add the
author, or turn previews off (Settings > Git > Ignored Build Step:
`[ "$VERCEL_ENV" != "production" ]` exits 0 for previews, which skips them).

## Later deploys

- **Code only** (no `SCHEMA_VERSION` change): merge the PR; Vercel deploys `main`.
- **Code that needs new tables**: same order as above. Merge (the build stops), run the
  `etl` workflow or `uv run filed all`, then redeploy.
- **Data only** (a new DOL quarter): the `etl` workflow loads Neon and calls
  `/api/revalidate`, so pages refresh without a deploy. It runs monthly on its own, and
  `release-watch` opens an issue when a newer file is published.

## What keeps running without anyone

| Piece | Who runs it | Cost |
| --- | --- | --- |
| The site | Vercel serverless functions and CDN, on demand | Hobby plan |
| The database | Neon, which suspends when idle and resumes on the next query | free plan, 512 MB |
| The data refresh | the `etl` workflow, monthly, downloading from the agencies | free (public repo) |
| Watching for new releases | the `release-watch` workflow, weekly, opens an issue | free |

The only thing that needs a person is a DOL release whose columns changed, which needs a
column map in `etl/columns.py` and a reviewed PR (docs/operations.md).
