"""Find DOL and USCIS files newer than what Filed has loaded, for the release watcher.

    uv run python scripts/watch_releases.py DOL_HTML USCIS_HTML --out release.md

The HTML is saved by web/scripts/fetch-page.mjs (a real browser; dol.gov blocks scripts).
A DOL file is new when its fiscal year and quarter are later than the latest loaded
release for that fiscal year (so quarterly files already covered by a cumulative release
are not reported), or its fiscal year is later than any loaded one. Years before the first
loaded fiscal year are ignored. A USCIS archive file is new when its year is not loaded.
Writes a GitHub issue title (first line) and body to --out when something is new; writes
nothing and exits 0 otherwise. Nothing is downloaded: dol.gov only serves a browser, so a
person downloads the files (docs/download.md).
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
DOL_PAGE = "https://www.dol.gov/agencies/eta/foreign-labor/performance"
USCIS_PAGE = "https://www.uscis.gov/archive/h-1b-employer-data-hub-files"

DOL_RE = re.compile(r"(LCA_(?:Disclosure_Data|Worksites)_FY_?(\d{4})_Q([1-4])\.xlsx)", re.I)
USCIS_RE = re.compile(r"(h1b_datahubexport-(\d{4})\.csv)", re.I)
HREF_RE = re.compile(r'href="([^"]+)"', re.I)


def links(html: str, base: str) -> list[str]:
    return sorted({urljoin(base, h) for h in HREF_RE.findall(html)})


def loaded_dol() -> dict[tuple[str, int], int]:
    """(kind, fiscal year) -> latest quarter loaded, from the pipeline's file list."""
    import sys

    sys.path.insert(0, str(ROOT))
    from etl.columns import RAW_FILES

    out: dict[tuple[str, int], int] = {}
    for rf in RAW_FILES:
        k = (rf.kind, rf.fiscal_year)
        out[k] = max(out.get(k, 0), rf.quarter)
    return out


def loaded_uscis() -> set[int]:
    import sys

    sys.path.insert(0, str(ROOT))
    from etl.uscis_join import FILES

    return {f.fiscal_year for f in FILES if f.required or f.name.startswith("h1b_datahubexport")}


def new_dol(urls: list[str], loaded: dict[tuple[str, int], int]) -> list[tuple[str, str]]:
    first = min(fy for _, fy in loaded)
    newest = max(fy for _, fy in loaded)
    found = {}
    for u in urls:
        m = DOL_RE.search(u)
        if not m:
            continue
        name, fy, q = m.group(1), int(m.group(2)), int(m.group(3))
        kind = "lca" if "Disclosure" in name else "lca_worksites"
        if fy < first:
            continue
        have = loaded.get((kind, fy))
        if (have is None and fy > newest) or (have is not None and q > have):
            found[name] = u
    return sorted(found.items())


def new_uscis(urls: list[str], loaded: set[int]) -> list[tuple[str, str]]:
    found = {}
    for u in urls:
        m = USCIS_RE.search(u)
        if m and int(m.group(2)) > max(loaded):
            found[m.group(1)] = u
    return sorted(found.items())


def issue(dol: list[tuple[str, str]], uscis: list[tuple[str, str]]) -> str | None:
    if not dol and not uscis:
        return None
    names = [n for n, _ in dol + uscis]
    lines = [f"New data releases: {', '.join(names)}", ""]
    lines += ["The release watcher found files newer than the ones Filed has loaded.", ""]
    if dol:
        lines += [f"**DOL** ({DOL_PAGE}):", ""] + [f"- [{n}]({u})" for n, u in dol] + [""]
    if uscis:
        lines += [f"**USCIS** ({USCIS_PAGE}):", ""] + [f"- [{n}]({u})" for n, u in uscis] + [""]
    lines += [
        "To load them:",
        "",
        "1. Download each file in a browser (dol.gov refuses scripts) into `data/raw/dol/` or "
        "`data/raw/uscis/`, with its record layout PDF.",
        "2. Register it: a DOL file needs a `RawFile` in `etl/columns.py` (and a column map "
        "for a new fiscal year, checked against the record layout); check whether the release "
        "is cumulative from its DECISION_DATE range (docs/decisions.md D1).",
        "3. `uv run filed all --no-load`, then `uv run python scripts/reconcile.py --against "
        "duckdb` must show 0 differences.",
        "4. `uv run filed push-raw`, commit `data/manifest.json` and the code change, and run "
        "the `etl` workflow to load Neon.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dol_html", type=Path)
    ap.add_argument("uscis_html", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    dol = new_dol(links(a.dol_html.read_text(), DOL_PAGE), loaded_dol())
    uscis = new_uscis(links(a.uscis_html.read_text(), USCIS_PAGE), loaded_uscis())
    text = issue(dol, uscis)
    if text:
        a.out.write_text(text)
    print(text or "no new files")


if __name__ == "__main__":
    main()
