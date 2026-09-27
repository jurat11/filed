"""etl/load.py: DuckDB to Postgres types, the row count check and the schema swap.

The database tests need a throwaway Postgres in TEST_DATABASE_URL (CI runs one as a
service container) and are skipped without it. Never point it at Neon: the tests drop
and recreate the "filed" schema.
"""

from __future__ import annotations

import os

import psycopg
import pytest

from etl import ingest, load, seed

URL = os.environ.get("TEST_DATABASE_URL")
needs_pg = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.mark.parametrize(
    ("duck", "pg"),
    [
        ("INTEGER", "integer"),
        ("BIGINT", "bigint"),
        ("HUGEINT", "numeric"),
        ("DOUBLE", "double precision"),
        ("VARCHAR", "text"),
        ("BOOLEAN", "boolean"),
        ("DATE", "date"),
        ("DECIMAL(18,3)", "numeric(18,3)"),
        ("VARCHAR[]", "text[]"),
        ("TIMESTAMP WITH TIME ZONE", "timestamptz"),
    ],
)
def test_pg_type(duck, pg):
    assert load.pg_type(duck) == pg


def test_unknown_type_fails_loudly():
    with pytest.raises(load.UnsupportedType):
        load.pg_type("INTERVAL")


@pytest.fixture(scope="module")
def duck():
    return seed.build()


def test_every_aggregate_column_type_maps(duck):
    for src in load.TABLES:
        for name, typ, *_ in duck.execute(f"DESCRIBE {src}").fetchall():
            assert load.pg_type(typ), (src, name, typ)


@pytest.fixture
def pg():
    assert URL and "neon.tech" not in URL
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute("DROP SCHEMA IF EXISTS filed CASCADE")
        yield c


def _schemas(pg):
    return {r[0] for r in pg.execute(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'filed%'"
    ).fetchall()}  # fmt: skip


@needs_pg
def test_load_copies_every_table_with_mapped_types(duck, pg):
    counts = load.load(duck, URL, files=seed.manifest_files())
    for src, dst in load.TABLES.items():
        n = duck.execute(f"SELECT count(*) FROM {src}").fetchone()[0]
        assert counts[dst] == n
        assert pg.execute(f"SELECT count(*) FROM filed.{dst}").fetchone()[0] == n
        want = {c: load.pg_type(t) for c, t, *_ in duck.execute(f"DESCRIBE {src}").fetchall()}
        got = dict(pg.execute(
            "SELECT column_name, format_type(atttypid, atttypmod) FROM information_schema.columns "
            "JOIN pg_attribute ON attrelid = %s::regclass AND attname = column_name "
            "WHERE table_schema = 'filed' AND table_name = %s",
            [f"filed.{dst}", dst],
        ).fetchall())  # fmt: skip
        aliases = {
            "timestamptz": "timestamp with time zone",
            "timestamp": "timestamp without time zone",
        }
        assert got == {c: aliases.get(t, t) for c, t in want.items()}, dst
    assert _schemas(pg) == {"filed"}
    meta = dict(pg.execute("SELECT key, value FROM filed.meta").fetchall())
    assert meta["lca_years"] == "[2023, 2024, 2025, 2026]"
    assert meta["uscis_years"] == "[2023, 2024, 2025]"
    assert meta["entry_years"] == "2025-2026"
    assert pg.execute("SELECT count(*) FROM filed.sources").fetchone()[0] == len(
        seed.manifest_files()
    )


@needs_pg
def test_missing_values_stay_null_in_postgres(duck, pg):
    load.load(duck, URL, files=seed.manifest_files())
    uni = pg.execute(
        "SELECT has_lca, certified_total, lca_rows, uscis_initial_total FROM filed.employers "
        "WHERE display_name = 'SYNTHETIC TEST UNIVERSITY'"
    ).fetchone()
    assert uni == (False, None, None, 4)
    no_uscis = pg.execute(
        "SELECT count(*) FROM filed.employers WHERE NOT has_uscis AND uscis_initial_total = 0"
    ).fetchone()[0]
    assert no_uscis == 0


@needs_pg
def test_row_count_mismatch_aborts_and_keeps_the_old_schema(duck, pg, monkeypatch):
    load.load(duck, URL, files=seed.manifest_files())
    before = pg.execute("SELECT value FROM filed.meta WHERE key = 'loaded_at'").fetchone()
    real = load.copy_rows

    class Rows:
        def __init__(self, rows):
            self.rows = rows

        def fetchmany(self, n):
            out, self.rows = self.rows[:n], self.rows[n:]
            return out

    def drop_last_row(cur, table, names, rel):
        rows = rel.fetchall()
        real(cur, table, names, Rows(rows[:-1] if table.endswith(".lca_cube") else rows))

    monkeypatch.setattr(load, "copy_rows", drop_last_row)
    with pytest.raises(ingest.RowCountError, match="lca_cube"):
        load.load(duck, URL, files=seed.manifest_files())
    # The transaction rolled back: the old schema is untouched, no half-loaded copy remains.
    assert _schemas(pg) == {"filed"}
    assert pg.execute("SELECT value FROM filed.meta WHERE key = 'loaded_at'").fetchone() == before


@needs_pg
def test_reload_swaps_in_place(duck, pg):
    load.load(duck, URL, files=seed.manifest_files())
    load.load(duck, URL, files=seed.manifest_files())
    assert _schemas(pg) == {"filed"}
    idx = pg.execute("SELECT count(*) FROM pg_indexes WHERE schemaname = 'filed'").fetchone()[0]
    assert idx >= len(load.INDEXES) + 1  # + the meta primary key


# ---- revalidation ----------------------------------------------------------------------


class _Site:
    """A local stand-in for /api/revalidate that answers from a list of status codes."""

    def __init__(self, statuses):
        import http.server
        import threading

        self.statuses, self.requests = list(statuses), []
        site = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                site.requests.append((self.path, self.headers["Authorization"], body))
                code = site.statuses.pop(0)
                self.send_response(code)
                self.end_headers()
                self.wfile.write(b'{"revalidated": true}' if code == 200 else b'{"error": "x"}')

            def log_message(self, *a):
                pass

        self.server = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"


def test_revalidate_skipped_without_config(monkeypatch):
    monkeypatch.delenv("FILED_SITE_URL", raising=False)
    monkeypatch.delenv("REVALIDATE_SECRET", raising=False)
    assert load.revalidate("2026-01-01T00:00:00+00:00") == {"skipped": True}


def test_revalidate_posts_loaded_at_and_retries_409(monkeypatch):
    site = _Site([409, 200])
    monkeypatch.setenv("FILED_SITE_URL", site.url + "/")
    monkeypatch.setenv("REVALIDATE_SECRET", "s3cret")
    assert load.revalidate("2026-01-01T00:00:00+00:00", wait=0) == {"revalidated": True}
    assert len(site.requests) == 2
    path, auth, body = site.requests[-1]
    assert (path, auth) == ("/api/revalidate", "Bearer s3cret")
    assert body == b'{"loaded_at": "2026-01-01T00:00:00+00:00"}'


def test_revalidate_fails_loudly_on_auth_error(monkeypatch):
    site = _Site([401])
    monkeypatch.setenv("FILED_SITE_URL", site.url)
    monkeypatch.setenv("REVALIDATE_SECRET", "wrong")
    with pytest.raises(load.RevalidateError, match="401"):
        load.revalidate("x", wait=0)
    assert len(site.requests) == 1
