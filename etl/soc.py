"""SOC code to role group map. This is the one place to edit the grouping.

Keys are exact 7-character SOC codes ("15-1252") or a prefix ending in "x"
("17-2xxx" matches every code starting with "17-2"). Anything unmatched is "Other".
"""

from __future__ import annotations

import re

ROLE_GROUPS: dict[str, list[str]] = {
    "Software engineering": ["15-1252", "15-1253", "15-1256"],
    "Data and analytics": ["15-2051", "15-2041", "13-1161"],
    "Finance": ["13-2051", "13-2052", "13-2011", "13-2099"],
    "Quant and actuarial": ["15-2011", "15-2031"],
    "IT and systems": ["15-1211", "15-1212", "15-1244", "15-1299"],
    "Engineering": ["17-2xxx"],
}

OTHER = "Other"
ALL_GROUPS: list[str] = [*ROLE_GROUPS, OTHER]

_SOC_RE = re.compile(r"(\d{2})-?(\d{4})")


def clean_soc(raw: str | None) -> str | None:
    """Return the 7-character SOC code ("15-1252") from values like "15-1252.00" or "151252"."""
    if raw is None:
        return None
    m = _SOC_RE.search(str(raw))
    return f"{m.group(1)}-{m.group(2)}" if m else None


def role_group(soc: str | None) -> str:
    code = clean_soc(soc)
    if code is None:
        return OTHER
    for group, patterns in ROLE_GROUPS.items():
        for p in patterns:
            if p.endswith("x"):
                if code.startswith(p.rstrip("x")):
                    return group
            elif code == p:
                return group
    return OTHER


def role_group_sql(col: str) -> str:
    """DuckDB CASE expression equivalent to role_group() for an already-cleaned SOC column."""
    whens = []
    for group, patterns in ROLE_GROUPS.items():
        conds = []
        for p in patterns:
            if p.endswith("x"):
                conds.append(f"starts_with({col}, '{p.rstrip('x')}')")
            else:
                conds.append(f"{col} = '{p}'")
        whens.append(f"WHEN {' OR '.join(conds)} THEN '{group}'")
    return f"(CASE {' '.join(whens)} ELSE '{OTHER}' END)"
