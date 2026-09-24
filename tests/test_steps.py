"""Step fingerprints: what changes them, and what the manifest records."""

import json

import duckdb
import pytest

from etl import manifest, steps
from etl.columns import RAW_FILES


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    (raw / "dol").mkdir(parents=True)
    (raw / "uscis").mkdir()
    for rf in RAW_FILES:
        (raw / "dol" / rf.name).write_bytes(rf.name.encode())
    (raw / "uscis" / "h1b_datahubexport-2023.csv").write_text("x")
    monkeypatch.setattr(manifest, "RAW", raw)
    monkeypatch.setattr(manifest, "MANIFEST", tmp_path / "manifest.json")
    monkeypatch.setattr(steps, "HASH_CACHE", tmp_path / "hash_cache.json")
    from etl import uscis_join

    monkeypatch.setattr(uscis_join, "RAW_USCIS", raw / "uscis")
    monkeypatch.setattr(uscis_join.present, "__defaults__", (uscis_join.FILES, raw / "uscis"))
    return raw


def test_fingerprints_are_stable(sandbox):
    assert steps.fingerprints() == steps.fingerprints()


def test_a_new_dol_file_changes_ingest_and_everything_after(sandbox):
    before = steps.fingerprints()
    (sandbox / "dol" / "LCA_Disclosure_Data_FY2026_Q3.xlsx").write_bytes(b"new release")
    after = steps.fingerprints()
    assert all(before[s] != after[s] for s in steps.ORDER)


def test_a_new_uscis_file_leaves_the_lca_steps_alone(sandbox):
    before = steps.fingerprints()
    (sandbox / "uscis" / "uscis_hub_FY2024.csv").write_text("new year")
    after = steps.fingerprints()
    assert [s for s in steps.ORDER if before[s] != after[s]] == ["uscis", "aggregate", "load"]


def test_only_the_changed_fiscal_year_changes(sandbox):
    before = steps.year_fingerprints()
    (sandbox / "dol" / "LCA_Disclosure_Data_FY2025_Q4.xlsx").write_bytes(b"corrected")
    after = steps.year_fingerprints()
    assert [fy for fy in before if before[fy] != after[fy]] == ["2025"]


def test_code_change_changes_its_step(sandbox, monkeypatch):
    before = steps.fingerprints()
    real = steps.code_hash
    monkeypatch.setattr(steps, "code_hash", lambda s: real(s) + ("x" if s == "resolve" else ""))
    after = steps.fingerprints()
    assert [s for s in steps.ORDER if before[s] != after[s]] == [
        "resolve", "uscis", "aggregate", "load",
    ]  # fmt: skip


def test_hash_cache_is_used_while_size_and_mtime_hold(sandbox, monkeypatch):
    p = sandbox / "dol" / RAW_FILES[0].name
    first = steps.file_sha(p)
    monkeypatch.setattr(manifest, "sha256", lambda _: pytest.fail("re-hashed"))
    assert steps.file_sha(p) == first


def test_is_current_needs_the_fingerprint_and_the_outputs(sandbox):
    con = duckdb.connect()
    steps.mark_done("resolve", "fp1")
    assert not steps.is_current(con, "resolve", "fp1")  # tables missing
    for t in steps.OUTPUTS["resolve"]:
        con.execute(f"CREATE TABLE {t} (x INT)")
    assert steps.is_current(con, "resolve", "fp1")
    assert not steps.is_current(con, "resolve", "fp2")


def test_mark_done_drops_later_steps_only_when_the_fingerprint_changes(sandbox):
    for s in ["ingest", "wages", "resolve"]:
        steps.mark_done(s, f"{s}-1")
    steps.mark_done("wages", "wages-1")  # same fingerprint: later steps stay
    assert list(steps.recorded()) == ["ingest", "wages", "resolve"]
    steps.mark_done("wages", "wages-2")
    assert list(steps.recorded()) == ["ingest", "wages"]
    assert json.loads(manifest.MANIFEST.read_text())["steps"]["wages"]["fingerprint"] == "wages-2"
