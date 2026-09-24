"""Load the aggregate tables into Neon Postgres without the site ever seeing half a load.

Inside one transaction: create schema filed_<timestamp>, create each table from its DuckDB
column types, COPY the rows in, add indexes, then drop the old "filed" schema and rename
the new one to "filed". Postgres DDL is transactional, so readers see either the old
schema or the complete new one.

Neon holds aggregates only (docs/decisions.md D10); the case-level table stays in DuckDB.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os

import psycopg

from etl import ingest, manifest

log = logging.getLogger(__name__)

# DuckDB table -> Postgres table.
TABLES = {
    "agg_employers": "employers",
    "agg_aliases": "aliases",
    "agg_lca_year": "lca_year",
    "agg_lca_year_role": "lca_year_role",
    "agg_lca_year_top": "lca_year_top",
    "agg_lca_cube": "lca_cube",
    "agg_entry_signal": "entry_signal",
    "uscis_year": "uscis_year",
}

INDEXES = [
    "CREATE UNIQUE INDEX ON {s}.employers (slug)",
    "CREATE UNIQUE INDEX ON {s}.employers (employer_id)",
    "CREATE INDEX ON {s}.employers USING gin (search_text gin_trgm_ops)",
    "CREATE INDEX ON {s}.employers (uscis_initial_total DESC)",
    "CREATE INDEX ON {s}.aliases (employer_id)",
    "CREATE INDEX ON {s}.lca_year (employer_id, fiscal_year)",
    "CREATE INDEX ON {s}.lca_year_role (employer_id)",
    "CREATE INDEX ON {s}.lca_year_top (employer_id)",
    "CREATE INDEX ON {s}.lca_cube (fiscal_year, role_group, worksite_state, wage_level)",
    "CREATE INDEX ON {s}.lca_cube (employer_id)",
    "CREATE INDEX ON {s}.entry_signal (employer_id)",
    "CREATE INDEX ON {s}.uscis_year (employer_id)",
]

PG_TYPES = {
    "INTEGER": "integer", "BIGINT": "bigint", "HUGEINT": "numeric", "DOUBLE": "double precision",
    "VARCHAR": "text", "BOOLEAN": "boolean", "DATE": "date",
}  # fmt: skip


def pg_type(duck: str) -> str:
    return "numeric" if duck.startswith("DECIMAL") else PG_TYPES[duck]


def run() -> dict:
    url = os.environ.get("DATABASE_URL_DIRECT") or os.environ["DATABASE_URL"]
    duck = ingest.connect()
    schema = "filed_" + dt.datetime.now(dt.UTC).strftime("%Y%m%d%H%M%S")
    counts = {}
    with psycopg.connect(url) as pg, pg.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        cur.execute(f"CREATE SCHEMA {schema}")
        for src, dst in TABLES.items():
            cols = duck.execute(f"DESCRIBE {src}").fetchall()
            ddl = ", ".join(f'"{c[0]}" {pg_type(c[1])}' for c in cols)
            cur.execute(f"CREATE TABLE {schema}.{dst} ({ddl})")
            names = ", ".join(f'"{c[0]}"' for c in cols)
            rel = duck.execute(f"SELECT {names} FROM {src}")
            with cur.copy(f"COPY {schema}.{dst} ({names}) FROM STDIN") as cp:
                while batch := rel.fetchmany(50_000):
                    for row in batch:
                        cp.write_row(row)
            counts[dst] = duck.execute(f"SELECT count(*) FROM {src}").fetchone()[0]
            cur.execute(f"SELECT count(*) FROM {schema}.{dst}")
            loaded = cur.fetchone()[0]
            if loaded != counts[dst]:
                raise ingest.RowCountError(f"{dst}: DuckDB {counts[dst]}, Postgres {loaded}")
            log.info("loaded %s: %d rows", dst, loaded)

        # Sources and metadata for /sources.
        m = manifest.load()["files"]
        cur.execute(f"""CREATE TABLE {schema}.sources (file text, kind text, fiscal_year int,
            quarter int, source_url text, downloaded date, sha256 text, bytes bigint,
            raw_rows bigint, loaded_rows bigint, decision_date_min date, decision_date_max date)""")
        for v in m.values():
            cur.execute(
                f"INSERT INTO {schema}.sources VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                [v["name"], v.get("kind"), v.get("fiscal_year"), v.get("quarter"),
                 v["source_url"], v["downloaded"], v["sha256"], v["bytes"], v.get("raw_rows"),
                 v.get("loaded_rows"), v.get("decision_date_min"), v.get("decision_date_max")],
            )  # fmt: skip
        cur.execute(f"CREATE TABLE {schema}.meta (key text PRIMARY KEY, value text)")
        years = [r[0] for r in duck.execute(
            "SELECT DISTINCT fiscal_year FROM lca ORDER BY 1").fetchall()]  # fmt: skip
        meta = {
            "loaded_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "lca_years": json.dumps(years),
            "uscis_years": json.dumps([2023]),
            "entry_years": duck.execute("SELECT any_value(years) FROM agg_entry_signal").fetchone()[
                0
            ],
        }
        cur.executemany(f"INSERT INTO {schema}.meta VALUES (%s, %s)", list(meta.items()))

        for ix in INDEXES:
            cur.execute(ix.format(s=schema))
        cur.execute(f"ANALYZE {schema}.lca_cube")
        cur.execute("DROP SCHEMA IF EXISTS filed CASCADE")
        cur.execute(f"ALTER SCHEMA {schema} RENAME TO filed")
        pg.commit()
    log.info("swapped %s in as filed", schema)
    return counts
