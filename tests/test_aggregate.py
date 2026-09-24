"""aggregate.build on small hand-made inputs, through the real wage, resolve and USCIS code."""

from __future__ import annotations

import duckdb
import pytest

from etl import aggregate, employers, uscis_join, wages
from etl.columns import CANONICAL

LEGACY_HEADER = (
    "Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,"
    "Continuing Denial,NAICS,Tax ID,State,City,ZIP"
)


def case(n: int, **kw) -> dict:
    row = dict.fromkeys(CANONICAL)
    row.update(
        case_number=f"I-{n:06d}",
        fiscal_year=2025,
        case_status="Certified",
        employer_name="Acme Software LLC",
        employer_fein="11-1111111",
        employer_state="VA",
        employer_city="RESTON",
        job_title="Software Engineer",
        soc_code="15-1252",
        full_time=True,
        worksite_state="VA",
        wage_from=100_000.0,
        wage_unit="Year",
        pw_wage_level="II",
        total_workers=1,
    )
    row.update(kw)
    return row


def build(rows: list[dict], uscis: dict[int, list[str]] | None = None, tmp_path=None):
    """Run wages, resolve, USCIS and aggregate on `rows`. `uscis` maps a fiscal year to
    legacy-layout CSV lines (without header)."""
    con = duckdb.connect()
    cols = [*CANONICAL, "source_file", "source_quarter"]
    types = {c: "VARCHAR" for c in cols}
    types.update(dict.fromkeys(["fiscal_year", "total_workers", "source_quarter"], "INT"))
    types.update(dict.fromkeys(["full_time", "h1b_dependent", "willful_violator"], "BOOLEAN"))
    types.update(dict.fromkeys(["wage_from", "wage_to", "prevailing_wage"], "DOUBLE"))
    con.execute(f"CREATE TABLE lca ({', '.join(f'{c} {types[c]}' for c in cols)})")
    for r in rows:
        r = {**r, "source_file": f"LCA_Disclosure_Data_FY{r['fiscal_year']}_Q4.xlsx",
             "source_quarter": 4}  # fmt: skip
        con.execute(f"INSERT INTO lca VALUES ({', '.join('?' * len(cols))})", [r[c] for c in cols])
    wages.add_annual_wages(con)
    employers.resolve(con)
    files = []
    for fy, lines in (uscis or {}).items():
        p = tmp_path / f"uscis_{fy}.csv"
        p.write_text("\n".join([LEGACY_HEADER, *lines]) + "\n")
        files.append((uscis_join.UscisFile(fy, p.name, "https://example.test"), p))
    if not files:
        # Every build has at least one USCIS year; an unrelated employer keeps it empty.
        p = tmp_path / "uscis_2023.csv"
        p.write_text(LEGACY_HEADER + "\n2023,UNRELATED CO,1,0,0,0,54,0000,ZZ,X,00000\n")
        files.append((uscis_join.UscisFile(2023, p.name, "https://example.test"), p))
    uscis_join.load_raw(con, files, record=False)
    uscis_join.match(con)
    aggregate.build(con)
    return con


def one(con, sql, *args):
    return con.execute(sql, list(args)).fetchone()


def test_status_groups(tmp_path):
    con = build(
        [
            case(1, case_status="Certified"),
            case(2, case_status="Certified - Withdrawn"),
            case(3, case_status="Withdrawn"),
            case(4, case_status="Denied"),
            case(5, case_status="Certified"),
        ],
        tmp_path=tmp_path,
    )
    assert one(con, "SELECT filed, certified, withdrawn, denied FROM agg_lca_year") == (5, 2, 2, 1)


def test_wage_percentiles_use_certified_full_time_valid_only(tmp_path):
    good = [case(i, wage_from=w) for i, w in enumerate([100e3, 110e3, 120e3, 130e3, 140e3])]
    noise = [
        case(10, full_time=False, wage_from=500e3),  # part time
        case(11, case_status="Denied", wage_from=900e3),  # not certified
        case(12, case_status="Withdrawn", wage_from=20e3),  # not certified
        case(13, wage_from=45.0),  # $45 "per Year": a unit error
        case(14, wage_from=95_000.0, wage_unit="Hour"),  # salary entered as hourly
        case(15, wage_from=None),  # no wage
    ]
    con = build(good + noise, tmp_path=tmp_path)
    assert one(con, "SELECT wage_rows, wage_p25, wage_median, wage_p75 FROM agg_lca_year") == (
        5, 110_000, 120_000, 130_000,
    )  # fmt: skip


def test_no_valid_wage_gives_missing_percentiles_not_zero(tmp_path):
    con = build([case(1, full_time=False), case(2, wage_from=45.0)], tmp_path=tmp_path)
    assert one(con, "SELECT wage_rows, wage_p25, wage_median, wage_p75 FROM agg_lca_year") == (
        0, None, None, None,
    )  # fmt: skip
    # The explore cube keeps "no wages" as missing too, so no mean of 0 can be computed.
    assert one(con, "SELECT sum(wage_rows), max(wage_sum) FROM agg_lca_cube") == (0, None)


