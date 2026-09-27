"""The hand-reviewed parent map (docs/decisions.md D31)."""

import pytest

from etl import groups
from etl.groups import COLUMNS, ParentMapError
from tests.test_aggregate import build, case

HEADER = ",".join(COLUMNS)
OK = "amazon,Amazon.com Inc. subsidiaries,{fein},reviewed,https://www.sec.gov/x,J. Doe,2026-09-01,"


def _write(tmp_path, *lines):
    p = tmp_path / "parents.csv"
    p.write_text("\n".join([HEADER, *lines]) + "\n")
    return p


def test_shipped_file_is_valid_and_only_proposed():
    rows = groups.read()
    assert rows and {r["status"] for r in rows} == {"proposed"}


@pytest.mark.parametrize(
    ("line", "message"),
    [
        ("a,A,82-0544687,maybe,,,,", "status"),
        ("a,A,820544687,proposed,,,,", "FEIN"),
        ("Bad Slug,A,82-0544687,proposed,,,,", "group_slug"),
        ("a,A,82-0544687,reviewed,,,,", "evidence_url"),
        ("a,A,82-0544687,reviewed,http://insecure,J,2026-01-01,", "evidence_url"),
    ],
)
def test_malformed_rows_are_refused(tmp_path, line, message):
    with pytest.raises(ParentMapError, match=message):
        groups.read(_write(tmp_path, line))


def test_a_fein_belongs_to_one_group(tmp_path):
    p = _write(tmp_path, "a,A,82-0544687,proposed,,,,", "b,B,82-0544687,proposed,,,,")
    with pytest.raises(ParentMapError, match="already in a"):
        groups.read(p)


def test_wrong_columns_are_refused(tmp_path):
    p = tmp_path / "parents.csv"
    p.write_text("slug,fein\na,82-0544687\n")
    with pytest.raises(ParentMapError, match="columns"):
        groups.read(p)


def _amazon(tmp_path, *lines):
    rows = [
        case(1, employer_name="Amazon.com Services LLC", employer_fein="82-0544687",
             employer_state="WA"),
        case(2, employer_name="Amazon Web Services, Inc.", employer_fein="20-4938068",
             employer_state="WA"),
    ]  # fmt: skip
    return build(rows, tmp_path=tmp_path, parents=_write(tmp_path, *lines))


def test_only_reviewed_groups_are_built(tmp_path):
    con = _amazon(
        tmp_path,
        "amazon,Amazon,82-0544687,proposed,,,,",
        "amazon,Amazon,20-4938068,proposed,,,,",
    )
    assert con.execute("SELECT count(*) FROM agg_groups").fetchone()[0] == 0


def test_reviewed_group_joins_its_feins_and_keeps_employers_separate(tmp_path):
    con = _amazon(tmp_path, OK.format(fein="82-0544687"), OK.format(fein="20-4938068"),
                  OK.format(fein="99-9999999").replace("amazon,", "amazon,", 1))  # fmt: skip
    got = con.execute(
        "SELECT g.group_slug, e.display_name FROM agg_groups g JOIN agg_employers e "
        "USING (employer_id) ORDER BY 2"
    ).fetchall()
    assert got == [("amazon", "Amazon Web Services, Inc."), ("amazon", "Amazon.com Services LLC")]
    # FEIN-level employers are untouched.
    assert con.execute("SELECT count(*) FROM agg_employers WHERE has_lca").fetchone()[0] == 2


def test_a_group_of_one_is_dropped(tmp_path):
    con = _amazon(tmp_path, OK.format(fein="82-0544687"))
    assert con.execute("SELECT count(*) FROM agg_groups").fetchone()[0] == 0
