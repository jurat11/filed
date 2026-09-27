"""The content-addressed raw store, with a local directory as the backend."""

import hashlib

import pytest

from etl import store
from etl.store import LocalStore, StoreError


def _raw(tmp_path):
    raw = tmp_path / "raw"
    (raw / "dol").mkdir(parents=True)
    files = {}
    bodies = [("dol/a.xlsx", b"alpha"), ("dol/b.xlsx", b"beta"), ("uscis/c.csv", b"gamma")]
    for name, body in bodies:
        p = raw / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
        files[name] = {"sha256": hashlib.sha256(body).hexdigest(), "downloaded": "2026-09-23"}
    return raw, files


def test_key_is_sharded_by_hash():
    sha = hashlib.sha256(b"x").hexdigest()
    assert store.key(sha) == f"sha256/{sha[:2]}/{sha}"
    with pytest.raises(StoreError):
        store.key("../../etc/passwd")


def test_push_then_fetch_restores_raw(tmp_path):
    raw, files = _raw(tmp_path)
    s = LocalStore(tmp_path / "store")
    assert store.push(s, raw, files) == {"uploaded": 3, "already_stored": 0, "not_local": []}
    assert store.push(s, raw, files)["already_stored"] == 3  # idempotent
    fresh = tmp_path / "fresh"
    assert store.fetch(s, fresh, files) == {"present": 0, "downloaded": 3, "missing_from_store": []}
    assert (fresh / "uscis" / "c.csv").read_bytes() == b"gamma"
    assert store.fetch(s, fresh, files)["present"] == 3


def test_same_bytes_are_stored_once(tmp_path):
    raw, files = _raw(tmp_path)
    (raw / "dol" / "copy.xlsx").write_bytes(b"alpha")
    files["dol/copy.xlsx"] = dict(files["dol/a.xlsx"])
    s = LocalStore(tmp_path / "store")
    store.push(s, raw, files)
    assert len([p for p in (tmp_path / "store").rglob("*") if p.is_file()]) == 3


def test_fetch_replaces_a_corrupted_local_file(tmp_path):
    raw, files = _raw(tmp_path)
    s = LocalStore(tmp_path / "store")
    store.push(s, raw, files)
    (raw / "dol" / "a.xlsx").write_bytes(b"tampered")
    assert store.fetch(s, raw, files)["downloaded"] == 1
    assert (raw / "dol" / "a.xlsx").read_bytes() == b"alpha"


def test_fetch_rejects_a_store_object_with_the_wrong_hash(tmp_path):
    raw, files = _raw(tmp_path)
    s = LocalStore(tmp_path / "store")
    store.push(s, raw, files)
    obj = tmp_path / "store" / store.key(files["dol/a.xlsx"]["sha256"])
    obj.write_bytes(b"bit rot")
    fresh = tmp_path / "fresh"
    with pytest.raises(StoreError, match="store returned"):
        store.fetch(s, fresh, files)
    assert not (fresh / "dol" / "a.xlsx").exists()


def test_fetch_fails_when_the_store_lacks_a_file(tmp_path):
    raw, files = _raw(tmp_path)
    with pytest.raises(StoreError, match="not in the store"):
        store.fetch(LocalStore(tmp_path / "empty"), tmp_path / "fresh", files)


def test_push_refuses_a_file_that_no_longer_matches_the_manifest(tmp_path):
    raw, files = _raw(tmp_path)
    (raw / "dol" / "b.xlsx").write_bytes(b"changed")
    with pytest.raises(StoreError, match="differs from the manifest"):
        store.push(LocalStore(tmp_path / "store"), raw, files)


def test_open_store_urls(tmp_path, monkeypatch):
    assert isinstance(store.open_store(f"file://{tmp_path}"), LocalStore)
    with pytest.raises(StoreError, match="unsupported"):
        store.open_store("ftp://x/y")
    monkeypatch.delenv("FILED_STORE_URL", raising=False)
    with pytest.raises(StoreError, match="not set"):
        store.open_store()
