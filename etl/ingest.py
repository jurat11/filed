"""Load raw DOL files into DuckDB with the per-year column map and a row count check.

For each raw xlsx:
1. Count data rows straight from the sheet XML (etl/xlsx_count.py). This is the raw count.
2. Read the sheet with DuckDB (all columns as text) and stage it to Parquet, dropping the
   formatted-but-empty rows DOL leaves at the bottom of the sheet.
3. Assert staged rows == raw data rows, and record both in data/manifest.json.

Then build the canonical tables:
- lca: one row per case per fiscal year, typed, in the canonical schema. If a case appears
  in two quarterly files of the same fiscal year (decided, then withdrawn later), the row
  from the later quarter is kept, since the status reflects the last significant event.
  The number of superseded rows is recorded.
- lca_worksites: one row per worksite per case.
"""

from __future__ import annotations

import logging
from pathlib import Path

import duckdb

from etl import manifest
from etl.columns import (
    CANONICAL,
    LAYOUT_URLS,
    RAW_FILES,
    STATE_CODES,
    WORKSITE_CANONICAL,
    RawFile,
    column_map,
    missing_columns,
)
from etl.xlsx_count import count_rows, read_header

log = logging.getLogger(__name__)

ROOT = manifest.ROOT
RAW_DOL = manifest.RAW / "dol"
WORK = ROOT / "data" / "work"
STAGED = WORK / "staged"
DB_PATH = WORK / "filed.duckdb"

STATUSES = {
    "CERTIFIED": "Certified",
    "CERTIFIED-WITHDRAWN": "Certified - Withdrawn",
    "WITHDRAWN": "Withdrawn",
    "DENIED": "Denied",
}


class RowCountError(AssertionError):
    pass


def connect(path: Path | str = DB_PATH) -> duckdb.DuckDBPyConnection:
    if isinstance(path, Path):
        path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(path))
    con.execute("SET enable_progress_bar = false")
    con.execute("INSTALL excel; LOAD excel")
    return con


def stage_file(con: duckdb.DuckDBPyConnection, rf: RawFile, raw_dir: Path = RAW_DOL) -> dict:
    """Stage one raw xlsx to Parquet and check its row count. Returns the manifest entry."""
    src = raw_dir / rf.name
    out = STAGED / (src.stem + ".parquet")
    STAGED.mkdir(parents=True, exist_ok=True)

    header = read_header(src)
    missing = missing_columns(rf.kind, rf.fiscal_year, rf.quarter, header)
    if missing:
        raise KeyError(f"{rf.name}: header lacks mapped columns {missing}")
    counted = count_rows(src)
    con.execute(
        f"""COPY (
              SELECT * FROM read_xlsx('{src}', all_varchar = true, stop_at_empty = false)
              WHERE CASE_NUMBER IS NOT NULL
            ) TO '{out}' (FORMAT parquet)"""
    )
    staged = con.execute(f"SELECT count(*) FROM '{out}'").fetchone()[0]
    if staged != counted.data_rows:
        raise RowCountError(f"{rf.name}: raw sheet has {counted.data_rows} rows, loaded {staged}")
    log.info("%s: %d rows (%d blank rows dropped)", rf.name, staged, counted.blank_rows)
    return manifest.record(
        src,
        rf.url,
        kind=rf.kind,
        fiscal_year=rf.fiscal_year,
        quarter=rf.quarter,
        cumulative=rf.cumulative,
        raw_rows=counted.data_rows,
        blank_rows_in_sheet=counted.blank_rows,
        loaded_rows=staged,
        staged=out.relative_to(ROOT).as_posix(),
    )


def _text(col: str | None) -> str:
    return f"nullif(trim({col}), '')" if col else "NULL"


def _date(col: str | None) -> str:
    # Dates arrive as Excel serial numbers ("45839") or, rarely, as ISO text.
    if not col:
        return "CAST(NULL AS DATE)"
    t = f"trim({col})"
    return (
        f"CASE WHEN regexp_full_match({t}, '\\d+(\\.\\d+)?') "
        f"THEN DATE '1899-12-30' + CAST(floor(CAST({t} AS DOUBLE)) AS INTEGER) "
        f"ELSE TRY_CAST(left({t}, 10) AS DATE) END"
    )


