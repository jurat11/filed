"""data/manifest.json: per raw file, the source URL, download date, hash and row counts."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "manifest.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"files": {}}


def save(m: dict) -> None:
    m["files"] = dict(sorted(m["files"].items()))
    MANIFEST.write_text(json.dumps(m, indent=2) + "\n")


def record(path: Path, source_url: str, **fields) -> dict:
    """Add or update the entry for a raw file. The download date is the file's mtime."""
    m = load()
    key = path.relative_to(RAW).as_posix()
    entry = m["files"].get(key, {})
    digest = sha256(path)
    if entry.get("sha256") != digest:
        entry = {}
    entry.update(
        name=path.name,
        source_url=source_url,
        downloaded=dt.date.fromtimestamp(path.stat().st_mtime).isoformat(),
        sha256=digest,
        bytes=path.stat().st_size,
        **fields,
    )
    m["files"][key] = entry
    save(m)
    return entry
