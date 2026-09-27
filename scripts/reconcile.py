"""Reconcile Neon against the raw DOL files with a separate code path.

For every loaded fiscal year, count certified, withdrawn and denied cases straight from the
raw xlsx files using pandas (calamine reader), with no DuckDB and no code from etl/, and
compare with the sums of filed.lca_year in Neon. Writes eval/reconcile.md.

The pandas path re-implements the two rules the pipeline applies, independently:
- drop the formatted-but-empty rows at the bottom of a sheet (no CASE_NUMBER);
- within a fiscal year, a case in several quarterly files keeps its latest quarter's row.

A fiscal year present on one side and missing on the other is a difference of the whole
count, never compared against 0. tests/test_reconcile.py runs the same pandas path on the
committed fixture slices against a pipeline built from them, so the check runs in CI too.

Run: uv run python scripts/reconcile.py   (needs DATABASE_URL, or DATABASE_URL_DIRECT)
     uv run python scripts/reconcile.py --against duckdb   (the local build, before a load)
Exits with status 1 when the total difference is not 0. Only the Postgres run writes
eval/reconcile.md; the DuckDB run is the gate the ETL workflow checks before loading.
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

import pandas as pd
import psycopg

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "dol"
OUT = ROOT / "eval" / "reconcile.md"


MEASURES = ["filed", "certified", "withdrawn", "denied"]


def raw_files(
    raw_dir: Path = RAW, pattern: str = "LCA_Disclosure_Data_FY*_Q*.xlsx"
) -> dict[int, list[tuple[int, Path]]]:
    by_year: dict[int, list[tuple[int, Path]]] = {}
    for p in sorted(raw_dir.glob(pattern)):
        fy, q = map(int, re.search(r"FY(\d{4})_Q(\d)", p.name).groups())
        by_year.setdefault(fy, []).append((q, p))
    # FY2026 has a single cumulative Q3 file; earlier years have one file per quarter.
    return by_year


def pandas_counts(files: list[tuple[int, Path]]) -> dict[str, int]:
    frames = []
    for q, p in files:
        cols = ["CASE_NUMBER", "CASE_STATUS"]
        if p.suffix == ".csv":
            df = pd.read_csv(p, usecols=cols, dtype=str)
        else:
            df = pd.read_excel(p, engine="calamine", usecols=cols, dtype=str)
        df = df[df["CASE_NUMBER"].notna() & (df["CASE_NUMBER"].str.strip() != "")]
        df["q"] = q
        frames.append(df)
    df = pd.concat(frames)
    df = df.sort_values("q").drop_duplicates("CASE_NUMBER", keep="last")
    status = df["CASE_STATUS"].str.strip().str.lower().str.replace(r"\s*-\s*", "-", regex=True)
    return {
        "filed": len(df),
        "certified": int((status == "certified").sum()),
        "withdrawn": int(status.isin(["withdrawn", "certified-withdrawn"]).sum()),
        "denied": int((status == "denied").sum()),
    }


def db_counts() -> dict[int, dict[str, int]]:
    url = os.environ.get("DATABASE_URL_DIRECT") or os.environ["DATABASE_URL"]
    with psycopg.connect(url) as pg:
        rows = pg.execute(
            "SELECT fiscal_year, sum(filed), sum(certified), sum(withdrawn), sum(denied) "
            "FROM filed.lca_year GROUP BY 1 ORDER BY 1"
        ).fetchall()
    return {
        r[0]: dict(zip(["filed", "certified", "withdrawn", "denied"], map(int, r[1:]), strict=True))
        for r in rows
    }


DUCKDB = ROOT / "data" / "work" / "filed.duckdb"


def duckdb_counts(path: Path = DUCKDB) -> dict[int, dict[str, int]]:
    import duckdb

    with duckdb.connect(str(path), read_only=True) as con:
        rows = con.execute(
            "SELECT fiscal_year, sum(filed), sum(certified), sum(withdrawn), sum(denied) "
            "FROM agg_lca_year GROUP BY 1 ORDER BY 1"
        ).fetchall()
    return {r[0]: dict(zip(MEASURES, map(int, r[1:]), strict=True)) for r in rows}


def compare(raw: dict[int, dict[str, int]], db: dict[int, dict[str, int]]) -> tuple[list[str], int]:
    """Markdown table rows and the total absolute difference. A year missing on either
    side counts its whole value as the difference."""
    lines, total = [], 0
    fmt = lambda v: "missing" if v is None else f"{v:,}"  # noqa: E731
    for fy in sorted(raw.keys() | db.keys()):
        for k in MEASURES:
            r, d = raw.get(fy, {}).get(k), db.get(fy, {}).get(k)
            diff = (d or 0) - (r or 0) if r is not None and d is not None else (r or d or 0)
            total += abs(diff)
            lines.append(f"| {fy} | {k} | {fmt(r)} | {fmt(d)} | {diff:,} |")
    return lines, total


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--against", choices=["postgres", "duckdb"], default="postgres")
    args = ap.parse_args()
    db = db_counts() if args.against == "postgres" else duckdb_counts()
    raw = {fy: pandas_counts(files) for fy, files in raw_files().items()}
    rows, total_diff = compare(raw, db)
    if args.against == "duckdb":
        print("\n".join(rows))
        print("total difference (raw files vs local DuckDB):", total_diff)
        if total_diff:
            raise SystemExit(1)
        return
    lines = [
        "# Reconcile",
        "",
        "Generated by `uv run python scripts/reconcile.py`. Case counts per fiscal year",
        "computed from the raw DOL xlsx files with pandas (a separate code path from the",
        "DuckDB pipeline), compared with the sums in the Neon database the site reads.",
        "",
        "| Fiscal year | Measure | Raw files (pandas) | Database | Difference |",
        "| --- | --- | ---: | ---: | ---: |",
        *rows,
        "",
        f"**Total absolute difference: {total_diff:,}**",
        "",
    ]
    OUT.write_text("\n".join(lines))
    print("total difference:", total_diff)
    if total_diff:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
