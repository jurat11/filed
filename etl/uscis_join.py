"""Match USCIS H-1B Employer Data Hub rows to resolved LCA employers.

USCIS rows are per tax ID (last 4 digits), state, city, ZIP and NAICS. A USCIS employer is
(normalized name, state, tax ID last 4). It matches an LCA employer when:
1. an LCA spelling of that employer has the same normalized name and the LCA row's
   employer state equals the USCIS state, and
2. if several LCA employers qualify, the one whose FEIN ends in the USCIS tax ID digits;
   a single candidate whose FEIN ends in different digits is rejected as a different
   legal entity.
Unmatched USCIS employers get their own employer rows, labeled as having no LCA match.
"""

from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass
from pathlib import Path

import duckdb
import pandas as pd

from etl import ingest, manifest, uscis_files
from etl.employers import slugify
from etl.names import normalize_name

log = logging.getLogger(__name__)

RAW_USCIS = manifest.RAW / "uscis"
HUB_URL = "https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub"


@dataclass(frozen=True)
class UscisFile:
    fiscal_year: int
    name: str
    url: str
    required: bool = False


# FY2023 is the last year USCIS publishes as a file. Later years come from the hub's
# viewer (Crosstab or Data download, saved under these names; docs/download.md). They are
# loaded when present, so a new year needs only the file and no code change.
FILES: list[UscisFile] = [
    UscisFile(
        2023,
        "h1b_datahubexport-2023.csv",
        "https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-2023.csv",
        required=True,
    ),
    *[UscisFile(fy, f"uscis_hub_FY{fy}.csv", HUB_URL) for fy in (2024, 2025, 2026)],
]


def csv_rows(path: Path) -> int:
    """Data rows in a USCIS file, counted independently of the parser: non-empty records
    after the header."""
    text = uscis_files.read_text(path)
    first = text.split("\n", 1)[0]
    delim = "\t" if first.count("\t") > first.count(",") else ","
    records = csv.reader(io.StringIO(text), delimiter=delim)
    return sum(1 for r in records if any(c.strip() for c in r)) - 1


def present(
    files: list[UscisFile] = FILES, raw_dir: Path = RAW_USCIS
) -> list[tuple[UscisFile, Path]]:
    out = []
    for f in files:
        p = raw_dir / f.name
        if p.exists():
            out.append((f, p))
        elif f.required:
            raise FileNotFoundError(p)
    return out


def load_raw(
    con: duckdb.DuckDBPyConnection,
    files: list[tuple[UscisFile, Path]] | None = None,
    record: bool = True,
) -> dict[str, str]:
    """Parse every USCIS file into uscis_raw, checking row counts. Returns file -> layout."""
    files = present() if files is None else files
    frames, layouts = [], {}
    for f, p in files:
        parsed = uscis_files.parse(p, f.fiscal_year)
        raw = csv_rows(p)
        if parsed.raw_rows != raw:
            raise ingest.RowCountError(f"{f.name}: raw {raw} rows, parsed {parsed.raw_rows}")
        years = {r["fiscal_year"] for r in parsed.rows}
        if years - {f.fiscal_year}:
            raise ValueError(f"{f.name}: fiscal years {sorted(years)}, expected {f.fiscal_year}")
        df = pd.DataFrame(parsed.rows, columns=uscis_files.FIELDS)
        df.insert(1, "source_file", f.name)
        frames.append(df)
        layouts[f.name] = parsed.layout
        if record:
            manifest.record(
                p, f.url, kind="uscis", fiscal_year=f.fiscal_year, quarter=4, raw_rows=raw,
                loaded_rows=parsed.raw_rows, layout=parsed.layout,
            )  # fmt: skip
    ints = [c for c in uscis_files.FIELDS if c.endswith(("approvals", "denials"))]
    con.register("uscis_rows_df", pd.concat(frames, ignore_index=True))
    casts = ", ".join(f"CAST({c} AS INT) AS {c}" for c in ints)
    con.execute(f"""
        CREATE OR REPLACE TABLE uscis_raw AS
        SELECT CAST(fiscal_year AS INT) AS fiscal_year, CAST(source_file AS VARCHAR) AS source_file,
               CAST(employer_name AS VARCHAR) AS employer_name, CAST(state AS VARCHAR) AS state,
               CAST(city AS VARCHAR) AS city, CAST(zip AS VARCHAR) AS zip,
               CAST(naics AS VARCHAR) AS naics, CAST(tax4 AS VARCHAR) AS tax4, {casts}
        FROM uscis_rows_df
    """)
    con.unregister("uscis_rows_df")
    names = [r[0] for r in con.execute(
        "SELECT DISTINCT employer_name FROM uscis_raw WHERE employer_name IS NOT NULL"
    ).fetchall()]  # fmt: skip
    con.execute("CREATE OR REPLACE TABLE uscis_norm (raw VARCHAR, norm VARCHAR)")
    if names:
        con.executemany(
            "INSERT INTO uscis_norm VALUES (?, ?)", [(n, normalize_name(n)) for n in names]
        )
    return layouts


