"""Employer resolution: group LCA rows into employers.

1. Rows with a valid EMPLOYER_FEIN are grouped by FEIN. One FEIN is one employer, and its
   display name is the most frequent spelling (ties go to the most recent fiscal year,
   then alphabetical order).
2. Rows without a FEIN (all of FY2023, where DOL withheld it, and a few rows with a
   malformed or placeholder FEIN) are keyed by normalized name plus employer state. If
   one FEIN holds at least DOMINANT_SHARE of the FEIN rows with that key, the rows join
   that FEIN employer. (A share, not "exactly one", because a single typo elsewhere, such
   as one "Amazon.com Services LLC" row under another company's FEIN, would otherwise
   strand 11,534 FY2023 Amazon cases.) If the key has no FEIN rows at all and the
   normalized name maps to exactly one FEIN in any state, they join that one (companies
   move headquarters). Otherwise they form a name-based employer of their own.
3. Different FEINs that share a normalized name are never merged. Each such pair is
   written to possible_links for review.

Tables written to DuckDB: name_norm, employers, employer_aliases, possible_links, and an
employer_id column on lca.
"""

from __future__ import annotations

import logging
import re
import unicodedata

import duckdb

from etl import ingest
from etl.names import normalize_name

log = logging.getLogger(__name__)

DOMINANT_SHARE = 0.95


def slugify(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80].rstrip("-") or "employer"


def build_name_norm(con: duckdb.DuckDBPyConnection) -> int:
    names = [
        r[0]
        for r in con.execute(
            "SELECT DISTINCT employer_name FROM lca WHERE employer_name IS NOT NULL"
        ).fetchall()
    ]
    con.execute("CREATE OR REPLACE TABLE name_norm (raw VARCHAR PRIMARY KEY, norm VARCHAR)")
    con.executemany("INSERT INTO name_norm VALUES (?, ?)", [(n, normalize_name(n)) for n in names])
    return len(names)


