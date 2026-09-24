"""Per-file column maps from DOL raw headers to the canonical schema.

Written from the record layout PDFs for FY2023 Q4, FY2024 Q4, FY2025 Q4 and FY2026 Q3,
then checked against the actual header row of every file (the layouts write
"H-1B_DEPENDENT" but the files use "H_1B_DEPENDENT"). ingest.py refuses to load a file
whose header lacks a mapped column, so drift fails loudly instead of loading nulls.

Differences found between years:
- FY2023: EMPLOYER_FEIN is not published (the layout lists it as PII). It maps to NULL.
- FY2023 to FY2025 Q1: LAWFIRM_BUSINESS_FEIN absent (not used here).
- FY2025 Q1 only: the dependency column is "H-1B_DEPENDENT"; every other file uses
  "H_1B_DEPENDENT". Maps are therefore keyed by (fiscal year, quarter).
- The layouts write "EMPLOYER_ADDRESS 1"; the headers say EMPLOYER_ADDRESS1.
"""

from __future__ import annotations

from dataclasses import dataclass

# Canonical LCA case schema, in order. Types are applied in ingest.py.
CANONICAL: list[str] = [
    "case_number",
    "fiscal_year",
    "case_status",
    "received_date",
    "decision_date",
    "visa_class",
    "employer_name",
    "employer_fein",
    "employer_city",
    "employer_state",
    "naics_code",
    "job_title",
    "soc_code",
    "soc_title",
    "full_time",
    "worksite_city",
    "worksite_state",
    "wage_from",
    "wage_to",
    "wage_unit",
    "prevailing_wage",
    "pw_unit",
    "pw_wage_level",
    "h1b_dependent",
    "willful_violator",
    "total_workers",
]

# fiscal_year comes from the file, not a column.
_BASE: dict[str, str | None] = {
    "case_number": "CASE_NUMBER",
    "case_status": "CASE_STATUS",
    "received_date": "RECEIVED_DATE",
    "decision_date": "DECISION_DATE",
    "visa_class": "VISA_CLASS",
    "employer_name": "EMPLOYER_NAME",
    "employer_fein": "EMPLOYER_FEIN",
    "employer_city": "EMPLOYER_CITY",
    "employer_state": "EMPLOYER_STATE",
    "naics_code": "NAICS_CODE",
    "job_title": "JOB_TITLE",
    "soc_code": "SOC_CODE",
    "soc_title": "SOC_TITLE",
    "full_time": "FULL_TIME_POSITION",
    "worksite_city": "WORKSITE_CITY",
    "worksite_state": "WORKSITE_STATE",
    "wage_from": "WAGE_RATE_OF_PAY_FROM",
    "wage_to": "WAGE_RATE_OF_PAY_TO",
    "wage_unit": "WAGE_UNIT_OF_PAY",
    "prevailing_wage": "PREVAILING_WAGE",
    "pw_unit": "PW_UNIT_OF_PAY",
    "pw_wage_level": "PW_WAGE_LEVEL",
    "h1b_dependent": "H_1B_DEPENDENT",
    "willful_violator": "WILLFUL_VIOLATOR",
    "total_workers": "TOTAL_WORKER_POSITIONS",
}

_YEAR_MAPS: dict[int, dict[str, str | None]] = {
    2023: {**_BASE, "employer_fein": None},
    2024: dict(_BASE),
    2025: dict(_BASE),
    2026: dict(_BASE),
}

# Per-file overrides on top of the year map, keyed by (fiscal year, quarter).
_FILE_OVERRIDES: dict[tuple[int, int], dict[str, str | None]] = {
    (2025, 1): {"h1b_dependent": "H-1B_DEPENDENT"},
}

LCA_COLUMN_MAPS: dict[tuple[int, int], dict[str, str | None]] = {
    (fy, q): {**_YEAR_MAPS[fy], **_FILE_OVERRIDES.get((fy, q), {})}
    for fy in _YEAR_MAPS
    for q in (1, 2, 3, 4)
}

# Worksites file: one row per worksite on a case, same layout in every year.
WORKSITE_CANONICAL: list[str] = [
    "case_number",
    "fiscal_year",
    "worksite_workers",
    "worksite_city",
    "worksite_state",
    "wage_from",
    "wage_unit",
    "pw_wage_level",
]

_WS_BASE: dict[str, str | None] = {
    "case_number": "CASE_NUMBER",
    "worksite_workers": "WORKSITE_WORKERS",
    "worksite_city": "WORKSITE_CITY",
    "worksite_state": "WORKSITE_STATE",
    "wage_from": "WAGE_RATE_OF_PAY_FROM",
    "wage_unit": "WAGE_UNIT_OF_PAY",
    "pw_wage_level": "PW_WAGE_LEVEL",
}

