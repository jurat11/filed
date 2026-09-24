from pathlib import Path

from scripts.watch_releases import (
    DOL_PAGE,
    USCIS_PAGE,
    issue,
    links,
    loaded_dol,
    loaded_uscis,
    new_dol,
    new_uscis,
)

PAGES = Path(__file__).parent / "fixtures" / "pages"


def test_dol_only_later_releases_are_new():
    urls = links((PAGES / "dol.html").read_text(), DOL_PAGE)
    got = dict(new_dol(urls, loaded_dol()))
    # FY2026 Q1 is covered by the cumulative Q3 already loaded; FY2021 predates the data;
    # PERM is another program. Q4 of FY2026 and the first FY2027 file are new.
    assert sorted(got) == [
        "LCA_Disclosure_Data_FY2026_Q4.xlsx",
        "LCA_Disclosure_Data_FY2027_Q1.xlsx",
        "LCA_Worksites_FY_2026_Q4.xlsx",
    ]
    assert got["LCA_Disclosure_Data_FY2026_Q4.xlsx"] == (
        "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/FY26Q4/LCA_Disclosure_Data_FY2026_Q4.xlsx"
    )


def test_uscis_new_archive_year():
    urls = links((PAGES / "uscis.html").read_text(), USCIS_PAGE)
    assert loaded_uscis() == {2023}
    assert [n for n, _ in new_uscis(urls, loaded_uscis())] == ["h1b_datahubexport-2024.csv"]


def test_issue_text():
    assert issue([], []) is None
    text = issue([("LCA_Disclosure_Data_FY2026_Q4.xlsx", "https://x/y.xlsx")], [])
    title, _, body = text.partition("\n")
    assert title == "New data releases: LCA_Disclosure_Data_FY2026_Q4.xlsx"
    assert "[LCA_Disclosure_Data_FY2026_Q4.xlsx](https://x/y.xlsx)" in body
    assert "—" not in text
