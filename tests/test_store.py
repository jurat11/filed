"""The content-addressed raw store, with a local directory as the backend."""

import hashlib
import io
import urllib.error

import pytest

from etl import manifest, store
from etl.store import LocalStore, SourceStore, StoreError


def _sourced(tmp_path):
    """The three raw files as the manifest describes them, with a source_url each."""
    raw, files = _raw(tmp_path)
    for name in files:
        files[name]["source_url"] = f"https://example.gov/{name}"
    bodies = {f"https://example.gov/{n}": (raw / n).read_bytes() for n in files}
    return raw, files, bodies


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


def test_source_store_downloads_from_the_manifest_url(tmp_path, monkeypatch):
    raw, files, bodies = _sourced(tmp_path)
    calls = []

    def fake_urlopen(url, timeout=None):
        calls.append((url, timeout))
        return io.BytesIO(bodies[url])

    monkeypatch.setattr(store.urllib.request, "urlopen", fake_urlopen)
    fresh = tmp_path / "fresh"
    s = SourceStore(files)
    assert store.fetch(s, fresh, files) == {"present": 0, "downloaded": 3, "missing_from_store": []}
    assert (fresh / "uscis" / "c.csv").read_bytes() == b"gamma"
    # No User-Agent header is set: the agencies' CDN refuses a request that claims to be a
    # browser (etl/store.py SourceStore).
    assert [url for url, _ in calls] == sorted(bodies)


def test_source_store_refuses_bytes_that_do_not_match_the_manifest(tmp_path, monkeypatch):
    raw, files, bodies = _sourced(tmp_path)
    monkeypatch.setattr(
        store.urllib.request, "urlopen", lambda url, timeout=None: io.BytesIO(b"republished")
    )
    with pytest.raises(StoreError, match="store returned"):
        store.fetch(SourceStore(files), tmp_path / "fresh", files)
    assert not (tmp_path / "fresh" / "dol" / "a.xlsx").exists()


def test_source_store_retries_a_server_error_then_gives_up(tmp_path, monkeypatch):
    raw, files, bodies = _sourced(tmp_path)
    tries = []

    def flaky(url, timeout=None):
        tries.append(url)
        raise urllib.error.HTTPError(url, 503, "busy", {}, None)

    monkeypatch.setattr(store.urllib.request, "urlopen", flaky)
    s = SourceStore(files, attempts=3, wait=0)
    with pytest.raises(StoreError, match="cannot download"):
        s.get(files["dol/a.xlsx"]["sha256"], tmp_path / "x")
    assert len(tries) == 3


def test_source_store_does_not_retry_a_404(tmp_path, monkeypatch):
    raw, files, bodies = _sourced(tmp_path)
    tries = []

    def gone(url, timeout=None):
        tries.append(url)
        raise urllib.error.HTTPError(url, 404, "gone", {}, None)

    monkeypatch.setattr(store.urllib.request, "urlopen", gone)
    with pytest.raises(StoreError, match="cannot download"):
        SourceStore(files, attempts=3, wait=0).get(files["dol/b.xlsx"]["sha256"], tmp_path / "x")
    assert len(tries) == 1


def test_source_store_is_read_only(tmp_path):
    raw, files, _ = _sourced(tmp_path)
    with pytest.raises(StoreError, match="read only"):
        SourceStore(files).put(raw / "dol" / "a.xlsx", files["dol/a.xlsx"]["sha256"])


def test_open_store_source_scheme_uses_the_manifest(tmp_path):
    raw, files, _ = _sourced(tmp_path)
    s = store.open_store("source:", files)
    assert isinstance(s, SourceStore)
    assert s.has(files["dol/a.xlsx"]["sha256"])
    assert not s.has("0" * 64)


def test_declared_lists_every_file_the_code_names():
    d = store.declared()
    assert "dol/LCA_Disclosure_Data_FY2023_Q1.xlsx" in d
    assert d["dol/LCA_Disclosure_Data_FY2023_Q1.xlsx"].startswith("https://www.dol.gov/")
    assert "uscis/h1b_datahubexport-2023.csv" in d
    # The USCIS years that exist only in the hub's viewer have no file to request.
    assert not any(k.startswith("uscis/uscis_hub_FY") for k in d)
    # Everything the committed manifest lists is declared, so `fetch` covers it all.
    assert set(manifest.load()["files"]) <= set(d)


def test_fetch_new_downloads_only_files_the_manifest_lacks(tmp_path, monkeypatch):
    raw, files, _ = _sourced(tmp_path)
    declared = {"dol/a.xlsx": "https://example.gov/dol/a.xlsx", "dol/new.xlsx": "https://x.gov/new"}
    monkeypatch.setattr(store, "declared", lambda: declared)
    got = []

    def fake_urlopen(url, timeout=None):
        got.append(url)
        return io.BytesIO(b"a new quarterly release")

    monkeypatch.setattr(store.urllib.request, "urlopen", fake_urlopen)
    fresh = tmp_path / "fresh"
    out = store.fetch_new(fresh, files)
    assert out == {"new": ["dol/new.xlsx"], "already_local": 0}
    assert got == ["https://x.gov/new"]
    assert (fresh / "dol" / "new.xlsx").read_bytes() == b"a new quarterly release"
    # Already downloaded: left alone, and never fetched twice.
    assert store.fetch_new(fresh, files) == {"new": [], "already_local": 1}
    assert len(got) == 1
