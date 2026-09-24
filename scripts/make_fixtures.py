"""Write trimmed fixtures from the staged raw files: one CSV per raw file.

About 200 rows per fiscal year: 50 per quarterly file for FY2023 to FY2025, 200 for the
FY2026 file, and 50 per worksites file. Only the columns that file's column map uses
are kept, under their raw names, so no contact names, phone numbers or emails from the
disclosure files are committed. The full header of every raw file is saved to
tests/fixtures/headers.json so the tests can check each map against it.

The sample is deterministic: one row for every case status and wage unit present,
then rows ordered by a hash of CASE_NUMBER.
"""

from __future__ import annotations

import json
from pathlib import Path

import duckdb

from etl import manifest
from etl.columns import RAW_FILES, column_map
from etl.xlsx_count import read_header

ROOT = manifest.ROOT
FIX = ROOT / "tests" / "fixtures"


def fixture_path(name: str) -> Path:
    return FIX / (Path(name).stem + ".csv")


def main() -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    files = manifest.load()["files"]
    headers = {rf.name: read_header(manifest.RAW / "dol" / rf.name) for rf in RAW_FILES}
    (FIX / "headers.json").write_text(json.dumps(headers, indent=1) + "\n")

    for rf in RAW_FILES:
        staged = ROOT / files[f"dol/{rf.name}"]["staged"]
        cols = sorted({c for c in column_map(rf.kind, rf.fiscal_year, rf.quarter).values() if c})
        sel = ", ".join(f'"{c}"' for c in cols)
        con.execute(f"CREATE OR REPLACE TABLE src AS SELECT {sel} FROM '{staged}'")
        if rf.kind == "lca":
            n = 200 if rf.cumulative and rf.fiscal_year == 2026 else 50
            con.execute(f"""
                CREATE OR REPLACE TABLE pick AS
                SELECT * EXCLUDE (prio) FROM (
                    SELECT *, 0 AS prio FROM src QUALIFY row_number() OVER (
                        PARTITION BY CASE_STATUS ORDER BY hash(CASE_NUMBER)) = 1
                    UNION ALL
                    SELECT *, 0 AS prio FROM src QUALIFY row_number() OVER (
                        PARTITION BY WAGE_UNIT_OF_PAY ORDER BY hash(CASE_NUMBER)) = 1
                    UNION ALL
                    (SELECT *, 1 AS prio FROM src ORDER BY hash(CASE_NUMBER) LIMIT {n})
                )
                QUALIFY row_number() OVER (PARTITION BY CASE_NUMBER ORDER BY prio) = 1
                ORDER BY prio, hash(CASE_NUMBER)
                LIMIT {n}
            """)
        else:
            con.execute(
                "CREATE OR REPLACE TABLE pick AS SELECT * FROM src "
                "ORDER BY hash(CASE_NUMBER) LIMIT 50"
            )
        out = fixture_path(rf.name)
        con.execute(f"COPY (SELECT * FROM pick ORDER BY CASE_NUMBER) TO '{out}' (HEADER)")
        print(out.relative_to(ROOT), con.execute("SELECT count(*) FROM pick").fetchone()[0])


if __name__ == "__main__":
    main()