def _money(col: str | None) -> str:
    return f"TRY_CAST(regexp_replace(trim({col}), '[$,]', '', 'g') AS DOUBLE)" if col else "NULL"


def _yn(col: str | None) -> str:
    if not col:
        return "CAST(NULL AS BOOLEAN)"
    # The layout says Y/N; the files say Yes/No (and N/A). Both are accepted.
    v = f"upper(trim({col}))"
    return f"CASE WHEN {v} IN ('Y', 'YES') THEN true WHEN {v} IN ('N', 'NO') THEN false END"


def _fein(col: str | None) -> str:
    # Keep only digits; a valid FEIN has 9. Anything else is NULL and resolves by name.
    if not col:
        return "CAST(NULL AS VARCHAR)"
    d = f"regexp_replace({col}, '[^0-9]', '', 'g')"
    return f"CASE WHEN length({d}) = 9 THEN left({d}, 2) || '-' || right({d}, 7) END"


def _state(col: str | None) -> str:
    """USPS code from either a code ("MN") or a full name ("MINNESOTA")."""
    if not col:
        return "NULL"
    v = f"upper(nullif(trim({col}), ''))"
    names = " ".join(f"WHEN '{k}' THEN '{c}'" for k, c in STATE_CODES.items())
    return f"CASE WHEN length({v}) = 2 THEN {v} ELSE (CASE {v} {names} END) END"


def _quoted(rf: RawFile) -> dict[str, str | None]:
    """Column map with every raw name quoted, since some contain hyphens."""
    m = column_map(rf.kind, rf.fiscal_year, rf.quarter)
    return {k: f'"{v}"' if v else None for k, v in m.items()}


def lca_select(rf: RawFile, source: str) -> str:
    m = _quoted(rf)
    status = f"upper(regexp_replace(trim({m['case_status']}), '\\s*-\\s*', '-', 'g'))"
    status_case = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in STATUSES.items())
    level = f"upper(trim({m['pw_wage_level']}))"
    exprs = {
        "case_number": _text(m["case_number"]),
        "fiscal_year": str(rf.fiscal_year),
        "case_status": f"CASE {status} {status_case} ELSE 'UNKNOWN:' || {status} END",
        "received_date": _date(m["received_date"]),
        "decision_date": _date(m["decision_date"]),
        "visa_class": _text(m["visa_class"]),
        "employer_name": _text(m["employer_name"]),
        "employer_fein": _fein(m["employer_fein"]),
        "employer_city": f"upper({_text(m['employer_city'])})",
        "employer_state": _state(m["employer_state"]),
        "naics_code": _text(m["naics_code"]),
        "job_title": _text(m["job_title"]),
        "soc_code": f"regexp_extract({m['soc_code']}, '(\\d{{2}})-?(\\d{{4}})', ['a', 'b'])",
        "soc_title": _text(m["soc_title"]),
        "full_time": _yn(m["full_time"]),
        "worksite_city": f"upper({_text(m['worksite_city'])})",
        "worksite_state": _state(m["worksite_state"]),
        "wage_from": _money(m["wage_from"]),
        "wage_to": _money(m["wage_to"]),
        "wage_unit": _text(m["wage_unit"]),
        "prevailing_wage": _money(m["prevailing_wage"]),
        "pw_unit": _text(m["pw_unit"]),
        "pw_wage_level": f"CASE WHEN {level} IN ('I','II','III','IV') THEN {level} END",
        "h1b_dependent": _yn(m["h1b_dependent"]),
        "willful_violator": _yn(m["willful_violator"]),
        "total_workers": f"TRY_CAST(trim({m['total_workers']}) AS INTEGER)",
    }
    # soc_code: regexp_extract with names returns a struct; flatten to "15-1252".
    exprs["soc_code"] = (
        f"CASE WHEN {exprs['soc_code']}.a <> '' "
        f"THEN {exprs['soc_code']}.a || '-' || {exprs['soc_code']}.b END"
    )
    cols = ",\n  ".join(f"{exprs[c]} AS {c}" for c in CANONICAL)
    return (
        f"SELECT\n  {cols},\n  '{rf.name}' AS source_file,\n  {rf.quarter} AS source_quarter,\n"
        f"  {_text(m['employer_name'])} AS employer_name_raw\nFROM {source}"
    )


