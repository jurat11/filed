"""Which pipeline steps need to run: input fingerprints recorded in data/manifest.json.

Each step's fingerprint is a hash of
- the source code of the modules that implement it,
- the SHA-256 of the raw files it reads (ingest: the DOL files; uscis: the USCIS files),
- the fingerprint of the step before it.

So a change anywhere upstream changes every fingerprint downstream. After a step
finishes, its fingerprint is written to the manifest under "steps"; `filed all` skips a
step whose fingerprint is unchanged and whose output tables exist in the local DuckDB. A
step that fails records nothing, so the next run starts again from it (resumable).

ingest also records a fingerprint per fiscal year (that year's raw files plus the ingest
code), so a new quarterly DOL release restages and rebuilds only its fiscal year. The
later steps are global (employer resolution links FY2023 rows through FEINs seen in later
years), and they are fast next to reading the xlsx files. See docs/decisions.md D26.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

import duckdb

from etl import manifest

ETL = Path(__file__).resolve().parent
ORDER = ["ingest", "wages", "resolve", "uscis", "aggregate", "load"]

CODE: dict[str, list[str]] = {
    "ingest": ["ingest.py", "columns.py", "xlsx_count.py"],
    "wages": ["wages.py"],
    "resolve": ["employers.py", "names.py"],
    "uscis": ["uscis_join.py", "uscis_files.py", "names.py", "employers.py"],
    "aggregate": ["aggregate.py", "soc.py", "cap_exempt.py", "groups.py"],
    "load": ["load.py"],
}

# Tables a step leaves in DuckDB; if one is missing the step reruns whatever the manifest
# says (for example on a fresh clone, where the committed manifest has fingerprints but
# there is no local DuckDB yet). load's output is in Postgres and is checked there.
OUTPUTS: dict[str, list[str]] = {
    "ingest": ["lca_all", "lca"],
    "wages": ["lca"],
    "resolve": ["employers", "employer_aliases", "possible_links", "name_norm"],
    "uscis": ["uscis_raw", "uscis_year", "uscis_employer", "uscis_only"],
    "aggregate": ["agg_employers", "agg_lca_year", "agg_lca_cube", "agg_entry_signal"],
    "load": [],
}

HASH_CACHE = manifest.ROOT / "data" / "work" / "hash_cache.json"


def _h(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode())
        h.update(b"\0")
    return h.hexdigest()


def code_hash(step: str) -> str:
    return _h(*[f"{f}:{hashlib.sha256((ETL / f).read_bytes()).hexdigest()}" for f in CODE[step]])


def file_sha(path: Path) -> str:
    """SHA-256 of a raw file, cached by size and mtime so unchanged gigabytes are not
    re-read on every run."""
    cache = json.loads(HASH_CACHE.read_text()) if HASH_CACHE.exists() else {}
    st = path.stat()
    key = str(path.resolve())
    hit = cache.get(key)
    if hit and hit["size"] == st.st_size and hit["mtime_ns"] == st.st_mtime_ns:
        return hit["sha256"]
    digest = manifest.sha256(path)
    cache[key] = {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "sha256": digest}
    HASH_CACHE.parent.mkdir(parents=True, exist_ok=True)
    HASH_CACHE.write_text(json.dumps(cache, indent=1))
    return digest


def raw_inputs(step: str) -> dict[str, str]:
    """name -> sha256 of the raw files a step reads directly."""
    if step == "ingest":
        from etl.columns import RAW_FILES

        paths = [manifest.RAW / "dol" / rf.name for rf in RAW_FILES]
    elif step == "uscis":
        from etl import uscis_join

        paths = [p for _, p in uscis_join.present()]
    elif step == "aggregate":
        from etl import cap_exempt, groups

        paths = [*cap_exempt.irs_files(), groups.PARENTS]
    else:
        return {}
    return {p.name: file_sha(p) for p in paths if p.exists()}


def year_fingerprints() -> dict[str, str]:
    """ingest fingerprint per fiscal year: that year's raw files and the ingest code."""
    from etl.columns import RAW_FILES

    code = code_hash("ingest")
    out: dict[str, list[str]] = {}
    for rf in RAW_FILES:
        p = manifest.RAW / "dol" / rf.name
        sha = file_sha(p) if p.exists() else "missing"
        out.setdefault(str(rf.fiscal_year), []).append(f"{rf.name}:{sha}")
    return {fy: _h(code, *sorted(parts)) for fy, parts in out.items()}


def fingerprints() -> dict[str, str]:
    """Current fingerprint of every step, chained in pipeline order."""
    fps, prev = {}, ""
    for step in ORDER:
        raw = raw_inputs(step)
        files = [f"{k}:{v}" for k, v in sorted(raw.items())]
        fps[step] = prev = _h(step, prev, code_hash(step), *files)
    return fps


def recorded() -> dict:
    return manifest.load().get("steps", {})


def outputs_exist(con: duckdb.DuckDBPyConnection, step: str) -> bool:
    tables = con.execute("SELECT table_name FROM information_schema.tables").fetchall()
    have = {r[0] for r in tables}
    return all(t in have for t in OUTPUTS[step])


def is_current(con: duckdb.DuckDBPyConnection, step: str, fp: str) -> bool:
    return recorded().get(step, {}).get("fingerprint") == fp and outputs_exist(con, step)


def mark_done(step: str, fp: str, **extra) -> None:
    m = manifest.load()
    steps = m.setdefault("steps", {})
    changed = steps.get(step, {}).get("fingerprint") != fp
    steps[step] = {
        "fingerprint": fp,
        "completed_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        **extra,
    }
    if changed:
        # Everything after this step was built from other inputs.
        for later in ORDER[ORDER.index(step) + 1 :]:
            steps.pop(later, None)
    m["steps"] = {k: steps[k] for k in ORDER if k in steps}
    manifest.save(m)