def resolve(con: duckdb.DuckDBPyConnection) -> dict:
    n_names = build_name_norm(con)

    # Row-level keys. FEIN rows key on the FEIN; others on name + state.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE keyed AS
        SELECT l.fiscal_year, l.case_number, l.employer_fein, l.employer_name,
               l.employer_state, l.employer_city, coalesce(n.norm, '') AS norm
        FROM lca l LEFT JOIN name_norm n ON n.raw = l.employer_name
    """)

    # Which FEINs each (normalized name, state) points to, from rows that have a FEIN,
    # and the FEIN holding the largest share of those rows.
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE name_state_fein AS
        WITH c AS (
            SELECT norm, employer_state, employer_fein, count(*) AS n
            FROM keyed WHERE employer_fein IS NOT NULL AND norm <> ''
            GROUP BY 1, 2, 3
        )
        SELECT norm, employer_state, list(employer_fein) AS feins,
               arg_max(employer_fein, n) AS top_fein,
               max(n) / sum(n) >= {DOMINANT_SHARE} AS dominant
        FROM c GROUP BY 1, 2
    """)

    con.execute("""
        CREATE OR REPLACE TEMP TABLE name_fein AS
        SELECT norm, list(DISTINCT employer_fein) AS feins
        FROM keyed WHERE employer_fein IS NOT NULL AND norm <> ''
        GROUP BY 1
    """)

    con.execute("""
        CREATE OR REPLACE TEMP TABLE row_key AS
        SELECT k.*,
            CASE
                WHEN k.employer_fein IS NOT NULL THEN 'F:' || k.employer_fein
                WHEN nsf.dominant THEN 'F:' || nsf.top_fein
                WHEN nsf.feins IS NULL AND len(nf.feins) = 1 THEN 'F:' || nf.feins[1]
                ELSE 'N:' || k.norm || '|' || coalesce(k.employer_state, '')
            END AS employer_key,
            CASE
                WHEN k.employer_fein IS NOT NULL THEN 'fein'
                WHEN nsf.dominant AND len(nsf.feins) = 1 THEN 'name_state_to_fein'
                WHEN nsf.dominant THEN 'name_state_to_dominant_fein'
                WHEN nsf.feins IS NULL AND len(nf.feins) = 1 THEN 'name_to_fein'
                WHEN nsf.feins IS NOT NULL OR len(nf.feins) > 1 THEN 'name_state_ambiguous'
                ELSE 'name_state'
            END AS match_method
        FROM keyed k
        LEFT JOIN name_state_fein nsf
          ON k.employer_fein IS NULL AND nsf.norm = k.norm
         AND nsf.employer_state IS NOT DISTINCT FROM k.employer_state
        LEFT JOIN name_fein nf ON k.employer_fein IS NULL AND nf.norm = k.norm
    """)

    # Display name: most frequent raw spelling; ties to latest year, then alphabetical.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE name_counts AS
        SELECT employer_key, employer_name, count(*) AS n, max(fiscal_year) AS last_fy
        FROM row_key WHERE employer_name IS NOT NULL GROUP BY 1, 2
    """)
    con.execute("""
        CREATE OR REPLACE TEMP TABLE emp AS
        WITH display AS (
            SELECT employer_key, employer_name AS display_name
            FROM name_counts
            QUALIFY row_number() OVER (
                PARTITION BY employer_key ORDER BY n DESC, last_fy DESC, employer_name) = 1
        ),
        place AS (
            SELECT employer_key, employer_city AS city, employer_state AS state
            FROM row_key WHERE employer_state IS NOT NULL
            GROUP BY 1, 2, 3
            QUALIFY row_number() OVER (
                PARTITION BY employer_key ORDER BY count(*) DESC, employer_city) = 1
        ),
        totals AS (
            SELECT employer_key, count(*) AS lca_rows,
                   any_value(match_method ORDER BY match_method = 'fein' DESC) AS method
            FROM row_key GROUP BY 1
        )
        SELECT t.employer_key, coalesce(d.display_name, '(no name)') AS display_name,
               CASE WHEN t.employer_key LIKE 'F:%' THEN substr(t.employer_key, 3) END AS fein,
               p.city, p.state, t.lca_rows
        FROM totals t
        LEFT JOIN display d USING (employer_key)
        LEFT JOIN place p USING (employer_key)
    """)

    # Stable integer ids and unique slugs, biggest employers first.
    rows = con.execute(
        "SELECT employer_key, display_name, fein, state FROM emp "
        "ORDER BY lca_rows DESC, employer_key"
    ).fetchall()
    seen: set[str] = set()
    ids = []
    for i, (key, name, fein, state) in enumerate(rows, start=1):
        base = slugify(name)
        slug = base
        if slug in seen:
            slug = f"{base}-{(state or 'xx').lower()}"
        if slug in seen and fein:
            slug = f"{base}-{fein[-4:]}"
        n = 2
        while slug in seen:
            slug = f"{base}-{n}"
            n += 1
        seen.add(slug)
        ids.append((key, i, slug))
    con.execute(
        "CREATE OR REPLACE TEMP TABLE emp_ids (employer_key VARCHAR, employer_id INT, slug VARCHAR)"
    )
    con.executemany("INSERT INTO emp_ids VALUES (?, ?, ?)", ids)

    con.execute("""
        CREATE OR REPLACE TABLE employers AS
        SELECT i.employer_id, i.slug, e.* FROM emp e JOIN emp_ids i USING (employer_key)
        ORDER BY i.employer_id
    """)
    con.execute("""
        CREATE OR REPLACE TABLE employer_aliases AS
        SELECT i.employer_id, c.employer_name AS name, n.norm, sum(c.n)::INT AS rows
        FROM name_counts c
        JOIN emp_ids i USING (employer_key)
        LEFT JOIN name_norm n ON n.raw = c.employer_name
        GROUP BY 1, 2, 3
        ORDER BY 1, 4 DESC
    """)

    # Different FEINs sharing a normalized name: record, never merge.
    con.execute("""
        CREATE OR REPLACE TABLE possible_links AS
        WITH fn AS (
            SELECT DISTINCT a.norm, e.fein, e.employer_id
            FROM employer_aliases a JOIN employers e USING (employer_id)
            WHERE e.fein IS NOT NULL AND a.norm <> ''
        )
        SELECT x.norm AS norm_name, x.fein AS fein_a, y.fein AS fein_b,
               x.employer_id AS employer_a, y.employer_id AS employer_b
        FROM fn x JOIN fn y ON x.norm = y.norm AND x.fein < y.fein
        ORDER BY 1, 2, 3
    """)

    # Attach employer_id to every case.
    have = {r[0] for r in con.execute("DESCRIBE lca").fetchall()}
    exclude = "EXCLUDE (employer_id, match_method)" if "employer_id" in have else ""
    con.execute(f"""
        CREATE OR REPLACE TABLE lca AS
        SELECT l.* {exclude}, i.employer_id, r.match_method
        FROM lca l
        JOIN row_key r USING (fiscal_year, case_number)
        JOIN emp_ids i USING (employer_key)
    """)

    stats = dict(
        zip(
            ["cases", "employers", "fein_employers", "name_employers", "aliases",
             "possible_link_pairs"],
            con.execute("""
                SELECT (SELECT count(*) FROM lca),
                       (SELECT count(*) FROM employers),
                       (SELECT count(*) FROM employers WHERE fein IS NOT NULL),
                       (SELECT count(*) FROM employers WHERE fein IS NULL),
                       (SELECT count(*) FROM employer_aliases),
                       (SELECT count(*) FROM possible_links)
            """).fetchone(),
            strict=True,
        )
    )  # fmt: skip
    stats["distinct_raw_names"] = n_names
    stats["by_method"] = dict(
        con.execute("SELECT match_method, count(*) FROM lca GROUP BY 1 ORDER BY 1").fetchall()
    )
    stats["fy2023_by_method"] = dict(
        con.execute(
            "SELECT match_method, count(*) FROM lca WHERE fiscal_year = 2023 GROUP BY 1 ORDER BY 1"
        ).fetchall()
    )
    log.info("employers: %s", stats)
    return stats


def run() -> dict:
    return resolve(ingest.connect())