WORKSITE_COLUMN_MAPS: dict[tuple[int, int], dict[str, str | None]] = {
    k: dict(_WS_BASE) for k in LCA_COLUMN_MAPS
}


# The worksites files spell states out ("MINNESOTA"); the main files use USPS codes.
STATE_CODES: dict[str, str] = {
    "ALABAMA": "AL", "ALASKA": "AK", "AMERICAN SAMOA": "AS", "ARIZONA": "AZ",
    "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT",
    "DELAWARE": "DE", "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA",
    "GUAM": "GU", "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN",
    "IOWA": "IA", "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME",
    "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE",
    "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
    "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
    "NORTHERN MARIANA ISLANDS": "MP", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR",
    "PENNSYLVANIA": "PA", "PUERTO RICO": "PR", "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX",
    "UTAH": "UT", "VERMONT": "VT", "VIRGIN ISLANDS": "VI", "VIRGINIA": "VA",
    "WASHINGTON": "WA", "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
}  # fmt: skip


@dataclass(frozen=True)
class RawFile:
    name: str
    kind: str  # "lca" or "lca_worksites"
    fiscal_year: int
    quarter: int
    url: str
    # True when the file holds the whole fiscal year to date; False when it holds one quarter.
    cumulative: bool


_DOL = "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/"


def _q(fy: int, q: int) -> RawFile:
    name = f"LCA_Disclosure_Data_FY{fy}_Q{q}.xlsx"
    return RawFile(name, "lca", fy, q, _DOL + name, cumulative=(fy, q) == (2023, 2))


# FY2023 to FY2025 releases each hold one quarter of decisions, except FY2023 Q2, which
# holds Q1 and Q2 (checked against the DECISION_DATE range of every file), so all four
# are loaded and cases are deduplicated within a fiscal year. FY2026 Q3 holds
# October 1, 2025 to June 30, 2026. See docs/decisions.md D1.
RAW_FILES: list[RawFile] = [
    *[_q(fy, q) for fy in (2023, 2024, 2025) for q in (1, 2, 3, 4)],
    RawFile(
        "LCA_Disclosure_Data_FY2026_Q3.xlsx",
        "lca",
        2026,
        3,
        "https://www.dol.gov//media/LCA_Disclosure_Data_FY2026_Q3.xlsx",
        cumulative=True,
    ),
    *[
        RawFile(
            f"LCA_Worksites_FY{fy}_Q4.xlsx",
            "lca_worksites",
            fy,
            4,
            f"{_DOL}LCA_Worksites_FY{fy}_Q4.xlsx",
            cumulative=True,
        )
        for fy in (2023, 2024, 2025)
    ],
    RawFile(
        "LCA_Worksites_FY_2026_Q3.xlsx",
        "lca_worksites",
        2026,
        3,
        _DOL + "FY26Q3/LCA_Worksites_FY_2026_Q3.xlsx",
        cumulative=True,
    ),
]

LAYOUT_URLS: dict[str, str] = {
    "LCA_Record_Layout_FY2023_Q4.pdf": _DOL + "LCA_Record_Layout_FY2023_Q4.pdf",
    "LCA_Record_Layout_FY2024_Q4.pdf": _DOL + "LCA_Record_Layout_FY2024_Q4.pdf",
    "LCA_Record_Layout_FY2025_Q4.pdf": _DOL + "LCA_Record_Layout_FY2025_Q4.pdf",
    "LCA_Record_Layout_FY2026_Q3.pdf": _DOL + "FY26Q3/LCA_Record_Layout_FY2026_Q3.pdf",
    "LCA_Worksite_Record_Layout_FY2023_Q4.pdf": _DOL + "LCA_Worksite_Record_Layout_FY2023_Q4.pdf",
    "LCA_Worksites_Record_Layout_FY2024_Q4.pdf": _DOL + "LCA_Worksites_Record_Layout_FY2024_Q4.pdf",
    "LCA_Worksites_Record_Layout_FY2025_Q4.pdf": _DOL + "LCA_Worksites_Record_Layout_FY2025_Q4.pdf",
    "LCA_Worksites_Record_Layout_FY2026_Q3.pdf": _DOL
    + "FY26Q3/LCA_Worksites_Record_Layout_FY2026_Q3.pdf",
}


def column_map(kind: str, fiscal_year: int, quarter: int) -> dict[str, str | None]:
    maps = LCA_COLUMN_MAPS if kind == "lca" else WORKSITE_COLUMN_MAPS
    return maps[(fiscal_year, quarter)]


def missing_columns(kind: str, fiscal_year: int, quarter: int, header: list[str]) -> list[str]:
    """Raw columns the map needs that the file's header does not have."""
    have = set(header)
    m = column_map(kind, fiscal_year, quarter)
    return [raw for raw in m.values() if raw and raw not in have]