def match(con: duckdb.DuckDBPyConnection) -> dict:
    con.execute("""
        CREATE OR REPLACE TEMP TABLE uemp AS
        SELECT n.norm, u.state, u.tax4,
               arg_max(u.employer_name, u.initial_approvals + u.continuing_approvals) AS name,
               arg_max(u.city, u.initial_approvals + u.continuing_approvals) AS city,
               sum(u.initial_approvals + u.continuing_approvals) AS approvals
        FROM uscis_raw u JOIN uscis_norm n ON n.raw = u.employer_name
        WHERE n.norm <> ''
        GROUP BY 1, 2, 3
    """)
    con.execute("""
        CREATE OR REPLACE TEMP TABLE lca_ns AS
        SELECT DISTINCT l.employer_id, n.norm, l.employer_state AS state, e.fein
        FROM lca l JOIN name_norm n ON n.raw = l.employer_name
        JOIN employers e USING (employer_id)
    """)
    con.execute("""
        CREATE OR REPLACE TABLE uscis_match AS
        WITH cand AS (
            SELECT u.norm, u.state, u.tax4, c.employer_id, c.fein,
                   right(replace(c.fein, '-', ''), 4) = u.tax4 AS tax_ok,
                   count(*) OVER (PARTITION BY u.norm, u.state, u.tax4) AS n_cand
            FROM uemp u JOIN lca_ns c ON c.norm = u.norm AND c.state = u.state
        ),
        pick AS (
            SELECT norm, state, tax4,
                   CASE
                     WHEN n_cand = 1 AND (fein IS NULL OR tax_ok) THEN employer_id
                     WHEN n_cand > 1 AND count(*) FILTER (WHERE tax_ok)
                          OVER (PARTITION BY norm, state, tax4) = 1 AND tax_ok THEN employer_id
                   END AS employer_id,
                   CASE
                     WHEN n_cand = 1 AND fein IS NULL THEN 'name_state'
                     WHEN n_cand = 1 AND tax_ok THEN 'name_state_tax4'
                     WHEN n_cand = 1 THEN 'rejected_tax4_differs'
                     WHEN count(*) FILTER (WHERE tax_ok)
                          OVER (PARTITION BY norm, state, tax4) = 1 THEN 'several_candidates_tax4'
                     ELSE 'several_candidates'
                   END AS method
            FROM cand
        )
        SELECT u.*, coalesce(
                   max(p.employer_id), NULL) AS employer_id,
               CASE WHEN max(p.employer_id) IS NOT NULL THEN
                    max(p.method) FILTER (WHERE p.employer_id IS NOT NULL)
                    WHEN count(p.norm) > 0 THEN max(p.method) ELSE 'no_name_state_match' END
                    AS method
        FROM uemp u LEFT JOIN pick p USING (norm, state, tax4)
        GROUP BY ALL
    """)

    # USCIS-only employers get new ids after the LCA ones.
    next_id = con.execute("SELECT max(employer_id) FROM employers").fetchone()[0] + 1
    slugs = {r[0] for r in con.execute("SELECT slug FROM employers").fetchall()}
    rows = con.execute(
        "SELECT norm, state, tax4, name FROM uscis_match WHERE employer_id IS NULL "
        "ORDER BY approvals DESC, norm, state, tax4"
    ).fetchall()
    new = []
    for i, (norm, state, tax4, name) in enumerate(rows):
        base = slugify(name or norm)
        slug, n = f"{base}-{(state or 'xx').lower()}", 2
        if base not in slugs:
            slug = base
        while slug in slugs:
            slug, n = f"{base}-{(state or 'xx').lower()}-{n}", n + 1
        slugs.add(slug)
        new.append((norm, state, tax4, next_id + i, slug))
    con.execute(
        "CREATE OR REPLACE TABLE uscis_only (norm VARCHAR, state VARCHAR, tax4 VARCHAR, "
        "employer_id INT, slug VARCHAR)"
    )
    if new:
        con.executemany("INSERT INTO uscis_only VALUES (?, ?, ?, ?, ?)", new)
    con.execute("""
        CREATE OR REPLACE TABLE uscis_employer AS
        SELECT m.*, coalesce(m.employer_id, o.employer_id) AS final_id,
               m.employer_id IS NOT NULL AS matched, o.slug AS new_slug
        FROM uscis_match m LEFT JOIN uscis_only o USING (norm, state, tax4)
    """)
    con.execute("""
        CREATE OR REPLACE TABLE uscis_year AS
        SELECT e.final_id AS employer_id, u.fiscal_year, any_value(u.source_file) AS source_file,
               count(*)::INT AS rows,
               sum(u.initial_approvals)::INT AS initial_approvals,
               sum(u.initial_denials)::INT AS initial_denials,
               sum(u.continuing_approvals)::INT AS continuing_approvals,
               sum(u.continuing_denials)::INT AS continuing_denials,
               sum(u.new_employment_approvals)::INT AS new_employment_approvals
        FROM uscis_raw u JOIN uscis_norm n ON n.raw = u.employer_name
        JOIN uscis_employer e ON e.norm = n.norm AND e.state IS NOT DISTINCT FROM u.state
                             AND e.tax4 IS NOT DISTINCT FROM u.tax4
        GROUP BY 1, 2
    """)
    s = con.execute("""
        SELECT count(*), count(*) FILTER (WHERE matched),
               coalesce(sum(approvals), 0),
               coalesce(sum(approvals) FILTER (WHERE matched), 0)
        FROM uscis_employer
    """).fetchone()
    methods = con.execute(
        "SELECT method, count(*), sum(approvals) FROM uscis_employer GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall()
    unnamed = con.execute(
        "SELECT count(*), coalesce(sum(initial_approvals + continuing_approvals), 0) "
        "FROM uscis_raw WHERE employer_name IS NULL"
    ).fetchone()
    return {
        "uscis_employers": s[0], "matched": s[1], "approvals": int(s[2]),
        "approvals_matched": int(s[3]), "methods": methods, "raw_rows_without_name": unnamed,
    }  # fmt: skip


def write_report(stats: dict, path: Path) -> None:
    n, m, a, am = (stats[k] for k in ("uscis_employers", "matched", "approvals",
                                       "approvals_matched"))  # fmt: skip
    layouts = stats.get("layouts", {})
    files = ", ".join(f"{k} ({v})" for k, v in layouts.items()) or "none"
    lines = [
        "# USCIS to LCA join",
        "",
        "Generated by `uv run filed uscis`. USCIS H-1B Employer Data Hub files loaded:",
        f"{files}. FY2023 is the latest year USCIS publishes as a file; later years",
        "are loaded when a download from the hub's viewer is saved in data/raw/uscis/.",
        "",
        "A USCIS employer is one normalized name, state and tax ID (last 4 digits). It matches",
        "an LCA employer on normalized name plus employer state, with the last 4 FEIN digits",
        "used to confirm a single candidate and to choose among several.",
        "",
        "| | Matched | Total | Rate |",
        "| --- | ---: | ---: | ---: |",
        f"| USCIS employers | {m:,} | {n:,} | {m / n:.1%} |",
        f"| Approvals (initial + continuing) | {am:,} | {a:,} | {am / a:.1%} |",
        "",
        "| Outcome | USCIS employers | Approvals |",
        "| --- | ---: | ---: |",
    ]
    lines += [f"| {k} | {c:,} | {int(ap):,} |" for k, c, ap in stats["methods"]]
    rows, appr = stats["raw_rows_without_name"]
    lines += [
        "",
        f"{rows:,} USCIS rows have no employer name ({appr:,} approvals) and cannot be joined.",
        'Unmatched USCIS employers still get a page, labeled "no LCA match".',
        "",
    ]
    path.write_text("\n".join(lines))


def run() -> dict:
    con = ingest.connect()
    layouts = load_raw(con)
    stats = match(con)
    stats["layouts"] = layouts
    (manifest.ROOT / "eval").mkdir(exist_ok=True)
    write_report(stats, manifest.ROOT / "eval" / "join.md")
    log.info("uscis: %s", stats)
    return stats