def worksite_select(rf: RawFile, source: str) -> str:
    m = _quoted(rf)
    level = f"upper(trim({m['pw_wage_level']}))"
    exprs = {
        "case_number": _text(m["case_number"]),
        "fiscal_year": str(rf.fiscal_year),
        "worksite_workers": f"TRY_CAST(trim({m['worksite_workers']}) AS INTEGER)",
        "worksite_city": f"upper({_text(m['worksite_city'])})",
        "worksite_state": _state(m["worksite_state"]),
        "wage_from": _money(m["wage_from"]),
        "wage_unit": _text(m["wage_unit"]),
        "pw_wage_level": f"CASE WHEN {level} IN ('I','II','III','IV') THEN {level} END",
    }
    cols = ",\n  ".join(f"{exprs[c]} AS {c}" for c in WORKSITE_CANONICAL)
    return f"SELECT\n  {cols},\n  '{rf.name}' AS source_file\nFROM {source}"


def build_canonical(con: duckdb.DuckDBPyConnection, files: list[RawFile], staged: dict) -> dict:
    """Create lca_all (every staged row), lca (deduped within fiscal year) and lca_worksites."""
    lca_parts = [lca_select(rf, f"'{staged[rf.name]}'") for rf in files if rf.kind == "lca"]
    ws_parts = [
        worksite_select(rf, f"'{staged[rf.name]}'") for rf in files if rf.kind == "lca_worksites"
    ]
    con.execute("CREATE OR REPLACE TABLE lca_all AS " + "\nUNION ALL BY NAME\n".join(lca_parts))
    unknown = con.execute(
        "SELECT case_status, count(*) FROM lca_all WHERE case_status LIKE 'UNKNOWN:%' GROUP BY 1"
    ).fetchall()
    if unknown:
        raise ValueError(f"unmapped CASE_STATUS values: {unknown}")
    con.execute("""
        CREATE OR REPLACE TABLE lca AS
        SELECT * EXCLUDE (rn) FROM (
            SELECT *, row_number() OVER (
                PARTITION BY fiscal_year, case_number
                ORDER BY source_quarter DESC, decision_date DESC NULLS LAST
            ) AS rn
            FROM lca_all
        ) WHERE rn = 1
    """)
    if ws_parts:
        con.execute(
            "CREATE OR REPLACE TABLE lca_worksites AS " + "\nUNION ALL BY NAME\n".join(ws_parts)
        )
    stats = {
        "lca_all": con.execute("SELECT count(*) FROM lca_all").fetchone()[0],
        "lca": con.execute("SELECT count(*) FROM lca").fetchone()[0],
    }
    stats["superseded"] = stats["lca_all"] - stats["lca"]
    log.info(
        "canonical: %d rows staged, %d cases kept, %d superseded by a later quarter",
        stats["lca_all"],
        stats["lca"],
        stats["superseded"],
    )
    return stats


def record_layouts() -> None:
    for name, url in LAYOUT_URLS.items():
        p = RAW_DOL / name
        if p.exists():
            manifest.record(p, url, kind="record_layout")


def run(files: list[RawFile] | None = None, restage: bool = False) -> dict:
    files = files or RAW_FILES
    con = connect()
    staged = {}
    m = manifest.load()["files"]
    for rf in files:
        entry = m.get(f"dol/{rf.name}")
        out = STAGED / (Path(rf.name).stem + ".parquet")
        if restage or not entry or not out.exists():
            entry = stage_file(con, rf)
        staged[rf.name] = ROOT / entry["staged"]
    record_layouts()
    stats = build_canonical(con, files, staged)
    record_coverage(con, files)
    return stats


def record_coverage(con: duckdb.DuckDBPyConnection, files: list[RawFile]) -> None:
    """Write each LCA file's actual DECISION_DATE range to the manifest.

    Coverage is measured, not assumed: FY2023 Q2 turned out to hold Q1 and Q2 together,
    while the other FY2023 to FY2025 files each hold one quarter.
    """
    m = manifest.load()
    rows = con.execute(
        "SELECT source_file, min(decision_date), max(decision_date) FROM lca_all GROUP BY 1"
    ).fetchall()
    for name, lo, hi in rows:
        entry = m["files"][f"dol/{name}"]
        entry["decision_date_min"] = lo.isoformat()
        entry["decision_date_max"] = hi.isoformat()
    manifest.save(m)
