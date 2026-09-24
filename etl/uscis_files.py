"""Read USCIS H-1B Employer Data Hub files in any of the layouts USCIS has used.

Three layouts are recognized from the header row (docs/decisions.md D8, D19):

1. legacy: the archive CSVs through FY2023, with USCIS's own "Initial Approval",
   "Initial Denial", "Continuing Approval" and "Continuing Denial" columns.
2. six_category: one column per decision category and outcome ("New Employment
   Approval", "New Concurrent Denial", ...). This is what the hub's table view shows
   from FY2024, and what "Crosstab" downloads of that view contain.
3. long: a Tableau "Data" download of the same view, one row per measure, with
   "Measure Names" and "Measure Values" columns. It is pivoted back to one row per
   employer line.

Files may be UTF-8 or UTF-16 (Tableau writes UTF-16 with tabs), comma or tab separated,
and numbers may carry thousands separators ("1,234").

Six-category rows are mapped to initial and continuing as in D8:
initial = New Employment + New Concurrent; continuing = the other four. New Employment
is also kept on its own. A blank cell is missing, not zero: a row's initial count is
missing only when every one of its parts is missing.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path

CATEGORIES: dict[str, str] = {
    "new_employment": "New Employment",
    "new_concurrent": "New Concurrent",
    "continuation": "Continuation",
    "change_same_employer": "Change with Same Employer",
    "change_of_employer": "Change of Employer",
    "amended": "Amended",
}
INITIAL = ("new_employment", "new_concurrent")
CONTINUING = ("continuation", "change_same_employer", "change_of_employer", "amended")

# Canonical row, in order. Six-category columns are None for legacy files.
FIELDS: list[str] = [
    "fiscal_year", "employer_name", "state", "city", "zip", "naics", "tax4",
    "initial_approvals", "initial_denials", "continuing_approvals", "continuing_denials",
    *[f"{c}_{o}" for c in CATEGORIES for o in ("approvals", "denials")],
]  # fmt: skip

# Normalized header (lowercase, letters and digits only) -> canonical field.
ID_ALIASES: dict[str, str] = {
    "fiscalyear": "fiscal_year",
    "employer": "employer_name",
    "employername": "employer_name",
    "employerpetitionername": "employer_name",
    "petitionername": "employer_name",
    "state": "state",
    "petitionerstate": "state",
    "employerstate": "state",
    "city": "city",
    "petitionercity": "city",
    "employercity": "city",
    "zip": "zip",
    "zipcode": "zip",
    "petitionerzipcode": "zip",
    "naics": "naics",
    "naicscode": "naics",
    "industrynaicscode": "naics",
    "taxid": "tax4",
}
LEGACY_ALIASES: dict[str, str] = {
    "initialapproval": "initial_approvals",
    "initialdenial": "initial_denials",
    "continuingapproval": "continuing_approvals",
    "continuingdenial": "continuing_denials",
}
SIX_ALIASES: dict[str, str] = {
    re.sub(r"[^a-z0-9]", "", f"{label}{outcome}".lower()): f"{key}_{outcome.lower()}s"
    for key, label in CATEGORIES.items()
    for outcome in ("Approval", "Denial")
}


class UscisFormatError(ValueError):
    pass


@dataclass
class Parsed:
    layout: str  # legacy, six_category or long
    raw_rows: int  # data rows in the file (records after the header, blank lines excluded)
    rows: list[dict]  # canonical rows


def norm_header(h: str) -> str:
    h = re.sub(r"[^a-z0-9]", "", h.lower())
    # Tableau pluralizes measures ("New Employment Approvals").
    return re.sub(r"(approval|denial)s$", r"\1", h)


def read_text(path: Path) -> str:
    data = path.read_bytes()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    return data.decode("utf-8-sig")


def _records(text: str) -> tuple[list[str], list[list[str]]]:
    first = text.split("\n", 1)[0]
    delim = "\t" if first.count("\t") > first.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    header = next(reader)
    body = [r for r in reader if any(c.strip() for c in r)]
    return header, body


def _int(v: str | None) -> int | None:
    if v is None:
        return None
    s = v.strip().replace(",", "")
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def _text(v: str | None) -> str | None:
    s = (v or "").strip()
    return s or None


def _sum(values: list[int | None]) -> int | None:
    known = [v for v in values if v is not None]
    return sum(known) if known else None


def _finish(row: dict, fiscal_year: int | None) -> dict:
    out = dict.fromkeys(FIELDS)
    out.update(row)
    fy = _int(row.get("fiscal_year")) if isinstance(row.get("fiscal_year"), str) else None
    out["fiscal_year"] = fy or fiscal_year
    if out["fiscal_year"] is None:
        raise UscisFormatError("no fiscal year in the file or its registry entry")
    out["employer_name"] = _text(row.get("employer_name"))
    out["state"] = (_text(row.get("state")) or "").upper() or None
    out["city"] = (_text(row.get("city")) or "").upper() or None
    out["zip"] = _text(row.get("zip"))
    out["naics"] = _text(row.get("naics"))
    tax = _text(row.get("tax4"))
    out["tax4"] = tax.zfill(4) if tax else None
    return out


def _six_to_initial(out: dict) -> dict:
    for outcome in ("approvals", "denials"):
        out[f"initial_{outcome}"] = _sum([out[f"{c}_{outcome}"] for c in INITIAL])
        out[f"continuing_{outcome}"] = _sum([out[f"{c}_{outcome}"] for c in CONTINUING])
    return out


def parse(path: Path, fiscal_year: int | None = None) -> Parsed:
    header, body = _records(read_text(path))
    cols = [norm_header(h) for h in header]
    ids = {i: ID_ALIASES[c] for i, c in enumerate(cols) if c in ID_ALIASES}
    if "employer_name" not in ids.values():
        raise UscisFormatError(f"{path.name}: no employer name column in {header}")

    if "measurenames" in cols and "measurevalues" in cols:
        return _parse_long(path, cols, ids, body, fiscal_year)

    legacy = {i: LEGACY_ALIASES[c] for i, c in enumerate(cols) if c in LEGACY_ALIASES}
    six = {i: SIX_ALIASES[c] for i, c in enumerate(cols) if c in SIX_ALIASES}
    if six and len(six) != len(SIX_ALIASES):
        missing = sorted(set(SIX_ALIASES.values()) - set(six.values()))
        raise UscisFormatError(f"{path.name}: six-category layout lacks {missing}")
    if legacy and len(legacy) != len(LEGACY_ALIASES):
        raise UscisFormatError(f"{path.name}: legacy layout lacks some of {LEGACY_ALIASES}")
    if not (six or legacy):
        raise UscisFormatError(f"{path.name}: no approval columns recognized in {header}")

    rows = []
    for rec in body:
        r = {f: rec[i] if i < len(rec) else None for i, f in ids.items()}
        out = _finish(r, fiscal_year)
        for i, f in {**legacy, **six}.items():
            out[f] = _int(rec[i] if i < len(rec) else None)
        rows.append(_six_to_initial(out) if six else out)
    return Parsed("six_category" if six else "legacy", len(body), rows)


def _parse_long(path, cols, ids, body, fiscal_year) -> Parsed:
    name_i, value_i = cols.index("measurenames"), cols.index("measurevalues")
    grouped: dict[tuple, dict] = {}
    for rec in body:
        measure = norm_header(rec[name_i])
        if measure not in SIX_ALIASES:
            raise UscisFormatError(f"{path.name}: unknown measure {rec[name_i]!r}")
        key = tuple(rec[i] for i in sorted(ids))
        row = grouped.setdefault(key, {f: rec[i] for i, f in ids.items()})
        field = SIX_ALIASES[measure]
        if field in row:
            raise UscisFormatError(f"{path.name}: {rec[name_i]!r} repeated for {key}")
        row[field] = _int(rec[value_i])
    rows = []
    for r in grouped.values():
        out = _finish(r, fiscal_year)
        for f in SIX_ALIASES.values():
            out[f] = r.get(f)
        rows.append(_six_to_initial(out))
    return Parsed("long", len(body), rows)
