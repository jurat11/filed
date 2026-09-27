"""USCIS file layouts, the row count check and the USCIS to LCA join."""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from etl import employers, ingest, uscis_files, uscis_join
from etl.uscis_files import UscisFormatError, parse

FIX = Path(__file__).parent / "fixtures" / "uscis"

SIX_HEADER = (
    "Fiscal Year,Employer (Petitioner) Name,Tax ID,Industry (NAICS) Code,Petitioner City,"
    "Petitioner State,Petitioner Zip Code,New Employment Approval,New Employment Denial,"
    "New Concurrent Approval,New Concurrent Denial,Continuation Approval,Continuation Denial,"
    "Change with Same Employer Approval,Change with Same Employer Denial,"
    "Change of Employer Approval,Change of Employer Denial,Amended Approval,Amended Denial"
)


# ---- layouts -------------------------------------------------------------------------


def test_legacy_layout():
    p = parse(FIX / "h1b_datahubexport-2023.csv", 2023)
    assert p.layout == "legacy"
    assert p.raw_rows == 8
    g = p.rows[0]
    assert (g["employer_name"], g["state"], g["tax4"], g["city"]) == (
        "GOOGLE LLC", "CA", "3581", "MOUNTAIN VIEW",
    )  # fmt: skip
    assert (g["initial_approvals"], g["continuing_approvals"]) == (40, 120)
    # Six-category fields do not exist in this layout: missing, not zero.
    assert g["new_employment_approvals"] is None
    assert p.rows[-1]["employer_name"] is None


def test_six_category_layout_maps_to_initial_and_continuing():
    p = parse(FIX / "uscis_hub_FY2024.csv", 2024)
    assert p.layout == "six_category"
    g, ms, uni = p.rows
    # initial = New Employment + New Concurrent; continuing = the other four (D8).
    assert g["new_employment_approvals"] == 20
    assert g["initial_approvals"] == 20 + 2
    assert g["continuing_approvals"] == 50 + 10 + 15 + 5
    assert g["initial_denials"] == 1
    # A blank New Concurrent is missing; the sum uses the parts that are there.
    assert ms["new_concurrent_approvals"] is None
    assert ms["initial_approvals"] == 18
    # Every part blank: the total is missing, never 0.
    assert uni["initial_approvals"] is None
    assert uni["continuing_denials"] is None
    assert g["naics"].startswith("54")


def test_tableau_crosstab_utf16_tabs_and_thousands():
    p = parse(FIX / "uscis_hub_FY2025.csv", 2025)
    assert p.layout == "six_category"
    g = p.rows[0]
    assert g["new_employment_approvals"] == 1200
    assert g["initial_approvals"] == 1204
    assert g["continuing_approvals"] == 2000 + 300 + 450 + 90
    assert g["fiscal_year"] == 2025


def test_long_layout_is_pivoted(tmp_path):
    lines = ["Fiscal Year\tEmployer (Petitioner) Name\tTax ID\tPetitioner State\t"
             "Petitioner City\tMeasure Names\tMeasure Values"]  # fmt: skip
    for key, label in uscis_files.CATEGORIES.items():
        for outcome, v in (("Approvals", 10), ("Denials", 1)):
            value = "" if key == "amended" and outcome == "Denials" else str(v)
            lines.append(f"2024\tACME LLC\t1111\tVA\tRESTON\t{label} {outcome}\t{value}")
    p_ = tmp_path / "long.csv"
    p_.write_bytes(("\n".join(lines) + "\n").encode("utf-16"))
    p = parse(p_, 2024)
    assert p.layout == "long"
    assert p.raw_rows == 12
    (row,) = p.rows
    assert row["initial_approvals"] == 20
    assert row["continuing_approvals"] == 40
    assert row["amended_denials"] is None
    assert row["continuing_denials"] == 3


def test_long_layout_rejects_unknown_measure(tmp_path):
    p = tmp_path / "long.csv"
    p.write_text(
        "Employer,Tax ID,State,Measure Names,Measure Values\nACME,1111,VA,Approval Rate,0.9\n"
    )
    with pytest.raises(UscisFormatError, match="unknown measure"):
        parse(p, 2024)


def test_six_category_layout_must_be_complete(tmp_path):
    p = tmp_path / "f.csv"
    header = SIX_HEADER.replace(",Amended Approval,Amended Denial", "")
    p.write_text(header + "\n")
    with pytest.raises(UscisFormatError, match="lacks"):
        parse(p, 2024)


def test_unrecognized_file_fails(tmp_path):
    p = tmp_path / "f.csv"
    p.write_text("Employer,Approvals Total\nACME,3\n")
    with pytest.raises(UscisFormatError, match="no approval columns"):
        parse(p, 2024)


