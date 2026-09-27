"""The reconcile's pandas path, run on the fixture slices against a pipeline built from them."""

from pathlib import Path

from etl import seed
from scripts.reconcile import compare, pandas_counts, raw_files

FIX = Path(__file__).parent / "fixtures"


def test_fixture_pipeline_reconciles_to_zero():
    con = seed.build()
    db = {
        fy: dict(zip(["filed", "certified", "withdrawn", "denied"], vals, strict=True))
        for fy, *vals in con.execute(
            "SELECT fiscal_year, sum(filed), sum(certified), sum(withdrawn), sum(denied) "
            "FROM agg_lca_year GROUP BY 1"
        ).fetchall()
    }
    files = raw_files(FIX, "LCA_Disclosure_Data_FY*_Q*.csv")
    raw = {fy: pandas_counts(f) for fy, f in files.items()}
    assert set(raw) == {2023, 2024, 2025, 2026}
    rows, total = compare(raw, db)
    assert total == 0, "\n".join(rows)


def test_year_missing_from_database_is_a_difference_not_zero():
    raw = {2025: {"filed": 10, "certified": 8, "withdrawn": 1, "denied": 1}}
    rows, total = compare(raw, {})
    assert total == 20
    assert rows[0] == "| 2025 | filed | 10 | missing | 10 |"


def test_year_only_in_database_is_a_difference():
    db = {2027: {"filed": 3, "certified": 3, "withdrawn": 0, "denied": 0}}
    rows, total = compare({}, db)
    assert total == 6
    assert rows[0] == "| 2027 | filed | missing | 3 | 3 |"
