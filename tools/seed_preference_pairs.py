"""Seed / refresh the `preference_pairs` table from
`evals/preference_pairs.json`.

Human-eval build plan Session 31. The JSON file is the source of
truth; the DB is the cache. Re-run this after editing the JSON to
sync new pairs, retire removed ones, or update author-side fields.

Idempotent behavior (keyed by `seed_key`):
  - Unknown seed_key in JSON → INSERT.
  - Known seed_key with matching fields → leave alone.
  - Known seed_key with changed fields → UPDATE in place.
  - In DB but missing from JSON → mark `retired_at = now()` unless
    already retired. Rows are never physically deleted so the historic
    `preferences` table stays interpretable.

Usage:
    python3 tools/seed_preference_pairs.py \\
        --db-url "$DATABASE_URL" \\
        --input evals/preference_pairs.json

    # Dry-run — print what would change without hitting the DB
    python3 tools/seed_preference_pairs.py --input evals/preference_pairs.json --dry-run

The DB URL falls back to the `DATABASE_URL` env var; see
`.env.local.example`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "evals" / "preference_pairs.json"


ALLOWED_PREFERRED = {"left", "right"}


def load_pairs(path: Path) -> list[dict[str, Any]]:
    with open(path) as f:
        data = json.load(f)
    pairs = data.get("pairs", [])
    for i, p in enumerate(pairs):
        for required in (
            "seed_key",
            "moment",
            "content_type",
            "standard_id",
            "left_text",
            "right_text",
        ):
            if required not in p or not p[required]:
                raise ValueError(
                    f"pair index {i}: missing required field '{required}'"
                )
        if p.get("expected_preferred") not in (None, "left", "right"):
            raise ValueError(
                f"pair index {i} ({p['seed_key']}): "
                f"expected_preferred must be left/right/None"
            )
    return pairs


def diff_rows(
    json_pairs: list[dict[str, Any]],
    db_rows: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    by_seed = {r["seed_key"]: r for r in db_rows}
    inserts, updates, retires = [], [], []
    json_seeds = {p["seed_key"] for p in json_pairs}

    for p in json_pairs:
        existing = by_seed.get(p["seed_key"])
        if not existing:
            inserts.append(p)
            continue
        changed = (
            existing.get("moment") != p["moment"]
            or existing.get("content_type") != p["content_type"]
            or existing.get("standard_id") != p["standard_id"]
            or existing.get("left_text") != p["left_text"]
            or existing.get("right_text") != p["right_text"]
            or (existing.get("expected_preferred") or None)
            != (p.get("expected_preferred") or None)
            or (existing.get("prompt") or None) != (p.get("prompt") or None)
        )
        if existing.get("retired_at") is not None:
            # Seed JSON brought it back — clear retirement.
            updates.append(p)
        elif changed:
            updates.append(p)

    for r in db_rows:
        if r["seed_key"] not in json_seeds and r.get("retired_at") is None:
            retires.append(r)

    return {"inserts": inserts, "updates": updates, "retires": retires}


def _print_plan(plan: dict[str, list[dict[str, Any]]]) -> None:
    total = sum(len(v) for v in plan.values())
    print(f"Plan: {len(plan['inserts'])} inserts, "
          f"{len(plan['updates'])} updates, "
          f"{len(plan['retires'])} retirements "
          f"({total} changes total)")
    for p in plan["inserts"]:
        print(f"  + {p['seed_key']}  {p['moment']}/{p['content_type']}")
    for p in plan["updates"]:
        print(f"  ~ {p['seed_key']}")
    for r in plan["retires"]:
        print(f"  - {r['seed_key']} (retire)")


def apply_plan(conn, plan: dict[str, list[dict[str, Any]]]) -> None:
    cur = conn.cursor()
    try:
        for p in plan["inserts"]:
            cur.execute(
                """
                INSERT INTO preference_pairs (
                    id, seed_key, moment, content_type, standard_id,
                    left_text, right_text, expected_preferred, prompt
                ) VALUES (
                    gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    p["seed_key"],
                    p["moment"],
                    p["content_type"],
                    p["standard_id"],
                    p["left_text"],
                    p["right_text"],
                    p.get("expected_preferred"),
                    p.get("prompt"),
                ),
            )
        for p in plan["updates"]:
            cur.execute(
                """
                UPDATE preference_pairs SET
                    moment = %s,
                    content_type = %s,
                    standard_id = %s,
                    left_text = %s,
                    right_text = %s,
                    expected_preferred = %s,
                    prompt = %s,
                    retired_at = NULL
                WHERE seed_key = %s
                """,
                (
                    p["moment"],
                    p["content_type"],
                    p["standard_id"],
                    p["left_text"],
                    p["right_text"],
                    p.get("expected_preferred"),
                    p.get("prompt"),
                    p["seed_key"],
                ),
            )
        for r in plan["retires"]:
            cur.execute(
                """
                UPDATE preference_pairs SET
                    retired_at = NOW()
                WHERE seed_key = %s AND retired_at IS NULL
                """,
                (r["seed_key"],),
            )
        conn.commit()
    finally:
        cur.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", "-i",
        default=str(DEFAULT_INPUT),
        help=f"Path to seed JSON (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--db-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres connection string (default: $DATABASE_URL)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print plan and exit without touching the DB.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"error: input file not found: {input_path}", file=sys.stderr)
        return 2

    json_pairs = load_pairs(input_path)
    print(f"Loaded {len(json_pairs)} pair(s) from {input_path}")

    if args.dry_run:
        # Pretend the DB is empty — we can't read DB state without a
        # connection, so dry-run just lists everything as inserts.
        plan = {"inserts": json_pairs, "updates": [], "retires": []}
        _print_plan(plan)
        print("\n(dry-run — no DB connection opened)")
        return 0

    if not args.db_url:
        print(
            "error: --db-url or $DATABASE_URL required to apply the seed.",
            file=sys.stderr,
        )
        return 2

    try:
        import psycopg  # noqa: F401
    except ImportError:
        print(
            "error: psycopg is required to apply the seed. "
            "Install with `pip install psycopg[binary]`.",
            file=sys.stderr,
        )
        return 2

    import psycopg

    with psycopg.connect(args.db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT seed_key, moment, content_type, standard_id,
                       left_text, right_text, expected_preferred, prompt,
                       retired_at
                FROM preference_pairs
                """
            )
            cols = [c.name for c in cur.description]
            db_rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        plan = diff_rows(json_pairs, db_rows)
        _print_plan(plan)
        apply_plan(conn, plan)
        print("Applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
