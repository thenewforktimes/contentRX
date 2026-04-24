"""Build the annual taxonomy-audit panel.

Human-eval build plan Session 36. Where the quarterly drift check
(Session 7) samples 80 cases from the eligible pool to answer "is
the graduation threshold correct for today?", the annual audit
samples a LARGER (100) and OLDER (>1 year) set to answer a different
question: "has the system overfit to the year's labeled data?"

Reuses `tools/drift_check.py`'s corpus loader, eligibility filter,
and stratified-sample construction. Adds:

    - `is_older_than_days(case, days)` — the age filter. Default
      365 days; override via --min-age-days.
    - A panel manifest schema keyed by calendar year (not quarter)
      with the audit's distinct output directory.

Output: `evals/annual_audit/panels/<year>.json`

Usage:
    python3 tools/annual_audit_sample.py build-panel --corpus-dir <path>
    python3 tools/annual_audit_sample.py build-panel --size 100 --min-age-days 365
    python3 tools/annual_audit_sample.py export-blind --year 2026

The `export-blind` sub-command strips verdicts from the panel so the
re-labeling pass is truly blind — same discipline as drift_check's
`export-blind`.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.drift_check import (  # noqa: E402
    build_blind_panel,
    build_panel,
    is_eligible,
    load_cases,
    load_corpus_index,
)

DEFAULT_PANEL_SIZE = 100
DEFAULT_MIN_AGE_DAYS = 365

DEFAULT_OUTPUT_DIR = REPO_ROOT / "evals" / "annual_audit"


def is_older_than_days(
    case: dict[str, Any],
    *,
    min_age_days: int,
    today: _dt.date,
) -> bool:
    """True when the case has a parseable `created_at` / `evaluated_at`
    timestamp AND is older than `min_age_days`. Cases without a
    timestamp are treated as NOT older-than — the annual audit
    requires positive evidence of age. Lenient on timestamp format:
    accepts ISO dates and ISO datetimes, with or without timezone.
    """
    raw = case.get("evaluated_at") or case.get("created_at")
    if not raw:
        return False
    try:
        if "T" in raw:
            dt = _dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            case_date = dt.date()
        else:
            case_date = _dt.date.fromisoformat(raw)
    except ValueError:
        return False
    delta = (today - case_date).days
    return delta >= min_age_days


def filter_eligible_and_aged(
    cases: list[dict[str, Any]],
    *,
    min_age_days: int,
    today: _dt.date,
) -> list[dict[str, Any]]:
    return [
        c
        for c in cases
        if is_eligible(c) and is_older_than_days(c, min_age_days=min_age_days, today=today)
    ]


def build_audit_panel_manifest(
    selected: list[dict[str, Any]],
    stats: dict[str, Any],
    *,
    year: int,
    generated_at: str,
    corpus_dir: Path,
    size: int,
    min_age_days: int,
) -> dict[str, Any]:
    return {
        "description": (
            f"Annual taxonomy-audit panel for {year}. Sample drawn from "
            f"cases older than {min_age_days} days so current-Robo can "
            "re-label under the current schema and past/present "
            "disagreement surfaces overfit patterns the quarterly "
            "drift check cannot detect (Session 36)."
        ),
        "schema_version": "1.0.0",
        "year": year,
        "min_age_days": min_age_days,
        "generated_at": generated_at,
        "corpus_dir": str(corpus_dir),
        "panel_size_target": size,
        "stats": stats,
        "entries": [
            {
                "case_id": c.get("case_id"),
                "source_file": c.get("_source_file"),
                "moment": c.get("moment"),
                "content_type": c.get("content_type"),
                "standard_id": c.get("standard_id"),
                "past_human_verdict": c.get("human_verdict"),
                "past_human_confidence": c.get("human_confidence"),
                "evaluated_at": c.get("evaluated_at") or c.get("created_at"),
            }
            for c in selected
        ],
    }


def current_year(today: _dt.date | None = None) -> int:
    return (today or _dt.date.today()).year


def _utc_now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def cmd_build_panel(args: argparse.Namespace) -> int:
    corpus_dir = Path(args.corpus_dir).resolve()
    if not corpus_dir.exists():
        print(f"ERROR: corpus_dir {corpus_dir} does not exist.", file=sys.stderr)
        return 1

    today = _dt.date.fromisoformat(args.today) if args.today else _dt.date.today()
    year = args.year or current_year(today)

    cases = load_cases(corpus_dir)
    filtered = filter_eligible_and_aged(
        cases, min_age_days=args.min_age_days, today=today
    )
    selected, stats = build_panel(filtered, size=args.size)
    # Annotate the stats with what we filtered for so the manifest
    # makes the eligibility criteria explicit.
    stats = {
        **stats,
        "age_filter_days": args.min_age_days,
        "corpus_total": len(cases),
        "eligible_after_age_filter": len(filtered),
    }
    manifest = build_audit_panel_manifest(
        selected,
        stats,
        year=year,
        generated_at=args.now or _utc_now_iso(),
        corpus_dir=corpus_dir,
        size=args.size,
        min_age_days=args.min_age_days,
    )

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "panels" / f"{year}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(selected)} case(s) to {out_path} "
        f"(eligible pool {stats['eligible_pool']} after age filter)",
        file=sys.stderr,
    )
    return 0


def cmd_export_blind(args: argparse.Namespace) -> int:
    year = args.year or current_year()
    panel_path = Path(args.output_dir) / "panels" / f"{year}.json"
    if not panel_path.exists():
        print(f"ERROR: panel {panel_path} does not exist. Run build-panel first.", file=sys.stderr)
        return 1
    panel = json.loads(panel_path.read_text(encoding="utf-8"))
    corpus_dir = Path(panel["corpus_dir"])
    corpus_index = load_corpus_index(corpus_dir)
    blind = build_blind_panel(panel, corpus_index)
    out_path = Path(args.output_dir) / "blind" / f"{year}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(blind, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote blind panel to {out_path} ({len(blind.get('entries', []))} cases)",
        file=sys.stderr,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Root directory for annual-audit artefacts. "
        f"Default: {DEFAULT_OUTPUT_DIR.relative_to(REPO_ROOT)}.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    bp = subparsers.add_parser("build-panel", help="Sample cases for the year.")
    bp.add_argument("--corpus-dir", required=True)
    bp.add_argument("--size", type=int, default=DEFAULT_PANEL_SIZE)
    bp.add_argument("--min-age-days", type=int, default=DEFAULT_MIN_AGE_DAYS)
    bp.add_argument("--year", type=int, default=None)
    bp.add_argument("--today", default=None, help="Override today (YYYY-MM-DD) for deterministic tests.")
    bp.add_argument("--now", default=None, help="Override generated_at timestamp.")
    bp.set_defaults(func=cmd_build_panel)

    xb = subparsers.add_parser("export-blind", help="Strip verdicts for blind re-label.")
    xb.add_argument("--year", type=int, default=None)
    xb.set_defaults(func=cmd_export_blind)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())


__all__ = [
    "DEFAULT_MIN_AGE_DAYS",
    "DEFAULT_PANEL_SIZE",
    "build_audit_panel_manifest",
    "current_year",
    "filter_eligible_and_aged",
    "is_older_than_days",
]