def test_level_mix_counts_certified_only(tmp_path):
    con = build(
        [
            case(1, pw_wage_level="I"),
            case(2, pw_wage_level="I"),
            case(3, pw_wage_level="II"),
            case(4, pw_wage_level="III"),
            case(5, pw_wage_level="IV"),
            case(6, pw_wage_level=None),
            case(7, pw_wage_level="I", case_status="Denied"),
            case(8, pw_wage_level="IV", case_status="Withdrawn"),
        ],
        tmp_path=tmp_path,
    )
    assert one(
        con, "SELECT level_i, level_ii, level_iii, level_iv, level_none FROM agg_lca_year"
    ) == (2, 1, 1, 1, 1)


def test_certified_workers_missing_when_not_reported(tmp_path):
    con = build(
        [case(1, total_workers=None), case(2, fiscal_year=2024, case_status="Denied")],
        tmp_path=tmp_path,
    )
    rows = dict(con.execute("SELECT fiscal_year, certified_workers FROM agg_lca_year").fetchall())
    # 2025: certified rows exist but none states a worker count: missing, not 0.
    # 2024: no certified rows at all: 0 certified workers is a true count.
    assert rows == {2025: None, 2024: 0}


def test_entry_level_signal(tmp_path):
    rows = [
        case(1, soc_code="15-1252", pw_wage_level="I"),  # software, I: entry
        case(2, soc_code="15-2051", pw_wage_level="II"),  # data, II: entry
        case(3, soc_code="13-2051", pw_wage_level="III"),  # finance, III: not entry
        case(4, soc_code="17-2071", pw_wage_level="I"),  # engineering: not in selection
        case(5, soc_code="15-1252", pw_wage_level="I", case_status="Denied"),  # not certified
        case(6, fiscal_year=2026, soc_code="15-2011", pw_wage_level="I"),  # quant, I: entry
        case(7, fiscal_year=2024, soc_code="15-1252", pw_wage_level="I"),  # too old
    ]
    con = build(rows, tmp_path=tmp_path)
    got = one(
        con,
        "SELECT role_selection, years, entry_lcas, certified_all, uscis_initial, "
        "uscis_years_loaded FROM agg_entry_signal",
    )
    assert got == ("swe_data_fin", "2025-2026", 3, 5, None, False)


def test_entry_signal_uscis_loaded_and_matched(tmp_path):
    rows = [case(1), case(2, fiscal_year=2026)]
    uscis = {
        2025: ["2025,ACME SOFTWARE LLC,7,0,3,0,54,1111,VA,RESTON,20190"],
        2026: ["2026,ACME SOFTWARE LLC,5,0,1,0,54,1111,VA,RESTON,20190"],
    }
    con = build(rows, uscis, tmp_path=tmp_path)
    assert one(con, "SELECT uscis_initial, uscis_years_loaded FROM agg_entry_signal") == (12, True)


def test_entry_signal_uscis_loaded_but_unmatched_is_missing(tmp_path):
    rows = [case(1), case(2, fiscal_year=2026)]
    uscis = {
        2025: ["2025,SOMEONE ELSE INC,7,0,3,0,54,2222,CA,X,90000"],
        2026: ["2026,SOMEONE ELSE INC,5,0,1,0,54,2222,CA,X,90000"],
    }
    con = build(rows, uscis, tmp_path=tmp_path)
    assert one(con, "SELECT uscis_initial, uscis_years_loaded FROM agg_entry_signal") == (
        None, True,
    )  # fmt: skip


def test_employers_missing_values_are_null_not_zero(tmp_path):
    uscis = {2023: ["2023,STATE RESEARCH UNIVERSITY,4,0,6,0,61,4321,MA,BOSTON,02115"]}
    con = build([case(1)], uscis, tmp_path=tmp_path)
    lca_only = one(
        con,
        "SELECT has_lca, has_uscis, certified_total, uscis_initial_total "
        "FROM agg_employers WHERE display_name = 'Acme Software LLC'",
    )
    assert lca_only == (True, False, 1, None)
    uscis_only = one(
        con,
        "SELECT has_lca, has_uscis, lca_rows, certified_total, uscis_initial_total "
        "FROM agg_employers WHERE display_name = 'STATE RESEARCH UNIVERSITY'",
    )
    assert uscis_only == (False, True, None, None, 4)


def test_source_label_spans_quarters(tmp_path):
    con = build([case(1)], tmp_path=tmp_path)
    assert one(con, "SELECT source_file, quarter FROM agg_lca_year") == (
        "LCA_Disclosure_Data_FY2025_Q4.xlsx", 4,
    )  # fmt: skip


@pytest.mark.parametrize("kind", ["title", "state"])
def test_top_lists_are_latest_certified_year(tmp_path, kind):
    rows = [case(i, job_title="Engineer A") for i in range(3)]
    rows += [case(10, fiscal_year=2026, job_title="Engineer B", worksite_state="DC")]
    rows += [case(11, fiscal_year=2026, case_status="Denied", job_title="Engineer C")]
    con = build(rows, tmp_path=tmp_path)
    got = con.execute(
        "SELECT fiscal_year, value, certified FROM agg_lca_year_top WHERE kind = ?", [kind]
    ).fetchall()
    assert got == [(2026, "ENGINEER B" if kind == "title" else "DC", 1)]
