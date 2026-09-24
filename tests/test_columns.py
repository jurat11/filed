"""Column map tests on trimmed fixture slices of every raw file."""

import datetime as dt
import json
import re
from pathlib import Path

import duckdb
import pytest

from etl.columns import (
    CANONICAL,
    RAW_FILES,
    WORKSITE_CANONICAL,
    column_map,
    missing_columns,
)
from etl.ingest import lca_select, worksite_select

FIX = Path(__file__).parent / "fixtures"
HEADERS = json.loads((FIX / "headers.json").read_text())
LCA_FILES = [rf for rf in RAW_FILES if rf.kind == "lca"]
WS_FILES = [rf for rf in RAW_FILES if rf.kind == "lca_worksites"]


def _fixture(rf):
    return FIX / (Path(rf.name).stem + ".csv")


def _canonical(rf):
    con = duckdb.connect()
    src = f"read_csv('{_fixture(rf)}', all_varchar = true, header = true)"
    sql = lca_select(rf, src) if rf.kind == "lca" else worksite_select(rf, src)
    rel = con.sql(sql)
    return rel.columns, rel.fetchall()


@pytest.mark.parametrize("rf", RAW_FILES, ids=lambda rf: rf.name)
def test_map_matches_real_header(rf):
    assert missing_columns(rf.kind, rf.fiscal_year, rf.quarter, HEADERS[rf.name]) == []


@pytest.mark.parametrize("rf", RAW_FILES, ids=lambda rf: rf.name)
def test_fixture_exists_and_is_trimmed(rf):
    with _fixture(rf).open() as f:
        header = f.readline().strip().split(",")
        n = sum(1 for _ in f)
    used = {c for c in column_map(rf.kind, rf.fiscal_year, rf.quarter).values() if c}
    assert set(header) == used
    assert 40 <= n <= 200


def test_fein_only_missing_in_fy2023():
    for rf in LCA_FILES:
        m = column_map(rf.kind, rf.fiscal_year, rf.quarter)
        assert (m["employer_fein"] is None) == (rf.fiscal_year == 2023)


def test_fy2025_q1_hyphenated_dependency_column():
    assert column_map("lca", 2025, 1)["h1b_dependent"] == "H-1B_DEPENDENT"
    assert column_map("lca", 2025, 2)["h1b_dependent"] == "H_1B_DEPENDENT"


@pytest.mark.parametrize("rf", LCA_FILES, ids=lambda rf: rf.name)
def test_lca_fixture_maps_to_canonical(rf):
    cols, rows = _canonical(rf)
    assert cols[: len(CANONICAL)] == CANONICAL
    r = [dict(zip(cols, row, strict=True)) for row in rows]
    n = len(r)
    assert n >= 40

    fy_start = dt.date(rf.fiscal_year - 1, 10, 1)
    fy_end = dt.date(rf.fiscal_year, 9, 30)
    for row in r:
        assert row["fiscal_year"] == rf.fiscal_year
        assert re.fullmatch(r"I-\d{3}-\d{5}-\d{6}", row["case_number"])
        assert row["case_status"] in {"Certified", "Certified - Withdrawn", "Withdrawn", "Denied"}
        assert fy_start <= row["decision_date"] <= fy_end
        assert row["received_date"] <= row["decision_date"]
        assert row["visa_class"] in {"H-1B", "E-3 Australian", "H-1B1 Chile", "H-1B1 Singapore"}
        assert row["soc_code"] is None or re.fullmatch(r"\d{2}-\d{4}", row["soc_code"])
        assert row["pw_wage_level"] in {None, "I", "II", "III", "IV"}
        # A handful of real rows have no unit; they get no annual wage.
        assert row["wage_unit"] in {None, "Year", "Month", "Bi-Weekly", "Week", "Hour"}
        assert row["employer_state"] is None or len(row["employer_state"]) == 2
        if rf.fiscal_year == 2023:
            assert row["employer_fein"] is None
        else:
            assert row["employer_fein"] is None or re.fullmatch(
                r"\d{2}-\d{7}", row["employer_fein"]
            )

    # Fields that should almost always be filled in.
    for col in ["employer_name", "job_title", "soc_code", "wage_from", "wage_unit", "full_time"]:
        assert sum(row[col] is not None for row in r) >= 0.95 * n, col
    assert sum(row["h1b_dependent"] is not None for row in r) >= 0.8 * n
    if rf.fiscal_year != 2023:
        assert sum(row["employer_fein"] is not None for row in r) >= 0.95 * n


@pytest.mark.parametrize("rf", WS_FILES, ids=lambda rf: rf.name)
def test_worksite_fixture_maps_to_canonical(rf):
    cols, rows = _canonical(rf)
    assert cols[: len(WORKSITE_CANONICAL)] == WORKSITE_CANONICAL
    for row in rows:
        d = dict(zip(cols, row, strict=True))
        assert d["fiscal_year"] == rf.fiscal_year
        assert re.fullmatch(r"I-\d{3}-\d{5}-\d{6}", d["case_number"])
        assert d["worksite_state"] is None or len(d["worksite_state"]) == 2
