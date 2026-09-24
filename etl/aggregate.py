"""Build the tables the site reads, in DuckDB. load.py copies them to Neon.

Status groups: certified = "Certified"; withdrawn = "Withdrawn" + "Certified - Withdrawn";
denied = "Denied"; filed = all. Wage percentiles use certified, full-time rows with a
valid annual wage. Wage level and role group mixes use certified rows.
"""

from __future__ import annotations

import logging

import duckdb

from etl import ingest
from etl.soc import ROLE_GROUPS, role_group_sql

log = logging.getLogger(__name__)

# Role group selections for the entry-level signal.
SELECTIONS: dict[str, list[str]] = {
    "software": ["Software engineering"],
    "swe_data_fin": [
        "Software engineering",
        "Data and analytics",
        "Finance",
        "Quant and actuarial",
    ],
    "all": [*ROLE_GROUPS, "Other"],
}

CERT = "case_status = 'Certified'"
WAGE_OK = f"{CERT} AND full_time AND wage_valid"


def build(con: duckdb.DuckDBPyConnection) -> dict:
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE c AS
        SELECT *, {role_group_sql("soc_code")} AS role_group,
               coalesce(pw_wage_level, 'none') AS level
        FROM lca
    """)
    # Source label per fiscal year: the files behind it, and the latest quarter.
    con.execute("""
        CREATE OR REPLACE TEMP TABLE fy_src AS
        SELECT fiscal_year,
               CASE WHEN count(DISTINCT source_file) = 1 THEN any_value(source_file)
                    ELSE 'LCA_Disclosure_Data_FY' || fiscal_year || '_Q1-Q' || max(source_quarter)
               END AS source_file,
               max(source_quarter) AS quarter
        FROM lca GROUP BY 1
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_lca_year AS
        SELECT employer_id, fiscal_year, s.source_file, s.quarter,
            count(*)::INT AS filed,
            count(*) FILTER (WHERE {CERT})::INT AS certified,
            count(*) FILTER (WHERE case_status IN ('Withdrawn', 'Certified - Withdrawn'))::INT
                AS withdrawn,
            count(*) FILTER (WHERE case_status = 'Denied')::INT AS denied,
            coalesce(sum(total_workers) FILTER (WHERE {CERT}), 0)::INT AS certified_workers,
            count(*) FILTER (WHERE {WAGE_OK})::INT AS wage_rows,
            round(quantile_cont(wage_annual, 0.25) FILTER (WHERE {WAGE_OK})) AS wage_p25,
            round(quantile_cont(wage_annual, 0.50) FILTER (WHERE {WAGE_OK})) AS wage_median,
            round(quantile_cont(wage_annual, 0.75) FILTER (WHERE {WAGE_OK})) AS wage_p75,
            count(*) FILTER (WHERE {CERT} AND level = 'I')::INT AS level_i,
            count(*) FILTER (WHERE {CERT} AND level = 'II')::INT AS level_ii,
            count(*) FILTER (WHERE {CERT} AND level = 'III')::INT AS level_iii,
            count(*) FILTER (WHERE {CERT} AND level = 'IV')::INT AS level_iv,
            count(*) FILTER (WHERE {CERT} AND level = 'none')::INT AS level_none,
            bool_or(h1b_dependent) AS h1b_dependent,
            bool_or(willful_violator) AS willful_violator
        FROM c JOIN fy_src s USING (fiscal_year)
        GROUP BY employer_id, fiscal_year, s.source_file, s.quarter
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_lca_year_role AS
        SELECT employer_id, fiscal_year, role_group,
            count(*)::INT AS certified,
            count(*) FILTER (WHERE level = 'I')::INT AS level_i,
            count(*) FILTER (WHERE level = 'II')::INT AS level_ii,
            count(*) FILTER (WHERE full_time AND wage_valid)::INT AS wage_rows,
            round(median(wage_annual) FILTER (WHERE full_time AND wage_valid)) AS wage_median
        FROM c WHERE {CERT}
        GROUP BY ALL
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_lca_year_top AS
        SELECT * FROM (
            SELECT employer_id, fiscal_year, 'title' AS kind, upper(job_title) AS value,
                   count(*)::INT AS certified,
                   row_number() OVER (PARTITION BY employer_id, fiscal_year
                                      ORDER BY count(*) DESC, upper(job_title))::INT AS rank
            FROM c WHERE {CERT} AND job_title IS NOT NULL GROUP BY 1, 2, 4
            UNION ALL
            SELECT employer_id, fiscal_year, 'state', worksite_state, count(*)::INT,
                   row_number() OVER (PARTITION BY employer_id, fiscal_year
                                      ORDER BY count(*) DESC, worksite_state)::INT
            FROM c WHERE {CERT} AND worksite_state IS NOT NULL GROUP BY 1, 2, 4
        ) WHERE rank <= 5
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_lca_cube AS
        SELECT employer_id, fiscal_year, role_group,
               coalesce(worksite_state, '??') AS worksite_state, level AS wage_level,
               count(*)::INT AS certified,
               count(*) FILTER (WHERE full_time AND wage_valid)::INT AS wage_rows,
               coalesce(sum(wage_annual) FILTER (WHERE full_time AND wage_valid), 0) AS wage_sum
        FROM c WHERE {CERT}
        GROUP BY ALL
    """)

    last2 = [r[0] for r in con.execute(
        "SELECT DISTINCT fiscal_year FROM lca ORDER BY 1 DESC LIMIT 2"
    ).fetchall()]  # fmt: skip
    years = f"{min(last2)}-{max(last2)}"
    parts = []
    for sel, groups in SELECTIONS.items():
        g = ", ".join(f"'{x}'" for x in groups)
        parts.append(f"""
            SELECT employer_id, '{sel}' AS role_selection, '{years}' AS years,
                   count(*) FILTER (WHERE role_group IN ({g}) AND level IN ('I', 'II'))::INT
                       AS entry_lcas,
                   count(*)::INT AS certified_all
            FROM c WHERE {CERT} AND fiscal_year IN ({", ".join(map(str, last2))})
            GROUP BY employer_id
        """)
    # USCIS initial approvals are only loaded for FY2023, so for these years they are
    # unknown (NULL), never zero.
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_entry_signal AS
        SELECT s.*, (SELECT sum(initial_approvals) FROM uscis_year u
                     WHERE u.employer_id = s.employer_id
                       AND u.fiscal_year IN ({", ".join(map(str, last2))}))::INT AS uscis_initial
        FROM ({" UNION ALL ".join(parts)}) s
    """)

    # Employers: LCA employers plus USCIS-only ones.
    con.execute("""
        CREATE OR REPLACE TABLE agg_employers AS
        WITH lcay AS (
            SELECT employer_id, sum(certified)::INT AS certified_total,
                   arg_max(h1b_dependent, fiscal_year) AS h1b_dependent_latest,
                   coalesce(bool_or(willful_violator), false) AS willful_violator_ever
            FROM agg_lca_year GROUP BY 1
        ),
        us AS (
            SELECT employer_id, sum(initial_approvals)::INT AS uscis_initial_total
            FROM uscis_year GROUP BY 1
        ),
        al AS (
            SELECT employer_id, string_agg(name, ' | ' ORDER BY rows DESC) AS names
            FROM (SELECT employer_id, name, rows FROM employer_aliases
                  QUALIFY row_number() OVER (PARTITION BY employer_id ORDER BY rows DESC) <= 25)
            GROUP BY 1
        )
        SELECT e.employer_id, e.slug, e.display_name, e.fein, e.city, e.state,
               true AS has_lca, us.employer_id IS NOT NULL AS has_uscis,
               e.lca_rows::INT AS lca_rows, coalesce(lcay.certified_total, 0) AS certified_total,
               coalesce(us.uscis_initial_total, 0) AS uscis_initial_total,
               lcay.h1b_dependent_latest, coalesce(lcay.willful_violator_ever, false)
                   AS willful_violator_ever,
               e.display_name || ' | ' || coalesce(al.names, '') AS search_text
        FROM employers e
        LEFT JOIN lcay USING (employer_id) LEFT JOIN us USING (employer_id)
        LEFT JOIN al USING (employer_id)
        UNION ALL
        SELECT o.employer_id, o.slug, m.name, NULL, m.city, m.state, false, true, 0, 0,
               coalesce(us.uscis_initial_total, 0), NULL, false, m.name
        FROM uscis_only o
        JOIN uscis_employer m USING (norm, state, tax4)
        LEFT JOIN us ON us.employer_id = o.employer_id
    """)
    con.execute("""
        CREATE OR REPLACE TABLE agg_aliases AS
        SELECT employer_id, name, norm, 'lca' AS source, rows FROM employer_aliases
        UNION ALL
        SELECT m.final_id, u.employer_name, n.norm, 'uscis', count(*)::INT
        FROM uscis_raw u JOIN uscis_norm n ON n.raw = u.employer_name
        JOIN uscis_employer m ON m.norm = n.norm AND m.state IS NOT DISTINCT FROM u.state
                             AND m.tax4 IS NOT DISTINCT FROM u.tax4
        GROUP BY 1, 2, 3
    """)
    counts = {
        t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ["agg_employers", "agg_aliases", "agg_lca_year", "agg_lca_year_role",
                  "agg_lca_year_top", "agg_lca_cube", "agg_entry_signal", "uscis_year"]
    }  # fmt: skip
    log.info("aggregates: %s", counts)
    return counts


def run() -> dict:
    return build(ingest.connect())
