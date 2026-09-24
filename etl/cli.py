"""Command line entry point: `uv run filed <step>`."""

from __future__ import annotations

import argparse
import json
import logging
import time


def main() -> None:
    p = argparse.ArgumentParser(prog="filed")
    p.add_argument(
        "step",
        choices=["ingest", "wages", "resolve", "uscis", "aggregate", "load", "all"],
    )
    p.add_argument("--restage", action="store_true", help="re-read raw xlsx even if staged")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    steps = ["ingest", "wages", "resolve", "uscis", "aggregate", "load"]
    todo = steps if args.step == "all" else [args.step]
    for step in todo:
        t = time.time()
        result = _run(step, args)
        logging.info("%s done in %.0fs: %s", step, time.time() - t, json.dumps(result, default=str))


def _run(step: str, args: argparse.Namespace):
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

        return load.run()
    raise ValueError(step)


if __name__ == "__main__":
    main()
