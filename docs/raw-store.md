# Raw data store

`data/raw/` (about 1.8 GB) is not in git, so `filed fetch` rebuilds it from
`data/manifest.json`: for every file the manifest lists it downloads the bytes, checks the
SHA-256 the manifest records, and only then writes the file under its name in `data/raw/`.
A download whose hash differs is refused, so nothing the manifest does not describe can
reach the site.

Where the bytes come from is `FILED_STORE_URL`:

| `FILED_STORE_URL` | Where the files come from | Needs |
| --- | --- | --- |
| `source:` (the default in the `etl` workflow) | dol.gov and uscis.gov, each file's `source_url` in the manifest | nothing |
| `s3://<bucket>/<prefix>` | a content-addressed copy in an S3-compatible bucket | an account, a bucket, two keys |
| `file:///path` | a directory, for a backup on a local disk or a NAS | a disk |

`filed fetch` then also downloads any file the code declares but the manifest does not
list yet, which is how a new quarterly DOL release arrives (`filed ingest` records its
hash and row count, and the reconcile has to pass before it reaches the site).

## source: the agencies themselves (no account, nothing to upload)

Measured on a GitHub runner on September 27, 2026: all 26 files, 1.74 GB, downloaded in
6 seconds, and every SHA-256 matched the manifest. So the `etl` workflow rebuilds the data
without anything from a laptop, and no bucket has to exist (docs/decisions.md D35).

One thing to know: the agencies' CDN (Akamai) answers **403 to a request that claims to be
a browser** but sends none of a browser's other headers, and serves a plainly identified
client normally. `etl/store.py` therefore sends no `User-Agent` header at all. Do not add
one, and do not "fix" a 403 by spoofing a browser.

A bucket copy is still worth having for one reason: an agency can remove or replace a file,
and then `source:` can no longer rebuild that release. The bucket keeps the exact bytes the
manifest pins.

## The bucket backend (needs a person: an account and a bucket)

    s3://<bucket>/<prefix>/sha256/<first two hex digits>/<sha256>

The SHA-256 is the one the manifest records, so the manifest is the index: the same bytes
are stored once, and the bucket never has to be listed.

1. Create a **private** bucket with any S3-compatible provider (AWS S3, Cloudflare R2,
   Backblaze B2, or a MinIO server). About 2 GB now, plus one fiscal year of files
   (roughly 0.5 GB) a year.
2. Create an access key limited to that bucket with read and write access (the workflow
   only reads; `push-raw` from a laptop writes).
3. On the machine that has `data/raw/` today:

   ```bash
   uv sync --extra store
   export FILED_STORE_URL=s3://<bucket>/filed-raw
   export FILED_STORE_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # not for AWS
   export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
   uv run filed push-raw        # uploads what the store lacks; refuses files whose hash
                                # differs from the manifest
   ```

4. Add the `FILED_STORE_*` secrets listed in docs/operations.md, then run the `etl`
   workflow by hand with "Load Neon" unchecked to check that `filed fetch` restores
   everything. With no `FILED_STORE_URL` secret the workflow uses `source:`.

`FILED_STORE_URL=file:///path/to/dir` works too, for a backup on a local disk.
