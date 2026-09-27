"""Build the whole pipeline from the committed test fixtures, for tests and CI.

The fixtures in tests/fixtures are real rows sampled from every DOL file (about 800
cases, 580 employers) plus synthetic USCIS files (tests/fixtures/uscis/README.md). This
runs the same ingest, wage, resolve, USCIS and aggregate code as a real build, in a
DuckDB of its own, without touching data/ or data/manifest.json:

    uv run filed seed            # build and load into DATABASE_URL (a throwaway database)

The site's end-to-end tests run against a Postgres seeded this way. Nothing here is
ever loaded into the production database: `filed seed` refuses a URL that points at Neon.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import tempfile
from pathlib import Path

import duckdb

from etl import aggregate, employers, ingest, load, uscis_join, wages
from etl.columns import RAW_FILES

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"
USCIS_FIX = FIX / "uscis"


def fixture_csv(name: str) -> Path:
    return FIX / (Path(name).stem + ".csv")


def uscis_fixture_files() -> list[tuple[uscis_join.UscisFile, Path]]:
    return uscis_join.present(uscis_join.FILES, USCIS_FIX)


def build(con: duckdb.DuckDBPyConnection | None = None) -> duckdb.DuckDBPyConnection:
    """Run every ETL step on the fixtures and return the DuckDB connection."""
    con = con or duckdb.connect()
    stage = Path(tempfile.mkdtemp(prefix="filed-seed-"))
    staged = {}
    for rf in RAW_FILES:
        out = stage / (Path(rf.name).stem + ".parquet")
        con.execute(
            f"COPY (SELECT * FROM read_csv('{fixture_csv(rf.name)}', all_varchar = true, "
            f"header = true)) TO '{out}' (FORMAT parquet)"
        )
        staged[rf.name] = out
    ingest.build_canonical(con, RAW_FILES, staged)
    wages.add_annual_wages(con)
    employers.resolve(con)
    uscis_join.load_raw(con, uscis_fixture_files(), record=False)
    uscis_join.match(con)
    # A test-only parent map with one "reviewed" group, so the group page can be tested.
    aggregate.build(con, irs_paths=[], parents=FIX / "parents.csv")
    return con


def manifest_files() -> dict:
    """Manifest-shaped entries for the fixture files, for the sources table."""
    out = {}
    today = dt.date.today().isoformat()
    for p in sorted([*FIX.glob("*.csv"), *USCIS_FIX.glob("*.csv")]):
        rows = uscis_join.csv_rows(p)
        fy = next((int(t[:4]) for t in p.stem.replace("FY_", "FY").split("FY")[1:]), None)
        if p.parent == USCIS_FIX:
            fy = int(p.stem[-4:])
        out[p.name] = {
            "name": p.name,
            "kind": "uscis" if p.parent == USCIS_FIX else "lca_fixture",
            "fiscal_year": fy,
            "quarter": None,
            "source_url": "https://github.com/jurat11/filed/tree/main/tests/fixtures",
            "downloaded": today,
            "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            "bytes": p.stat().st_size,
            "raw_rows": rows,
            "loaded_rows": rows,
        }
    return out


def run() -> dict:
    url = load.database_url()
    if "neon.tech" in url:
        raise SystemExit("refusing to load fixture data into a Neon database")
    return load.load(build(), url, files=manifest_files())
