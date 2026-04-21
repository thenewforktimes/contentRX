#!/usr/bin/env python3
"""Pipeline orchestrator: extract → annotate → triage assist in one command.

Chains the three existing tools into a single invocation. Each stage
passes its output in memory to the next — no intermediate files, no
subprocess shells. The result is a pre-classified JSON file ready for
human review in the triage CLI or a Claude chat.

Usage:
    # Full pipeline from URL
    python3 tools/pipeline_run.py https://stripe.com/pricing \\
        --domain fintech --org Stripe --output triage/stripe_pricing.json

    # From pre-extracted JSON (skip extraction)
    python3 tools/pipeline_run.py --input extracted.json --output triage/annotated.json

    # Dry run: zero API cost, test the full pipeline shape
    python3 tools/pipeline_run.py https://example.com --dry-run

    # With explicit calibration file for few-shot examples
    python3 tools/pipeline_run.py https://example.com \\
        --calibration evals/industry/healthcare_eval_cases.json

    # Skip triage assist (annotation only)
    python3 tools/pipeline_run.py --input raw.json --skip-triage
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
EVALS_INDUSTRY_DIR = PROJECT_ROOT / "evals" / "industry"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "triage"

# Default calibration: scan evals/industry/ for annotated files
DEFAULT_CALIBRATION_GLOBS = [
    EVALS_INDUSTRY_DIR / "*.json",
]

# Pipeline schema version — tracks the orchestrator format, not individual tools
PIPELINE_SCHEMA_VERSION = "1.0.0"


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

class _Colors:
    """ANSI color codes, auto-disabled when stdout is not a TTY."""

    def __init__(self) -> None:
        enabled = hasattr(sys.stderr, "isatty") and sys.stderr.isatty()
        self.GREEN = "\033[32m" if enabled else ""
        self.YELLOW = "\033[33m" if enabled else ""
        self.RED = "\033[31m" if enabled else ""
        self.DIM = "\033[2m" if enabled else ""
        self.BOLD = "\033[1m" if enabled else ""
        self.RESET = "\033[0m" if enabled else ""


C = _Colors()


def _log(msg: str) -> None:
    """Log to stderr so stdout stays clean for piped JSON."""
    print(msg, file=sys.stderr)


def _log_stage(stage_num: int, name: str) -> None:
    """Log a stage header."""
    _log(f"\n{C.BOLD}Stage {stage_num}: {name}{C.RESET}")


def _log_ok(msg: str) -> None:
    _log(f"  {C.GREEN}✓{C.RESET} {msg}")


def _log_warn(msg: str) -> None:
    _log(f"  {C.YELLOW}⚠{C.RESET} {msg}")


def _log_err(msg: str) -> None:
    _log(f"  {C.RED}✗{C.RESET} {msg}")


# ---------------------------------------------------------------------------
# Calibration file discovery
# ---------------------------------------------------------------------------

def discover_calibration_files(explicit_paths: list[Path] | None) -> list[Path]:
    """Resolve calibration files for the annotation stage.

    Priority:
        1. Explicit --calibration paths (user-specified)
        2. Auto-discovered files in evals/industry/ (convenience default)

    Returns only paths that exist and contain at least one annotated case.
    """
    if explicit_paths:
        valid = []
        for p in explicit_paths:
            if p.exists():
                valid.append(p)
            else:
                _log_warn(f"Calibration file not found: {p}")
        return valid

    # Auto-discover from evals/industry/
    discovered = []
    if EVALS_INDUSTRY_DIR.exists():
        for path in sorted(EVALS_INDUSTRY_DIR.glob("*.json")):
            try:
                with open(path) as f:
                    data = json.load(f)
                has_annotations = any(
                    c.get("human_verdict") is not None
                    for c in data.get("cases", [])
                )
                if has_annotations:
                    discovered.append(path)
            except (json.JSONDecodeError, KeyError):
                continue

    return discovered


# ---------------------------------------------------------------------------
# Stage 1: Extraction
# ---------------------------------------------------------------------------

def run_extraction(
    url: str,
    domain: str,
    org: str,
    min_length: int = 2,
    max_length: int = 500,
) -> dict:
    """Extract user-facing content from a URL.

    Returns the eval case JSON structure (with 'cases' array).
    Raises RuntimeError on fetch or parse failure.
    """
    # Import from sibling module
    from extract_content import extract_from_html, fetch_html, to_eval_cases

    html = fetch_html(url)
    contents = extract_from_html(html, min_length=min_length, max_length=max_length)

    if not contents:
        raise RuntimeError(f"No user-facing content found at {url}")

    return to_eval_cases(contents, source_url=url, domain=domain, source_org=org)


# ---------------------------------------------------------------------------
# Stage 2: Annotation
# ---------------------------------------------------------------------------

def run_annotation_stage(
    data: dict,
    calibration_files: list[Path],
    model: str,
    dry_run: bool,
) -> tuple[dict, dict]:
    """Run machine verdict + calibrated annotation on all cases.

    Returns (annotated_data, annotation_stats).
    """
    from auto_annotate import annotate_cases, build_output

    cases = data["cases"]
    source_url = data.get("source_url", "")
    domain = data.get("domain", "unknown")
    source_org = data.get("source_org", "")

    annotated_cases, stats = annotate_cases(
        cases,
        calibration_files=calibration_files,
        model=model,
        dry_run=dry_run,
    )

    annotated_data = build_output(
        annotated_cases,
        stats,
        source_url=source_url,
        domain=domain,
        source_org=source_org,
        input_file=data.get("_input_file", ""),
    )

    return annotated_data, stats


# ---------------------------------------------------------------------------
# Stage 3: Triage assist
# ---------------------------------------------------------------------------

def run_triage_stage(
    data: dict,
    calibration_cases: list[dict] | None,
    dry_run: bool,
) -> dict:
    """Run deterministic + LLM triage classification on all cases.

    Returns the data dict with suggested_* fields added to each case.
    """
    from triage_assist import run_triage_assist

    return run_triage_assist(
        data,
        calibration_cases=calibration_cases,
        dry_run=dry_run,
    )


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_output(data: dict, output_path: Path) -> None:
    """Atomically write the output JSON file.

    Writes to a temp file in the same directory, then renames. This
    prevents partial writes from corrupting the output if the process
    is interrupted.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write to temp file in the same directory (same filesystem for rename)
    fd, tmp_path = tempfile.mkstemp(
        suffix=".json",
        prefix=".pipeline_",
        dir=str(output_path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, str(output_path))
    except BaseException:
        # Clean up temp file on any failure
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def add_pipeline_metadata(data: dict, stages_run: list[str], elapsed: float) -> dict:
    """Stamp the output with pipeline execution metadata."""
    data["pipeline"] = {
        "version": PIPELINE_SCHEMA_VERSION,
        "stages_run": stages_run,
        "elapsed_seconds": round(elapsed, 1),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    return data


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run the full ContentRX automation pipeline: "
            "extract → annotate → triage assist. Outputs a pre-classified "
            "JSON file ready for human review."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 tools/pipeline_run.py https://stripe.com/pricing \\\n"
            "      --domain fintech --org Stripe --output triage/stripe.json\n"
            "\n"
            "  python3 tools/pipeline_run.py --input extracted.json --output triage/annotated.json\n"
            "\n"
            "  python3 tools/pipeline_run.py https://example.com --dry-run\n"
        ),
    )

    # --- Input source ---
    input_group = parser.add_argument_group("input")
    input_group.add_argument(
        "url",
        nargs="?",
        default=None,
        help="URL to extract content from.",
    )
    input_group.add_argument(
        "--input", "-i",
        dest="input_file",
        help="Pre-extracted or pre-annotated JSON file (skip extraction).",
    )

    # --- Output ---
    parser.add_argument(
        "--output", "-o",
        help=(
            "Output file path. Defaults to triage/<org>_<date>.json "
            "or stdout if neither --output nor --org is provided."
        ),
    )

    # --- Metadata ---
    meta_group = parser.add_argument_group("metadata")
    meta_group.add_argument(
        "--domain", "-d",
        default="unknown",
        help="Domain label (e.g., healthcare, fintech, ecommerce).",
    )
    meta_group.add_argument(
        "--org",
        default="",
        help="Source organization name (e.g., 'Stripe', 'Kaiser Permanente').",
    )

    # --- Calibration ---
    cal_group = parser.add_argument_group("calibration")
    cal_group.add_argument(
        "--calibration", "-c",
        action="append",
        dest="calibration_files",
        help=(
            "Path to annotated eval case file for few-shot calibration. "
            "Can be specified multiple times. If omitted, auto-discovers "
            "files in evals/industry/."
        ),
    )
    cal_group.add_argument(
        "--triage-calibration",
        dest="triage_calibration",
        help=(
            "Path to a previously reviewed triage file for triage assist "
            "few-shot examples (separate from annotation calibration)."
        ),
    )

    # --- Options ---
    opts_group = parser.add_argument_group("options")
    opts_group.add_argument(
        "--model",
        default="claude-sonnet-4-20250514",
        help="Claude model for all LLM calls.",
    )
    opts_group.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the full pipeline shape with zero API calls.",
    )
    opts_group.add_argument(
        "--skip-triage",
        action="store_true",
        help="Stop after annotation, skip triage assist stage.",
    )
    opts_group.add_argument(
        "--skip-annotation",
        action="store_true",
        help="Skip annotation, run only extraction + triage assist.",
    )

    return parser


