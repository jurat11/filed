import duckdb
import pytest

from etl.wages import (
    MULTIPLIERS,
    WAGE_MAX,
    WAGE_MIN,
    add_annual_wages,
    annualize,
    annualize_sql,
    is_valid_annual,
)


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [
        (120000, "Year", 120000),
        (10000, "Month", 120000),
        (4000, "Bi-Weekly", 104000),
        (2000, "Week", 104000),
        (50, "Hour", 104000),
        (50, " hour ", 104000),
        (4000, "BiWeekly", 104000),
    ],
)
def test_annualize_every_unit(value, unit, expected):
    assert annualize(value, unit) == expected


def test_multipliers_are_the_documented_ones():
    assert MULTIPLIERS == {"Year": 1, "Month": 12, "Bi-Weekly": 26, "Week": 52, "Hour": 2080}


@pytest.mark.parametrize(("value", "unit"), [(None, "Year"), (100, None), (100, "Fortnight")])
def test_annualize_unusable(value, unit):
    assert annualize(value, unit) is None


@pytest.mark.parametrize(
    ("annual", "valid"),
    [
        (None, False),
        (WAGE_MIN - 1, False),
        (WAGE_MIN, True),
        (85000, True),
        (WAGE_MAX, True),
        (WAGE_MAX + 1, False),
        (52 * 2080, True),
    ],
)
def test_outlier_rule(annual, valid):
    assert is_valid_annual(annual) is valid


def test_hourly_rate_entered_as_year_is_excluded():
    # $45/hour typed with unit "Year" gives $45 a year: a unit error.
    assert not is_valid_annual(annualize(45, "Year"))


def test_salary_entered_as_hour_is_excluded():
    # $95,000 typed with unit "Hour" gives $197.6M a year: a unit error.
    assert not is_valid_annual(annualize(95000, "Hour"))


@pytest.mark.parametrize(
    ("value", "unit"),
    [
        (120000, "Year"),
        (10000, "Month"),
        (4000, "Bi-Weekly"),
        (2000, "Week"),
        (50, "Hour"),
        (50, " hour "),
        (4000, "BiWeekly"),
        (100, "Fortnight"),
        (None, "Year"),
        (100, None),
    ],
)
def test_sql_matches_python(value, unit):
    con = duckdb.connect()
    got = con.execute(
        f"SELECT {annualize_sql('v', 'u')} FROM (SELECT ?::DOUBLE AS v, ?::VARCHAR AS u)",
        [value, unit],
    ).fetchone()[0]
    assert got == annualize(value, unit)


def test_add_annual_wages_keeps_rows_and_counts_exclusions():
    con = duckdb.connect()
    con.execute("""
        CREATE TABLE lca AS SELECT * FROM (VALUES
            (100000.0, 'Year', 100000.0, 'Year'),
            (50.0, 'Hour', 45.0, 'Hour'),
            (45.0, 'Year', 90000.0, 'Year'),
            (95000.0, 'Hour', 90000.0, 'Year'),
            (NULL, 'Year', NULL, NULL)
        ) t(wage_from, wage_unit, prevailing_wage, pw_unit)
    """)
    stats = add_annual_wages(con)
    assert stats == {"total": 5, "with_wage": 4, "below_min": 1, "above_max": 1, "unusable": 1}
    assert con.execute("SELECT count(*) FROM lca").fetchone()[0] == 5
    valid = [r[0] for r in con.execute("SELECT wage_valid FROM lca").fetchall()]
    assert valid == [True, True, False, False, False]


def test_add_annual_wages_is_rerunnable():
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE lca AS SELECT 100000.0 AS wage_from, 'Year' AS wage_unit, "
        "90000.0 AS prevailing_wage, 'Year' AS pw_unit"
    )
    add_annual_wages(con)
    add_annual_wages(con)
    cols = [r[0] for r in con.execute("DESCRIBE lca").fetchall()]
    assert cols.count("wage_annual") == 1
