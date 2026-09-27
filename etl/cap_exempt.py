"""The "likely cap-exempt" flag (docs/decisions.md D30). A stated rule, never a fact.

Rules, first match wins:
1. irs_nonprofit   FEIN in the IRS EO BMF as a 501(c)(3) with a higher education or
                   research NTEE code (only when an extract is in data/raw/irs/)
2. naics_611310    the NAICS code on most of the employer's LCAs is 611310
3. name_higher_ed  UNIVERSITY / COLLEGE / INSTITUTE OF TECHNOLOGY / SCHOOL OF MEDICINE /
                   MEDICAL SCHOOL in the name, and an education (61) or health care (62)
                   NAICS code
"""

from __future__ import annotations

import csv
import logging
import re
from pathlib import Path

import duckdb

from etl import manifest

log = logging.getLogger(__name__)

RAW_IRS = manifest.RAW / "irs"
IRS_URL = "https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf"

# NTEE: B40-B43 higher education, B50 graduate and professional schools,
# H medical research, U science and technology research.
NTEE_RE = r"^(B4[0-3]|B50|H|U)"
NAME_RE = r"\b(UNIVERSITY|COLLEGE)\b|INSTITUTE OF TECHNOLOGY|SCHOOL OF MEDICINE|MEDICAL SCHOOL"

RULES = {
    "irs_nonprofit": "IRS lists this FEIN as a 501(c)(3) in higher education or research",
    "naics_611310": "most of its LCAs give NAICS 611310 (colleges and universities)",
    "name_higher_ed": "its name suggests a college or university, with an education or "
    "health care NAICS code",
}


def name_rule(name: str | None, naics: str | None) -> bool:
    """Python twin of the SQL name rule, for tests."""
    if not name or not naics or naics[:2] not in ("61", "62"):
        return False
    return re.search(NAME_RE, name.upper()) is not None


def irs_files(raw_dir: Path = RAW_IRS) -> list[Path]:
    return sorted(raw_dir.glob("eo*.csv")) if raw_dir.exists() else []


def load_irs(con: duckdb.DuckDBPyConnection, paths: list[Path], record: bool = True) -> int:
    """irs_eo (fein, subsection, ntee) from EO BMF CSV extracts; empty when there are none."""
    con.execute("CREATE OR REPLACE TABLE irs_eo (fein VARCHAR, subsection VARCHAR, ntee VARCHAR)")
    rows = []
    for p in paths:
        n = 0
        with p.open(newline="", encoding="utf-8-sig", errors="replace") as f:
            for r in csv.DictReader(f):
                n += 1
                ein = re.sub(r"\D", "", r.get("EIN") or "")
                if len(ein) == 9:
                    fein = f"{ein[:2]}-{ein[2:]}"
                    sub = (r.get("SUBSECTION") or "").strip()
                    rows.append((fein, sub, (r.get("NTEE_CD") or "").strip()))
        if record:
            manifest.record(p, IRS_URL, kind="irs_eo_bmf", raw_rows=n, loaded_rows=n)
    if rows:
        con.executemany("INSERT INTO irs_eo VALUES (?, ?, ?)", rows)
    return len(rows)


def rule_sql(name: str, naics: str, fein: str) -> str:
    """CASE expression giving the rule code for an employer row (NULL when none fires)."""
    return f"""(CASE
        WHEN {fein} IN (SELECT fein FROM irs_eo WHERE subsection = '03'
                        AND regexp_matches(ntee, '{NTEE_RE}')) THEN 'irs_nonprofit'
        WHEN {naics} = '611310' THEN 'naics_611310'
        WHEN left({naics}, 2) IN ('61', '62')
             AND regexp_matches(upper({name}), '{NAME_RE}') THEN 'name_higher_ed'
    END)"""