def test_plural_headers_and_short_tax_id(tmp_path):
    p = tmp_path / "f.csv"
    header = SIX_HEADER.replace("Approval", "Approvals").replace("Denial", "Denials")
    p.write_text(header + "\n2024,ACME LLC,42,54,RESTON,va,20190" + ",1" * 12 + "\n")
    (row,) = parse(p, 2024).rows
    assert row["tax4"] == "0042"
    assert row["state"] == "VA"
    assert row["initial_approvals"] == 2


def test_fiscal_year_from_registry_when_file_has_none(tmp_path):
    p = tmp_path / "f.csv"
    header = SIX_HEADER.replace("Fiscal Year,", "")
    p.write_text(header + "\nACME,1111,54,X,VA,1" + ",0" * 12 + "\n")
    assert parse(p, 2026).rows[0]["fiscal_year"] == 2026


# ---- loading ---------------------------------------------------------------------------


def _files(*names):
    by_name = {f.name: f for f in uscis_join.FILES}
    return [(by_name[n], FIX / n) for n in names]


def test_load_raw_every_layout_and_counts():
    con = duckdb.connect()
    layouts = uscis_join.load_raw(
        con,
        _files("h1b_datahubexport-2023.csv", "uscis_hub_FY2024.csv", "uscis_hub_FY2025.csv"),
        record=False,
    )
    assert layouts == {
        "h1b_datahubexport-2023.csv": "legacy",
        "uscis_hub_FY2024.csv": "six_category",
        "uscis_hub_FY2025.csv": "six_category",
    }
    assert con.execute(
        "SELECT fiscal_year, count(*) FROM uscis_raw GROUP BY 1 ORDER BY 1"
    ).fetchall() == [(2023, 8), (2024, 3), (2025, 2)]


def test_load_raw_fails_on_row_count_mismatch(monkeypatch):
    monkeypatch.setattr(uscis_join, "csv_rows", lambda p: 999)
    with pytest.raises(ingest.RowCountError):
        uscis_join.load_raw(duckdb.connect(), _files("h1b_datahubexport-2023.csv"), record=False)


def test_load_raw_fails_on_wrong_fiscal_year(tmp_path):
    p = tmp_path / "uscis_hub_FY2026.csv"
    p.write_text(SIX_HEADER + "\n2025,ACME,1111,54,X,VA,1" + ",0" * 12 + "\n")
    f = uscis_join.UscisFile(2026, p.name, "https://example.test")
    with pytest.raises(ValueError, match="fiscal years"):
        uscis_join.load_raw(duckdb.connect(), [(f, p)], record=False)


def test_missing_optional_years_are_skipped_and_required_year_is_not(tmp_path):
    (tmp_path / "h1b_datahubexport-2023.csv").write_text("x")
    assert [f.fiscal_year for f, _ in uscis_join.present(uscis_join.FILES, tmp_path)] == [2023]
    (tmp_path / "h1b_datahubexport-2023.csv").unlink()
    with pytest.raises(FileNotFoundError):
        uscis_join.present(uscis_join.FILES, tmp_path)


# ---- join ------------------------------------------------------------------------------


def _lca(rows):
    con = duckdb.connect()
    con.execute("""
        CREATE TABLE lca (fiscal_year INT, case_number VARCHAR, employer_fein VARCHAR,
                          employer_name VARCHAR, employer_state VARCHAR, employer_city VARCHAR)
    """)
    con.executemany("INSERT INTO lca VALUES (?, ?, ?, ?, ?, ?)", rows)
    employers.resolve(con)
    return con


def _join(con, tmp_path, uscis_lines):
    p = tmp_path / "u.csv"
    p.write_text(
        "Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,"
        "Continuing Denial,NAICS,Tax ID,State,City,ZIP\n" + "\n".join(uscis_lines) + "\n"
    )
    f = uscis_join.UscisFile(2023, p.name, "https://example.test")
    uscis_join.load_raw(con, [(f, p)], record=False)
    return uscis_join.match(con)


def _outcome(con, norm):
    return con.execute(
        "SELECT method, e.fein, u.matched FROM uscis_employer u "
        "LEFT JOIN employers e ON e.employer_id = u.employer_id WHERE u.norm = ?",
        [norm],
    ).fetchone()


LCA = [
    # Two legal entities with one normalized name in one state: a tie.
    (2025, "a1", "82-2530621", "ASML US, LP", "AZ", "CHANDLER"),
    (2025, "a2", "77-0568140", "ASML US, LLC", "AZ", "CHANDLER"),
    (2025, "g1", "77-0493581", "Google LLC", "CA", "MOUNTAIN VIEW"),
    (2025, "m1", "91-1144442", "Microsoft Corporation", "WA", "REDMOND"),
    (2023, "n1", None, "Tiny Startup Inc", "VA", "RESTON"),
]


