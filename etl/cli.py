"""Command line entry point: `uv run filed <step>`.

filed all            run every step whose inputs changed (docs/decisions.md D26)
filed all --force    run every step
filed status         show which steps are current and which would run
filed <step>         run one step, whatever its fingerprint says
filed fetch          restore data/raw/: download every file the manifest lists from
                     FILED_STORE_URL (`source:` = the agencies themselves), check its
                     hash, then fetch any newly declared release (etl/store.py)
filed push-raw       upload data/raw/ files missing from the store
filed seed           build the fixture pipeline into DATABASE_URL (tests only)
"""

from __future__ import annotations

import argparse
import json
import logging
import time

log = logging.getLogger("filed")

STEPS = ["ingest", "wages", "resolve", "uscis", "aggregate", "load"]


def main() -> None:
    p = argparse.ArgumentParser(prog="filed")
    p.add_argument("step", choices=[*STEPS, "all", "status", "seed", "fetch", "push-raw"])
    p.add_argument("--restage", action="store_true", help="re-read raw xlsx even if staged")
    p.add_argument("--force", action="store_true", help="run steps whose inputs are unchanged")
    p.add_argument("--no-load", action="store_true", help="with `all`: stop before `load`")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    if args.step == "status":
        for step, state in status().items():
            print(f"{step:10} {state}")
        return
    if args.step in ("seed", "fetch", "push-raw"):
        _log(args.step, lambda: _run(args.step, args))
        return

    from etl import ingest, steps

    todo = list(STEPS) if args.step == "all" else [args.step]
    if args.no_load and "load" in todo:
        todo.remove("load")
    fps = steps.fingerprints()
    con = ingest.connect()
    for step in todo:
        if args.step == "all" and not args.force and _current(con, step, fps[step]):
            log.info("%s: inputs unchanged, skipped", step)
            continue
        con.close()  # each step opens the database itself
        _log(step, lambda s=step: _run(s, args, fps[s]))
        steps.mark_done(step, fps[step])
        con = ingest.connect()


def _current(con, step: str, fp: str) -> bool:
    from etl import load, steps

    if step == "load":
        return load.loaded_fingerprint(load.database_url()) == fp
    return steps.is_current(con, step, fp)


def status() -> dict[str, str]:
    from etl import ingest, steps

    fps, rec, out = steps.fingerprints(), steps.recorded(), {}
    con = ingest.connect()
    for step in STEPS:
        if step == "load":
            out[step] = "run `filed all` to compare with the database"
        elif steps.is_current(con, step, fps[step]):
            out[step] = f"current (completed {rec[step]['completed_at']})"
        elif rec.get(step, {}).get("fingerprint") == fps[step]:
            out[step] = "inputs unchanged, but outputs missing from DuckDB: will run"
        else:
            out[step] = "inputs changed: will run"
    return out


def _log(step: str, fn) -> None:
    t = time.time()
    result = fn()
    log.info("%s done in %.0fs: %s", step, time.time() - t, json.dumps(result, default=str))


def _run(step: str, args: argparse.Namespace, fingerprint: str | None = None):
    if step == "ingest":
        from etl import ingest

        return ingest.run(restage=args.restage)
    if step == "wages":
        from etl import ingest, manifest, wages

        con = ingest.connect()
        stats = wages.add_annual_wages(con)
        (manifest.ROOT / "eval").mkdir(exist_ok=True)
        wages.write_report(con, manifest.ROOT / "eval" / "wages.md")
        return stats
    if step == "resolve":
        from etl import employers

        return employers.run()
    if step == "uscis":
        from etl import uscis_join

        return uscis_join.run()
    if step == "aggregate":
        from etl import aggregate

        return aggregate.run()
    if step == "load":
        from etl import load

        return load.run(fingerprint)
    if step == "seed":
        from etl import seed

        return seed.run()
    if step == "fetch":
        from etl import store

        return store.fetch() | store.fetch_new()
    if step == "push-raw":
        from etl import store

        return store.push()
    raise ValueError(step)


if __name__ == "__main__":
    main()
