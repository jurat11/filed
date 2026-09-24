import csv
from pathlib import Path

import duckdb
import pytest

from etl.employers import resolve, slugify
from etl.names import normalize_name

GOLDEN = Path(__file__).parent / "golden_employers.csv"


def golden():
    with GOLDEN.open() as f:
        return list(csv.DictReader(f))


def normalizer_scores(pairs):
    tp = fp = fn = tn = 0
    for p in pairs:
        predicted = normalize_name(p["name_a"]) == normalize_name(p["name_b"])
        actual = p["same"] == "1"
        tp += predicted and actual
        fp += predicted and not actual
        fn += actual and not predicted
        tn += not predicted and not actual
    return tp, fp, fn, tn


def test_golden_set_shape():
    rows = golden()
    assert len(rows) == 60
    assert {r["same"] for r in rows} == {"0", "1"}
    # Every labeled pair with FEIN evidence on both sides agrees with it.
    for r in rows:
        if r["fein_a"] and r["fein_b"]:
            assert (r["fein_a"] == r["fein_b"]) == (r["same"] == "1"), r


def test_brief_examples():
    assert normalize_name("GOOGLE LLC") == normalize_name("Google, L.L.C.")
    assert normalize_name("DELOITTE CONSULTING LLP") != normalize_name("DELOITTE & TOUCHE LLP")


def test_normalizer_precision_and_recall_floor():
    tp, fp, fn, _ = normalizer_scores(golden())
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    # The exact numbers go in eval/employers.md; these floors catch regressions.
    assert precision >= 0.85
    assert recall >= 0.80


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Google, L.L.C.", "GOOGLE"),
        ("The Goldman Sachs Group, Inc.", "GOLDMAN SACHS GROUP"),
        ("JPMorgan Chase & Co.", "JPMORGAN CHASE"),
        ("AT&T Services, Inc.", "AT AND T SERVICES"),
        ("Samsung Electronics Co., Ltd.", "SAMSUNG ELECTRONICS"),
        ("Fidelity Technology Group, LLC d/b/a Fidelity Investments", "FIDELITY TECHNOLOGY GROUP"),
        ("Macy's, Inc.", "MACYS"),
        ("Nestlé USA Inc", "NESTLE USA"),
        ("Bank of the West", "BANK OF THE WEST"),
        ("THE", "THE"),
        ("", ""),
        (None, ""),
    ],
)
def test_normalize(raw, expected):
    assert normalize_name(raw) == expected


def test_slugify():
    assert slugify("Ernst & Young U.S. LLP") == "ernst-and-young-u-s-llp"
    assert slugify("!!!") == "employer"


def _lca(rows):
    con = duckdb.connect()
    con.execute("""
        CREATE TABLE lca (fiscal_year INT, case_number VARCHAR, employer_fein VARCHAR,
                          employer_name VARCHAR, employer_state VARCHAR, employer_city VARCHAR)
    """)
    con.executemany("INSERT INTO lca VALUES (?, ?, ?, ?, ?, ?)", rows)
    return con


def _employer_of(con, case):
    return con.execute(
        "SELECT e.display_name, e.fein, l.match_method FROM lca l "
        "JOIN employers e USING (employer_id) WHERE case_number = ?",
        [case],
    ).fetchone()


def test_resolution_rules():
    rows = [
        # One FEIN, three spellings: one employer, most frequent spelling displayed.
        (2025, "c1", "77-0493581", "Google LLC", "CA", "MOUNTAIN VIEW"),
        (2025, "c2", "77-0493581", "Google LLC", "CA", "MOUNTAIN VIEW"),
        (2024, "c3", "77-0493581", "GOOGLE LLC", "CA", "MOUNTAIN VIEW"),
        # Two FEINs with the same normalized name: never merged, recorded as a link.
        (2025, "c4", "82-2530621", "ASML US, LP", "AZ", "CHANDLER"),
        (2025, "c5", "77-0568140", "ASML US, LLC", "AZ", "CHANDLER"),
        # FY2023 row without FEIN: joins the single FEIN for that name and state.
        (2023, "c6", None, "Google, L.L.C.", "CA", "MOUNTAIN VIEW"),
        # FY2023 row whose name and state match two FEINs evenly: stays name-based.
        (2023, "c7", None, "ASML US LLC", "AZ", "CHANDLER"),
        # FY2023 row with no FEIN match anywhere: name-based employer.
        (2023, "c8", None, "Tiny Startup Inc", "VA", "RESTON"),
    ]
    con = _lca(rows)
    stats = resolve(con)
    assert _employer_of(con, "c1") == ("Google LLC", "77-0493581", "fein")
    assert _employer_of(con, "c3")[0] == "Google LLC"
    assert _employer_of(con, "c6") == ("Google LLC", "77-0493581", "name_state_to_fein")
    assert _employer_of(con, "c4")[1] != _employer_of(con, "c5")[1]
    assert _employer_of(con, "c7")[1:] == (None, "name_state_ambiguous")
    assert _employer_of(con, "c8")[1:] == (None, "name_state")
    assert stats["possible_link_pairs"] == 1
    assert stats["cases"] == len(rows)


def test_dominant_fein_absorbs_a_typo():
    rows = [
        (2025, f"a{i}", "82-0544687", "Amazon.com Services LLC", "WA", "SEATTLE") for i in range(40)
    ]
    rows.append((2025, "typo", "71-0938319", "Amazon.com Services LLC", "WA", "SEATTLE"))
    rows.append((2023, "old", None, "AMAZON.COM SERVICES LLC", "WA", "SEATTLE"))
    con = _lca(rows)
    resolve(con)
    assert _employer_of(con, "old") == (
        "Amazon.com Services LLC", "82-0544687", "name_state_to_dominant_fein"
    )  # fmt: skip
    # The typo row keeps its own FEIN employer; FEINs are never merged.
    assert _employer_of(con, "typo")[1] == "71-0938319"
