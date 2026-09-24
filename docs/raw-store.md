# Raw data store

`data/raw/` (about 1.8 GB) is not in git, and dol.gov does not serve its files to scripts,
so a copy of every raw file is kept in an S3-compatible bucket, addressed by content:

    s3://<bucket>/<prefix>/sha256/<first two hex digits>/<sha256>

The SHA-256 is the one `data/manifest.json` records for each file, so the manifest is the
index: `filed fetch` downloads every file the manifest lists, checks its hash, and writes
it under its name in `data/raw/`. The same bytes are stored once, a corrupted download is
refused, and the bucket never has to be listed.

## Setting it up (needs a person: an account and a bucket)

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
   everything.

`FILED_STORE_URL=file:///path/to/dir` works too, for a backup on a local disk.
