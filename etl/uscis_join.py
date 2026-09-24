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
import logging
from pathlib import Path

import duckdb

from etl import ingest, manifest
from etl.employers import slugify
from etl.names import normalize_name

log = logging.getLogger(__name__)

RAW_USCIS = manifest.RAW / "uscis"
FILES = {
    2023: (
        "h1b_datahubexport-2023.csv",
        "https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-2023.csv",
    ),
}


def csv_rows(path: Path) -> int:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return sum(1 for _ in csv.reader(f)) - 1


def load_raw(con: duckdb.DuckDBPyConnection) -> None:
    parts = []
    for fy, (name, url) in FILES.items():
        p = RAW_USCIS / name
        raw = csv_rows(p)
        sql = f"""
            SELECT {fy} AS fiscal_year, '{name}' AS source_file,
                   nullif(trim("Employer"), '') AS employer_name,
                   upper(nullif(trim("State"), '')) AS state,
                   upper(nullif(trim("City"), '')) AS city,
                   lpad(nullif(trim("Tax ID"), ''), 4, '0') AS tax4,
                   TRY_CAST("Initial Approval" AS INT) AS initial_approvals,
                   TRY_CAST("Initial Denial" AS INT) AS initial_denials,
                   TRY_CAST("Continuing Approval" AS INT) AS continuing_approvals,
                   TRY_CAST("Continuing Denial" AS INT) AS continuing_denials
            FROM read_csv('{p}', all_varchar = true, header = true)
        """
        loaded = con.execute(f"SELECT count(*) FROM ({sql})").fetchone()[0]
        if loaded != raw:
            raise ingest.RowCountError(f"{name}: raw {raw} rows, loaded {loaded}")
        manifest.record(
            p, url, kind="uscis", fiscal_year=fy, quarter=4, raw_rows=raw, loaded_rows=loaded
        )
        parts.append(sql)
    con.execute("CREATE OR REPLACE TABLE uscis_raw AS " + " UNION ALL ".join(parts))
    names = [r[0] for r in con.execute(
        "SELECT DISTINCT employer_name FROM uscis_raw WHERE employer_name IS NOT NULL"
    ).fetchall()]  # fmt: skip
    con.execute("CREATE OR REPLACE TABLE uscis_norm (raw VARCHAR, norm VARCHAR)")
    con.executemany("INSERT INTO uscis_norm VALUES (?, ?)", [(n, normalize_name(n)) for n in names])


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
               sum(u.continuing_denials)::INT AS continuing_denials
        FROM uscis_raw u JOIN uscis_norm n ON n.raw = u.employer_name
        JOIN uscis_employer e ON e.norm = n.norm AND e.state IS NOT DISTINCT FROM u.state
                             AND e.tax4 IS NOT DISTINCT FROM u.tax4
        GROUP BY 1, 2
    """)
    s = con.execute("""
        SELECT count(*), count(*) FILTER (WHERE matched),
               sum(approvals), sum(approvals) FILTER (WHERE matched)
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
    lines = [
        "# USCIS to LCA join",
        "",
        "Generated by `uv run filed uscis`. USCIS H-1B Employer Data Hub, FY2023 export",
        "(the latest year USCIS publishes as a file; later years are only in the hub's",
        "interactive view and are not loaded).",
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
    load_raw(con)
    stats = match(con)
    (manifest.ROOT / "eval").mkdir(exist_ok=True)
    write_report(stats, manifest.ROOT / "eval" / "join.md")
    log.info("uscis: %s", stats)
    return stats