def resolve_output_path(args: argparse.Namespace) -> Path | None:
    """Determine the output file path from CLI args.

    Returns None if output should go to stdout.
    """
    if args.output:
        return Path(args.output)

    # Auto-generate from org name + date
    if args.org:
        safe_org = args.org.lower().replace(" ", "_").replace("/", "_")
        date_str = datetime.now().strftime("%Y-%m-%d")
        return DEFAULT_OUTPUT_DIR / f"{safe_org}_{date_str}.json"

    return None


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Validate input
    if not args.url and not args.input_file:
        parser.error("Provide either a URL or --input file.")

    if args.skip_annotation and args.skip_triage:
        parser.error("Cannot skip both annotation and triage — nothing to do.")

    # Resolve paths
    output_path = resolve_output_path(args)
    calibration_files = discover_calibration_files(
        [Path(p) for p in args.calibration_files] if args.calibration_files else None,
    )

    triage_calibration_cases: list[dict] | None = None
    if args.triage_calibration:
        triage_cal_path = Path(args.triage_calibration)
        if triage_cal_path.exists():
            with open(triage_cal_path) as f:
                triage_cal_data = json.load(f)
            triage_calibration_cases = [
                c for c in triage_cal_data.get("cases", [])
                if c.get("human_verdict")
            ]
            _log(f"Triage calibration: {len(triage_calibration_cases)} reviewed cases")
        else:
            _log_warn(f"Triage calibration file not found: {triage_cal_path}")

    # --- Header ---
    _log(f"{C.BOLD}ContentRX pipeline{C.RESET}")
    source_label = args.url or args.input_file
    _log(f"  Source: {source_label}")
    if args.org:
        _log(f"  Org: {args.org}")
    if args.domain != "unknown":
        _log(f"  Domain: {args.domain}")
    _log(f"  Calibration files: {len(calibration_files)}")
    if args.dry_run:
        _log(f"  {C.YELLOW}DRY RUN — no API calls{C.RESET}")

    stages_run: list[str] = []
    pipeline_start = time.time()

    # ------------------------------------------------------------------
    # Stage 1: Extraction
    # ------------------------------------------------------------------

    if args.input_file:
        _log_stage(1, "Load input file")
        input_path = Path(args.input_file)
        if not input_path.exists():
            _log_err(f"File not found: {args.input_file}")
            sys.exit(1)
        with open(input_path) as f:
            data = json.load(f)
        if "cases" not in data:
            _log_err("Invalid input: expected JSON with a 'cases' array.")
            sys.exit(1)
        data["_input_file"] = str(input_path)
        _log_ok(f"Loaded {len(data['cases'])} cases from {input_path.name}")
        stages_run.append("load")
    else:
        _log_stage(1, "Extract content")
        try:
            data = run_extraction(
                url=args.url,
                domain=args.domain,
                org=args.org,
            )
            _log_ok(f"Extracted {len(data['cases'])} cases")
            stages_run.append("extract")
        except Exception as exc:
            _log_err(f"Extraction failed: {exc}")
            sys.exit(1)

    # ------------------------------------------------------------------
    # Stage 2: Annotation
    # ------------------------------------------------------------------

    if not args.skip_annotation:
        _log_stage(2, "Annotate cases")
        try:
            data, annotation_stats = run_annotation_stage(
                data,
                calibration_files=calibration_files,
                model=args.model,
                dry_run=args.dry_run,
            )
            annotated = annotation_stats.get("annotated", 0)
            errors = annotation_stats.get("errors", 0)
            cost = annotation_stats.get("estimated_cost", "$0.00")
            _log_ok(f"Annotated {annotated} cases ({errors} errors, cost: {cost})")
            stages_run.append("annotate")
        except Exception as exc:
            _log_err(f"Annotation failed: {exc}")
            _log_warn("Writing partial output (extraction only).")
            # Fall through — write what we have
    else:
        _log_stage(2, "Annotation (skipped)")

    # ------------------------------------------------------------------
    # Stage 3: Triage assist
    # ------------------------------------------------------------------

    if not args.skip_triage:
        _log_stage(3, "Triage assist")
        try:
            data = run_triage_stage(
                data,
                calibration_cases=triage_calibration_cases,
                dry_run=args.dry_run,
            )
            stages_run.append("triage_assist")
        except Exception as exc:
            _log_err(f"Triage assist failed: {exc}")
            _log_warn("Writing partial output (without triage suggestions).")
    else:
        _log_stage(3, "Triage assist (skipped)")

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------

    elapsed = time.time() - pipeline_start
    data = add_pipeline_metadata(data, stages_run, elapsed)

    if output_path:
        write_output(data, output_path)
        _log(f"\n{C.BOLD}Done in {elapsed:.1f}s{C.RESET}")
        _log(f"  Output: {output_path}")
        _log(f"  Cases: {len(data.get('cases', []))}")
        _log(f"\nNext steps:")
        _log(f"  Review:  python3 tools/triage.py {output_path}")
        _log(f"  Promote: python3 tools/promote_cases.py {output_path}")
    else:
        # stdout mode — print JSON, log summary to stderr
        print(json.dumps(data, indent=2, ensure_ascii=False))
        _log(f"\n{C.BOLD}Done in {elapsed:.1f}s{C.RESET} ({len(data.get('cases', []))} cases)")


if __name__ == "__main__":
    main()
