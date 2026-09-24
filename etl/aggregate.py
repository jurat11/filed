"""Build the tables the site reads, in DuckDB. load.py copies them to Neon.

Status groups: certified = "Certified"; withdrawn = "Withdrawn" + "Certified - Withdrawn";
denied = "Denied"; filed = all. Wage percentiles use certified, full-time rows with a
valid annual wage. Wage level and role group mixes use certified rows.
"""

from __future__ import annotations

import logging

import duckdb

from etl import cap_exempt, ingest
from etl import groups as parent_groups
from etl.soc import role_group_sql
from etl.wages import WAGE_MAX, WAGE_MIN

log = logging.getLogger(__name__)

# Role group selections for the entry-level signal.
# Neon space is tight (free plan), so only the selection the employer page shows is kept.
SELECTIONS: dict[str, list[str]] = {
    "swe_data_fin": [
        "Software engineering",
        "Data and analytics",
        "Finance",
        "Quant and actuarial",
    ],
}

CERT = "case_status = 'Certified'"
WAGE_OK = f"{CERT} AND full_time AND wage_valid"


def build(
    con: duckdb.DuckDBPyConnection,
    irs_paths: list | None = None,
    parents=None,
    record: bool = False,
) -> dict:
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE c AS
        SELECT *, {role_group_sql("soc_code")} AS role_group,
               coalesce(pw_wage_level, 'none') AS level,
               coalesce(pw_annual BETWEEN {WAGE_MIN} AND {WAGE_MAX}, false) AS pw_valid
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
            -- Missing when certified rows exist but none states a worker count.
            (CASE WHEN count(*) FILTER (WHERE {CERT}) = 0 THEN 0
                  ELSE sum(total_workers) FILTER (WHERE {CERT}) END)::INT AS certified_workers,
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
            round(quantile_cont(wage_annual, 0.25) FILTER (WHERE full_time AND wage_valid))
                AS wage_p25,
            round(quantile_cont(wage_annual, 0.50) FILTER (WHERE full_time AND wage_valid))
                AS wage_median,
            round(quantile_cont(wage_annual, 0.75) FILTER (WHERE full_time AND wage_valid))
                AS wage_p75,
            -- Prevailing wage on the same rows, for occupation and area context (D32).
            count(*) FILTER (WHERE full_time AND wage_valid AND pw_valid)::INT AS pw_rows,
            round(median(pw_annual) FILTER (WHERE full_time AND wage_valid AND pw_valid))
                AS pw_median
        FROM c WHERE {CERT}
          AND fiscal_year >= (SELECT max(fiscal_year) - 1 FROM lca)
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
        ) t WHERE rank <= 5
          AND fiscal_year = (SELECT max(fiscal_year) FROM c c2 WHERE c2.employer_id = t.employer_id
                             AND c2.case_status = 'Certified')
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_lca_cube AS
        SELECT employer_id, fiscal_year, role_group,
               coalesce(worksite_state, '??') AS worksite_state, level AS wage_level,
               count(*)::INT AS certified,
               count(*) FILTER (WHERE full_time AND wage_valid)::INT AS wage_rows,
               sum(wage_annual) FILTER (WHERE full_time AND wage_valid) AS wage_sum
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
    # USCIS initial approvals for the same years. If any of those years is not loaded,
    # the figure is unknown (NULL, uscis_years_loaded false), never zero or a partial sum.
    # If they are loaded and no USCIS record matched the employer, it is NULL too.
    loaded = {r[0] for r in con.execute("SELECT DISTINCT fiscal_year FROM uscis_year").fetchall()}
    all_loaded = set(last2) <= loaded
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_entry_signal AS
        SELECT s.*,
               CASE WHEN {all_loaded} THEN
                   (SELECT sum(initial_approvals) FROM uscis_year u
                    WHERE u.employer_id = s.employer_id
                      AND u.fiscal_year IN ({", ".join(map(str, last2))}))
               END::INT AS uscis_initial,
               {all_loaded} AS uscis_years_loaded
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
        -- Most frequent NAICS code on the employer's LCAs, for "similar employers".
        nc AS (
            SELECT employer_id, naics_code AS naics FROM lca WHERE naics_code IS NOT NULL
            GROUP BY 1, 2
            QUALIFY row_number() OVER (PARTITION BY employer_id
                                       ORDER BY count(*) DESC, naics_code) = 1
        )
        SELECT e.employer_id, e.slug, e.display_name, e.fein, e.city, e.state,
               true AS has_lca, us.employer_id IS NOT NULL AS has_uscis,
               e.lca_rows::INT AS lca_rows, lcay.certified_total,
               -- NULL when no USCIS record matched: unknown, not zero.
               us.uscis_initial_total,
               lcay.h1b_dependent_latest, coalesce(lcay.willful_violator_ever, false)
                   AS willful_violator_ever,
               nc.naics
        FROM employers e
        LEFT JOIN lcay USING (employer_id) LEFT JOIN us USING (employer_id)
        LEFT JOIN nc USING (employer_id)
        UNION ALL
        -- USCIS-only employers: no LCA match, so LCA counts are missing, not zero.
        SELECT o.employer_id, o.slug, m.name, NULL, m.city, m.state, false, true, NULL, NULL,
               us.uscis_initial_total, NULL, false, NULL
        FROM uscis_only o
        JOIN uscis_employer m USING (norm, state, tax4)
        LEFT JOIN us ON us.employer_id = o.employer_id
    """)
    # USCIS-only employers: the two-digit NAICS sector from the USCIS file.
    con.execute("""
        UPDATE agg_employers a SET naics = u.naics FROM (
            SELECT e.final_id AS employer_id,
                   mode(nullif(regexp_extract(r.naics, '^\\d+'), '')) AS naics
            FROM uscis_raw r JOIN uscis_norm n ON n.raw = r.employer_name
            JOIN uscis_employer e ON e.norm = n.norm AND e.state IS NOT DISTINCT FROM r.state
                                 AND e.tax4 IS NOT DISTINCT FROM r.tax4
            WHERE NOT e.matched GROUP BY 1
        ) u WHERE a.employer_id = u.employer_id AND NOT a.has_lca
    """)
    # "Likely cap-exempt" (D30): the rule that fired, never a yes/no fact.
    cap_exempt.load_irs(con, irs_paths or [], record=record)
    con.execute(f"""
        CREATE OR REPLACE TABLE agg_employers AS
        SELECT *, {cap_exempt.rule_sql("display_name", "naics", "fein")} AS cap_exempt_rule
        FROM agg_employers
    """)
    group_stats = parent_groups.build(con, parents) if parents else parent_groups.build(con)
    log.info("groups: %s", group_stats)
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
    # Different FEINs with one normalized name (employers.py): shown as related legal
    # entities on both employer pages, never merged.
    con.execute("""
        CREATE OR REPLACE TABLE agg_links AS
        SELECT employer_a, employer_b, norm_name FROM possible_links
    """)
    counts = {
        t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ["agg_groups", "agg_links", "agg_employers", "agg_aliases", "agg_lca_year",
                  "agg_lca_year_role", "agg_lca_year_top", "agg_lca_cube", "agg_entry_signal",
                  "uscis_year"]
    }  # fmt: skip
    log.info("aggregates: %s", counts)
    return counts


def run() -> dict:
    return build(ingest.connect(), irs_paths=cap_exempt.irs_files(), record=True)
