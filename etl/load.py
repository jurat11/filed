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
import time
import urllib.error
import urllib.request

import duckdb
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
    "agg_links": "links",
}

INDEXES = [
    "CREATE UNIQUE INDEX ON {s}.employers (slug)",
    "CREATE UNIQUE INDEX ON {s}.employers (employer_id)",
    "CREATE INDEX ON {s}.employers (uscis_initial_total DESC)",
    "CREATE INDEX ON {s}.aliases (employer_id)",
    "CREATE INDEX ON {s}.aliases USING gin (norm gin_trgm_ops)",
    "CREATE INDEX ON {s}.lca_year (employer_id, fiscal_year)",
    "CREATE INDEX ON {s}.lca_year_role (employer_id)",
    "CREATE INDEX ON {s}.lca_year_top (employer_id)",
    "CREATE INDEX ON {s}.lca_cube (fiscal_year, role_group, worksite_state, wage_level)",
    "CREATE INDEX ON {s}.lca_cube (employer_id)",
    "CREATE INDEX ON {s}.entry_signal (employer_id)",
    "CREATE INDEX ON {s}.uscis_year (employer_id)",
    "CREATE INDEX ON {s}.links (employer_a)",
    "CREATE INDEX ON {s}.links (employer_b)",
    "CREATE INDEX ON {s}.employers (naics, state, certified_total DESC)",
]

PG_TYPES = {
    "TINYINT": "smallint", "SMALLINT": "smallint", "INTEGER": "integer", "BIGINT": "bigint",
    "UTINYINT": "smallint", "USMALLINT": "integer", "UINTEGER": "bigint", "UBIGINT": "numeric",
    "HUGEINT": "numeric", "FLOAT": "real", "DOUBLE": "double precision", "VARCHAR": "text",
    "BOOLEAN": "boolean", "DATE": "date", "TIMESTAMP": "timestamp",
    "TIMESTAMP WITH TIME ZONE": "timestamptz",
}  # fmt: skip


class UnsupportedType(TypeError):
    pass


def pg_type(duck: str) -> str:
    """Postgres column type for a DuckDB column type. Unknown types fail the load instead
    of being guessed."""
    if duck.startswith("DECIMAL"):
        return "numeric" + duck[len("DECIMAL") :]
    if duck.endswith("[]"):
        return pg_type(duck[:-2]) + "[]"
    if duck not in PG_TYPES:
        raise UnsupportedType(f"no Postgres type for DuckDB type {duck}")
    return PG_TYPES[duck]


def copy_rows(cur: psycopg.Cursor, table: str, names: str, rel) -> None:
    with cur.copy(f"COPY {table} ({names}) FROM STDIN") as cp:
        while batch := rel.fetchmany(50_000):
            for row in batch:
                cp.write_row(row)


def database_url() -> str:
    return os.environ.get("DATABASE_URL_DIRECT") or os.environ["DATABASE_URL"]


class RevalidateError(RuntimeError):
    pass


def revalidate(loaded_at: str, attempts: int = 4, wait: float = 5.0) -> dict:
    """Ask the site to drop its cached pages (web/app/api/revalidate/route.ts).

    Needs FILED_SITE_URL and REVALIDATE_SECRET; skipped (with a log line) when either is
    unset, so a local load does not need the site. The site answers 409 until the database
    it reads shows this `loaded_at`; that is retried. Any other failure raises after the
    load has committed, so the data is live but the caller sees that pages may be stale for
    up to a day (the cache's fallback).
    """
    site, secret = os.environ.get("FILED_SITE_URL"), os.environ.get("REVALIDATE_SECRET")
    if not site or not secret:
        log.info("revalidate skipped: FILED_SITE_URL or REVALIDATE_SECRET not set")
        return {"skipped": True}
    body = json.dumps({"loaded_at": loaded_at}).encode()
    last = ""
    for i in range(attempts):
        req = urllib.request.Request(
            site.rstrip("/") + "/api/revalidate",
            data=body,
            method="POST",
            headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                out = json.loads(r.read())
                log.info("revalidated %s: %s", site, out)
                return out
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:200]!r}"
            if e.code not in (409, 502, 503, 504):
                break
        except urllib.error.URLError as e:
            last = str(e.reason)
        if i + 1 < attempts:
            time.sleep(wait * (i + 1))
    raise RevalidateError(f"revalidate {site} failed: {last}")


def run() -> dict:
    duck = ingest.connect()
    counts = load(duck, database_url())
    counts["revalidate"] = revalidate(counts["loaded_at"])
    return counts


def load(
    duck: duckdb.DuckDBPyConnection,
    url: str,
    files: dict | None = None,
    target: str = "filed",
) -> dict:
    """Copy the aggregate tables from `duck` into a new schema and swap it in as `target`.

    `files` is the manifest's file map for the sources table (default: data/manifest.json).
    """
    schema = target + "_" + dt.datetime.now(dt.UTC).strftime("%Y%m%d%H%M%S%f")
    counts = {}
    with psycopg.connect(url) as pg, pg.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        cur.execute(f"CREATE SCHEMA {schema}")
        for src, dst in TABLES.items():
            cols = duck.execute(f"DESCRIBE {src}").fetchall()
            ddl = ", ".join(f'"{c[0]}" {pg_type(c[1])}' for c in cols)
            cur.execute(f"CREATE TABLE {schema}.{dst} ({ddl})")
            names = ", ".join(f'"{c[0]}"' for c in cols)
            copy_rows(cur, f"{schema}.{dst}", names, duck.execute(f"SELECT {names} FROM {src}"))
            counts[dst] = duck.execute(f"SELECT count(*) FROM {src}").fetchone()[0]
            cur.execute(f"SELECT count(*) FROM {schema}.{dst}")
            loaded = cur.fetchone()[0]
            if loaded != counts[dst]:
                raise ingest.RowCountError(f"{dst}: DuckDB {counts[dst]}, Postgres {loaded}")
            log.info("loaded %s: %d rows", dst, loaded)

        # Sources and metadata for /sources.
        m = manifest.load()["files"] if files is None else files
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
            "uscis_years": json.dumps(
                [
                    r[0]
                    for r in duck.execute(
                        "SELECT DISTINCT fiscal_year FROM uscis_year ORDER BY 1"
                    ).fetchall()
                ]
            ),  # fmt: skip
            "entry_years": duck.execute("SELECT any_value(years) FROM agg_entry_signal").fetchone()[
                0
            ],
        }
        cur.executemany(f"INSERT INTO {schema}.meta VALUES (%s, %s)", list(meta.items()))
        counts["loaded_at"] = meta["loaded_at"]

        for ix in INDEXES:
            cur.execute(ix.format(s=schema))
        cur.execute(f"ANALYZE {schema}.lca_cube")
        cur.execute(f"DROP SCHEMA IF EXISTS {target} CASCADE")
        cur.execute(f"ALTER SCHEMA {schema} RENAME TO {target}")
        pg.commit()
    log.info("swapped %s in as %s", schema, target)
    return counts