def test_tax4_breaks_a_tie_between_candidates(tmp_path):
    con = _lca(LCA)
    _join(con, tmp_path, ["2023,ASML US LLC,5,0,1,0,33,8140,AZ,CHANDLER,85224"])
    assert _outcome(con, "ASML US") == ("several_candidates_tax4", "77-0568140", True)


def test_tie_without_a_tax4_winner_stays_unmatched(tmp_path):
    con = _lca(LCA)
    _join(con, tmp_path, ["2023,ASML US LLC,5,0,1,0,33,0000,AZ,CHANDLER,85224"])
    assert _outcome(con, "ASML US") == ("several_candidates", None, False)


def test_single_candidate_with_different_last4_is_rejected(tmp_path):
    con = _lca(LCA)
    _join(con, tmp_path, ["2023,GOOGLE LLC,5,0,1,0,54,9999,CA,MOUNTAIN VIEW,94043"])
    assert _outcome(con, "GOOGLE") == ("rejected_tax4_differs", None, False)


def test_single_candidate_with_same_last4_matches(tmp_path):
    con = _lca(LCA)
    _join(con, tmp_path, ["2023,MICROSOFT CORP,5,0,1,0,51,4442,WA,REDMOND,98052"])
    assert _outcome(con, "MICROSOFT") == ("name_state_tax4", "91-1144442", True)


def test_name_based_employer_matches_on_name_and_state(tmp_path):
    con = _lca(LCA)
    _join(con, tmp_path, ["2023,TINY STARTUP INC,1,0,0,0,54,1234,VA,RESTON,20190"])
    assert _outcome(con, "TINY STARTUP") == ("name_state", None, True)


def test_different_state_does_not_match(tmp_path):
    con = _lca(LCA)
    _join(con, tmp_path, ["2023,GOOGLE LLC,5,0,1,0,54,3581,NY,NEW YORK,10011"])
    assert _outcome(con, "GOOGLE") == ("no_name_state_match", None, False)


def test_uscis_only_employers_get_ids_and_unique_slugs(tmp_path):
    con = _lca(LCA)
    stats = _join(
        con,
        tmp_path,
        [
            "2023,GOOGLE LLC,5,0,1,0,54,9999,CA,MOUNTAIN VIEW,94043",  # rejected: own employer
            "2023,STATE UNIVERSITY,9,0,1,0,61,1111,MA,BOSTON,02115",
            "2023,STATE UNIVERSITY,2,0,0,0,61,2222,NY,ALBANY,12203",
        ],
    )
    only = con.execute("SELECT slug, employer_id FROM uscis_only ORDER BY employer_id").fetchall()
    max_lca = con.execute("SELECT max(employer_id) FROM employers").fetchone()[0]
    # Ordered by approvals. "google-llc" belongs to the LCA employer, so the rejected
    # USCIS Google gets a state suffix.
    assert [s for s, _ in only] == ["state-university", "google-llc-ca", "state-university-ny"]
    assert all(i > max_lca for _, i in only)
    assert stats["matched"] == 0
    # Their approvals are attributed to the new employer, not to Google's LCA employer.
    assert (
        con.execute(
            "SELECT sum(initial_approvals) FROM uscis_year WHERE employer_id > ?", [max_lca]
        ).fetchone()[0]
        == 16
    )


def test_row_without_name_is_reported_not_joined(tmp_path):
    con = _lca(LCA)
    stats = _join(con, tmp_path, ["2023,,3,0,1,0,54,1111,VA,RESTON,20190"])
    assert stats["raw_rows_without_name"] == (1, 4)
    assert stats["uscis_employers"] == 0


def test_fixture_join_outcomes():
    from etl import seed

    con = seed.build()
    got = dict(con.execute("SELECT norm, method FROM uscis_employer").fetchall())
    assert got == {
        "GOOGLE": "name_state_tax4",
        "MICROSOFT": "name_state_tax4",
        "ERNST YOUNG US": "name_state_tax4",
        "APPLE": "name_state_tax4",
        "AMAZONCOM SERVICES": "rejected_tax4_differs",
        "SYNTHETIC TEST UNIVERSITY": "no_name_state_match",
    }
    # Two Apple rows (two cities) are one USCIS employer.
    apple = con.execute(
        "SELECT rows, initial_approvals FROM uscis_year y JOIN agg_employers e "
        "USING (employer_id) WHERE e.display_name = 'Apple Inc.'"
    ).fetchone()
    assert apple == (2, 10)
