"""Related entities above FEIN from the hand-reviewed data/parents.csv (decisions D31).

One row per FEIN: group_slug, group_name, fein, status (proposed or reviewed),
evidence_url, reviewed_by, reviewed_on, note. Only reviewed rows are used. A FEIN may be
in one group only. FEIN-level employers are unchanged; groups are shown on their own.
"""

from __future__ import annotations

import csv
import logging
import re
from pathlib import Path

import duckdb

from etl import manifest

log = logging.getLogger(__name__)

PARENTS = manifest.ROOT / "data" / "parents.csv"
COLUMNS = [
    "group_slug", "group_name", "fein", "status", "evidence_url", "reviewed_by",
    "reviewed_on", "note",
]  # fmt: skip
STATUSES = {"proposed", "reviewed"}


class ParentMapError(ValueError):
    pass


def read(path: Path = PARENTS) -> list[dict]:
    """Rows of the parent map, validated. Raises on a malformed file."""
    if not path.exists():
        return []
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            raise ParentMapError(f"{path.name}: columns must be {COLUMNS}, got {reader.fieldnames}")
        rows = list(reader)
    seen: dict[str, str] = {}
    for i, r in enumerate(rows, start=2):
        where = f"{path.name} line {i}"
        if r["status"] not in STATUSES:
            raise ParentMapError(f"{where}: status must be one of {sorted(STATUSES)}")
        if not re.fullmatch(r"\d{2}-\d{7}", r["fein"]):
            raise ParentMapError(f"{where}: FEIN must look like 12-3456789")
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", r["group_slug"]):
            raise ParentMapError(f"{where}: group_slug must be lowercase words joined by '-'")
        if r["fein"] in seen:
            raise ParentMapError(f"{where}: FEIN {r['fein']} is already in {seen[r['fein']]}")
        seen[r["fein"]] = r["group_slug"]
        if r["status"] == "reviewed" and not (
            r["evidence_url"].startswith("https://") and r["reviewed_by"] and r["reviewed_on"]
        ):
            raise ParentMapError(
                f"{where}: a reviewed row needs evidence_url, reviewed_by and reviewed_on"
            )
    return rows


def build(con: duckdb.DuckDBPyConnection, path: Path = PARENTS) -> dict:
    """agg_groups: reviewed groups joined to FEIN employers. Unknown FEINs are reported."""
    rows = [r for r in read(path) if r["status"] == "reviewed"]
    con.execute(
        "CREATE OR REPLACE TABLE parent_map (" + ", ".join(f"{c} VARCHAR" for c in COLUMNS) + ")"
    )
    if rows:
        con.executemany(
            f"INSERT INTO parent_map VALUES ({', '.join('?' * len(COLUMNS))})",
            [[r[c] for c in COLUMNS] for r in rows],
        )
    con.execute("""
        CREATE OR REPLACE TABLE agg_groups AS
        SELECT p.group_slug, p.group_name, e.employer_id, p.fein, p.evidence_url,
               p.reviewed_on, p.note
        FROM parent_map p JOIN employers e ON e.fein = p.fein
    """)
    unknown = [r[0] for r in con.execute(
        "SELECT fein FROM parent_map WHERE fein NOT IN (SELECT fein FROM employers "
        "WHERE fein IS NOT NULL) ORDER BY 1"
    ).fetchall()]  # fmt: skip
    if unknown:
        log.warning("parents.csv: FEINs with no LCA employer, skipped: %s", unknown)
    # A group of one is not a group.
    con.execute("""
        DELETE FROM agg_groups WHERE group_slug IN
            (SELECT group_slug FROM agg_groups GROUP BY 1 HAVING count(*) < 2)
    """)
    n = con.execute("SELECT count(DISTINCT group_slug), count(*) FROM agg_groups").fetchone()
    return {"groups": n[0], "members": n[1], "unknown_feins": unknown}
