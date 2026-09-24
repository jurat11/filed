"""Content-addressed store for the raw files, so data/raw/ can be rebuilt anywhere.

Every raw file is stored once under its SHA-256, the hash data/manifest.json already
records for it:

    <store>/sha256/<first 2 hex digits>/<sha256>

A file's name and place in data/raw/ come from the manifest, not from the store, so the
store needs no index and a re-downloaded file with the same bytes is never stored twice.
`filed fetch` restores data/raw/ from the manifest and checks every hash;
`filed push-raw` uploads local raw files that the store does not have yet.

Configuration (environment, never committed):

    FILED_STORE_URL       s3://bucket/prefix   or   file:///absolute/path
    FILED_STORE_ENDPOINT  S3 endpoint for non-AWS services (R2, B2, MinIO); optional
    FILED_STORE_REGION    optional
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   read by boto3 for s3:// stores

s3:// needs the optional dependency: `uv sync --extra store`. See docs/raw-store.md.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from etl import manifest

log = logging.getLogger(__name__)


class StoreError(RuntimeError):
    pass


def key(sha: str) -> str:
    if len(sha) != 64 or not all(c in "0123456789abcdef" for c in sha):
        raise StoreError(f"not a SHA-256: {sha!r}")
    return f"sha256/{sha[:2]}/{sha}"


class LocalStore:
    """A directory. For tests, and for a backup on a local disk or NAS."""

    def __init__(self, root: Path):
        self.root = root

    def has(self, sha: str) -> bool:
        return (self.root / key(sha)).exists()

    def get(self, sha: str, dest: Path) -> None:
        shutil.copyfile(self.root / key(sha), dest)

    def put(self, path: Path, sha: str) -> None:
        target = self.root / key(sha)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".part")
        shutil.copyfile(path, tmp)
        tmp.replace(target)


class S3Store:
    """Any S3-compatible bucket, through boto3."""

    def __init__(self, bucket: str, prefix: str):
        try:
            import boto3
        except ImportError as e:  # pragma: no cover
            raise StoreError("s3:// stores need boto3: uv sync --extra store") from e
        self.bucket, self.prefix = bucket, prefix.strip("/")
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.environ.get("FILED_STORE_ENDPOINT") or None,
            region_name=os.environ.get("FILED_STORE_REGION") or None,
        )

    def _k(self, sha: str) -> str:
        return f"{self.prefix}/{key(sha)}" if self.prefix else key(sha)

    def has(self, sha: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.s3.head_object(Bucket=self.bucket, Key=self._k(sha))
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def get(self, sha: str, dest: Path) -> None:
        self.s3.download_file(self.bucket, self._k(sha), str(dest))

    def put(self, path: Path, sha: str) -> None:
        self.s3.upload_file(
            str(path), self.bucket, self._k(sha), ExtraArgs={"Metadata": {"sha256": sha}}
        )


def open_store(url: str | None = None):
    url = url or os.environ.get("FILED_STORE_URL")
    if not url:
        raise StoreError("FILED_STORE_URL is not set (s3://bucket/prefix or file:///path)")
    u = urlparse(url)
    if u.scheme == "file":
        return LocalStore(Path(u.path))
    if u.scheme == "s3":
        return S3Store(u.netloc, u.path)
    raise StoreError(f"unsupported store URL {url!r}")


def _entries(files: dict | None) -> dict:
    return manifest.load()["files"] if files is None else files


def fetch(store=None, raw: Path | None = None, files: dict | None = None) -> dict:
    """Make data/raw/ match the manifest: download every file that is missing or whose
    hash differs, verifying the hash of each download before it replaces anything."""
    store = store or open_store()
    raw = raw or manifest.RAW
    done = {"present": 0, "downloaded": 0, "missing_from_store": []}
    for rel, e in sorted(_entries(files).items()):
        dest = raw / rel
        if dest.exists() and manifest.sha256(dest) == e["sha256"]:
            done["present"] += 1
            continue
        if not store.has(e["sha256"]):
            done["missing_from_store"].append(rel)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as t:
            tmp = Path(t.name)
        try:
            store.get(e["sha256"], tmp)
            got = manifest.sha256(tmp)
            if got != e["sha256"]:
                raise StoreError(f"{rel}: store returned {got}, manifest says {e['sha256']}")
            tmp.replace(dest)
            # Keep the manifest's download date as the file's date (manifest.record reads it).
            day = dt.date.fromisoformat(e["downloaded"])
            ts = time.mktime(day.timetuple()) + 12 * 3600
            os.utime(dest, (ts, ts))
        finally:
            tmp.unlink(missing_ok=True)
        done["downloaded"] += 1
        log.info("fetched %s", rel)
    if done["missing_from_store"]:
        raise StoreError(f"not in the store: {done['missing_from_store']} (run filed push-raw)")
    return done


def push(store=None, raw: Path | None = None, files: dict | None = None) -> dict:
    """Upload every local raw file listed in the manifest that the store lacks. A local
    file whose hash no longer matches the manifest is refused: re-run the step that
    records it first, so the store never holds bytes the manifest does not describe."""
    store = store or open_store()
    raw = raw or manifest.RAW
    done = {"uploaded": 0, "already_stored": 0, "not_local": []}
    for rel, e in sorted(_entries(files).items()):
        src = raw / rel
        if not src.exists():
            done["not_local"].append(rel)
            continue
        sha = manifest.sha256(src)
        if sha != e["sha256"]:
            raise StoreError(f"{rel}: local file hash {sha} differs from the manifest")
        if store.has(sha):
            done["already_stored"] += 1
            continue
        store.put(src, sha)
        done["uploaded"] += 1
        log.info("stored %s as %s", rel, key(sha))
    return done
