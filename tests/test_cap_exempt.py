"""The "likely cap-exempt" rules (docs/decisions.md D30)."""

import pytest

from etl import cap_exempt
from tests.test_aggregate import build, case

IRS_HEADER = "EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,AFFILIATION,NTEE_CD"


@pytest.mark.parametrize(
    ("name", "naics", "hit"),
    [
        ("Trustees of Boston University", "611310", True),
        ("Community College of Denver", "611210", True),
        ("Massachusetts Institute of Technology", "611310", True),
        ("Icahn School of Medicine at Mount Sinai", "622110", True),
        ("University Loft Company", "423210", False),  # furniture: not education or health
        ("College Pro Painting", "238320", False),
        ("Collegeville Software", "611430", False),  # no whole word
        ("Acme University", None, False),
    ],
)
def test_name_rule(name, naics, hit):
    assert cap_exempt.name_rule(name, naics) is hit


def _employers(tmp_path, irs_lines=None):
    rows = [
        case(1, employer_name="Trustees of Boston University", employer_fein="04-2103547",
             naics_code="611310"),
        case(2, employer_name="Icahn School of Medicine at Mount Sinai",
             employer_fein="13-6171197", naics_code="622110"),
        case(3, employer_name="Research Triangle Institute", employer_fein="56-0686338",
             naics_code="541715"),
        case(4, employer_name="University Loft Company", employer_fein="35-1234567",
             naics_code="423210"),
    ]  # fmt: skip
    irs = []
    if irs_lines:
        p = tmp_path / "eo_nc.csv"
        p.write_text("\n".join([IRS_HEADER, *irs_lines]) + "\n")
        irs = [p]
    con = build(rows, tmp_path=tmp_path, irs=irs)
    return dict(con.execute("SELECT display_name, cap_exempt_rule FROM agg_employers").fetchall())


def test_rules_without_the_irs_file(tmp_path):
    got = _employers(tmp_path)
    assert got["Trustees of Boston University"] == "naics_611310"
    assert got["Icahn School of Medicine at Mount Sinai"] == "name_higher_ed"
    assert got["Research Triangle Institute"] is None  # research nonprofit needs the IRS file
    assert got["University Loft Company"] is None


def test_irs_file_confirms_research_nonprofits(tmp_path):
    got = _employers(
        tmp_path,
        [
            "560686338,RESEARCH TRIANGLE INSTITUTE,,X,DURHAM,NC,27709,0,03,3,U05",
            "351234567,UNIVERSITY LOFT,,X,X,IN,46000,0,04,3,B43",  # 501(c)(4): not counted
        ],
    )
    assert got["Research Triangle Institute"] == "irs_nonprofit"
    assert got["University Loft Company"] is None


def test_every_rule_has_display_text():
    assert set(cap_exempt.RULES) == {"irs_nonprofit", "naics_611310", "name_higher_ed"}
