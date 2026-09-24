"""`filed all`: which steps run, which are skipped, and what gets recorded."""

import sys

import duckdb
import pytest

from etl import cli, ingest, load, manifest, steps


@pytest.fixture
def pipeline(tmp_path, monkeypatch):
    monkeypatch.setattr(manifest, "MANIFEST", tmp_path / "manifest.json")
    db = tmp_path / "t.duckdb"
    monkeypatch.setattr(ingest, "connect", lambda path=None: duckdb.connect(str(db)))
    fps = {s: f"fp-{s}" for s in steps.ORDER}
    monkeypatch.setattr(steps, "fingerprints", lambda: dict(fps))
    ran = []

    def fake_run(step, args, fingerprint=None):
        ran.append(step)
        with duckdb.connect(str(db)) as con:
            for t in steps.OUTPUTS[step]:
                con.execute(f"CREATE TABLE IF NOT EXISTS {t} (x INT)")

    monkeypatch.setattr(cli, "_run", fake_run)
    loaded = {"fp": None}
    monkeypatch.setattr(load, "database_url", lambda: "postgresql://unused")
    monkeypatch.setattr(load, "loaded_fingerprint", lambda url: loaded["fp"])

    def invoke(*argv):
        ran.clear()
        monkeypatch.setattr(sys, "argv", ["filed", *argv])
        cli.main()
        return list(ran)

    return invoke, fps, loaded


def test_first_run_runs_everything_and_records(pipeline):
    invoke, fps, _ = pipeline
    assert invoke("all") == steps.ORDER
    assert {k: v["fingerprint"] for k, v in steps.recorded().items()} == fps


def test_second_run_skips_current_steps(pipeline):
    invoke, _, loaded = pipeline
    invoke("all", "--no-load")
    loaded["fp"] = "fp-load"  # the database serves this build
    assert invoke("all") == []


def test_changed_input_reruns_from_that_step(pipeline):
    invoke, fps, loaded = pipeline
    invoke("all")
    loaded["fp"] = "fp-load"
    for s in ["uscis", "aggregate", "load"]:
        fps[s] += "-new"
    assert invoke("all") == ["uscis", "aggregate", "load"]


def test_missing_outputs_rerun_even_with_the_same_fingerprint(pipeline):
    invoke, _, loaded = pipeline
    invoke("all")
    loaded["fp"] = "fp-load"
    with ingest.connect() as con:
        con.execute("DROP TABLE agg_lca_cube")
    assert invoke("all") == ["aggregate"]


def test_force_and_no_load(pipeline):
    invoke, *_ = pipeline
    invoke("all")
    assert invoke("all", "--force", "--no-load") == steps.ORDER[:-1]


def test_a_named_step_always_runs(pipeline):
    invoke, *_ = pipeline
    invoke("all", "--no-load")
    assert invoke("resolve") == ["resolve"]
