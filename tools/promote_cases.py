#!/usr/bin/env python3
"""Promote reviewed triage cases to the permanent eval corpus.

Closes the feedback loop: URL → extract → annotate → triage → promote → eval.

Takes a triage file with human reviews, filters for high-signal cases,
transforms them to eval schema, deduplicates against the existing corpus,
appends to the target eval file, and optionally runs the regression suite.

Promotion criteria:
    - Human verdict is set (reviewed, not skipped)
    - Confidence is high or medium (low-confidence cases are ambiguous)
    - Revised cases (human corrected the machine) are ALWAYS promoted
      regardless of confidence — corrections are the highest-signal data

Usage:
    # Promote from a reviewed triage file to the default industry eval set
    python3 tools/promote_cases.py triage/opendoor_2026-03-29.json

    # Promote to a specific eval file
    python3 tools/promote_cases.py triage/stripe.json \\
        --target evals/industry/fintech_eval_cases.json

    # Dry run: show what would be promoted without writing anything
    python3 tools/promote_cases.py triage/cases.json --dry-run

    # Promote and run regression suite
    python3 tools/promote_cases.py triage/cases.json --run-evals

    # Include low-confidence cases (use with caution)
    python3 tools/promote_cases.py triage/cases.json --include-low
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_TARGET = PROJECT_ROOT / "evals" / "industry"

# Schema version for promoted eval files
EVAL_SCHEMA_VERSION = "1.1.0"


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

class _Colors:
    def __init__(self) -> None:
        enabled = hasattr(sys.stderr, "isatty") and sys.stderr.isatty()
        self.GREEN = "\033[32m" if enabled else ""
        self.YELLOW = "\033[33m" if enabled else ""
        self.RED = "\033[31m" if enabled else ""
        self.CYAN = "\033[36m" if enabled else ""
        self.DIM = "\033[2m" if enabled else ""
        self.BOLD = "\033[1m" if enabled else ""
        self.RESET = "\033[0m" if enabled else ""


C = _Colors()


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def _log_ok(msg: str) -> None:
    _log(f"  {C.GREEN}✓{C.RESET} {msg}")


def _log_warn(msg: str) -> None:
    _log(f"  {C.YELLOW}⚠{C.RESET} {msg}")


def _log_err(msg: str) -> None:
    _log(f"  {C.RED}✗{C.RESET} {msg}")


# ---------------------------------------------------------------------------
# Content hashing (for deduplication)
# ---------------------------------------------------------------------------

def content_hash(text: str) -> str:
    """Generate a stable dedup key from input text.

    Normalizes whitespace and case so the same string from different
    scans or sources produces the same hash. Uses SHA-256 truncated
    to 16 hex chars — collision probability is negligible for eval
    corpus sizes under 100k cases.
    """
    normalized = " ".join(text.strip().lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Case filtering
# ---------------------------------------------------------------------------

def is_promotable(case: dict, include_low: bool = False) -> bool:
    """Check whether a triage case meets promotion criteria.

    Criteria:
        1. Has a human verdict (reviewed, not skipped)
        2. Has a resolvable standard_id (either top-level or from violations)
        3. Meets the confidence threshold OR is a human correction

    Args:
        case: A triage case dict.
        include_low: If True, also promote low-confidence cases.

    Returns:
        True if the case should be promoted.
    """
    # Must have been reviewed
    if not case.get("human_verdict"):
        return False

    # Must have a standard we can evaluate against.
    # For pass verdicts, standard_id may be None — these are still
    # valuable as "clean content" regression cases.
    # For fail verdicts, we need a standard_id to know what to test.
    if case.get("human_verdict") == "fail":
        standard_id = _resolve_standard_id(case)
        if not standard_id:
            return False

    # Confidence gate
    confidence = case.get("human_confidence", "low")
    if confidence in ("high", "medium"):
        return True

    # Revised cases are always promoted — corrections are gold
    review_status = case.get("review_status")
    triage_category = case.get("triage_category")
    machine_verdict = case.get("machine_verdict", case.get("expected"))
    human_verdict = case.get("human_verdict")

    # A "revision" is when the human disagrees with the machine
    is_correction = machine_verdict and human_verdict and machine_verdict != human_verdict
    if is_correction:
        return True

    # Low confidence: only if explicitly opted in
    return include_low


def _resolve_standard_id(case: dict) -> str | None:
    """Extract the primary standard_id from a triage case.

    Triage export cases (from the plugin) store violations in an array.
    Auto-annotated cases have standard_id at the top level.
    This function handles both schemas.
    """
    # Top-level standard_id (auto-annotated cases)
    if case.get("standard_id"):
        return case["standard_id"]

    # From violations array (plugin triage export)
    violations = case.get("violations", [])
    if violations and isinstance(violations, list):
        first = violations[0]
        if isinstance(first, dict) and first.get("standard_id"):
            return first["standard_id"]

    return None


# ---------------------------------------------------------------------------
# Schema transform: triage → eval
# ---------------------------------------------------------------------------

def transform_case(
    case: dict,
    source_file: str,
    category_map: dict[str, str] | None = None,
) -> dict:
    """Transform a triage case to eval case schema.

    The eval schema is what run_evals.py consumes. Key mapping:
        triage.input         → eval.input
        triage.human_verdict → eval.expected  (human is ground truth)
        triage.content_type  → eval.content_type
        violations[0].id     → eval.standard_id
        category_map lookup  → eval.category

    Provenance fields are added for audit trail.
    """
    text = case.get("input", case.get("text", ""))
    human_verdict = case["human_verdict"]
    c_type = case.get("content_type", "short_ui_copy")
    standard_id = _resolve_standard_id(case)

    # For pass cases without a standard, use a sentinel
    if not standard_id and human_verdict == "pass":
        standard_id = "_PASS_NO_STANDARD"

    # Look up category from standards library
    category = None
    if category_map and standard_id:
        category = category_map.get(standard_id)
    # Fall back to case-level category if present
    if not category:
        category = case.get("category", "unknown")

    # Generate a stable, descriptive case_id
    chash = content_hash(text)[:8]
    case_id = f"TRIAGE {standard_id or 'PASS'} {c_type} {chash}"

    eval_case: dict[str, Any] = {
        "case_id": case_id,
        "standard_id": standard_id,
        "input": text,
        "expected": human_verdict,
        "category": category,
        "content_type": c_type,
        # Human annotation fields (preserved for calibration)
        "human_verdict": human_verdict,
        "human_confidence": case.get("human_confidence"),
        "human_notes": case.get("human_notes"),
        # Provenance
        "promoted_from": source_file,
        "promoted_at": datetime.now(timezone.utc).isoformat(),
        "original_case_id": case.get("case_id"),
        "triage_category": case.get("triage_category"),
        "source": case.get("source", ""),
        "domain": case.get("domain", "unknown"),
    }

    return eval_case


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def load_existing_hashes(target_path: Path) -> set[str]:
    """Load content hashes from an existing eval file for dedup.

    Returns an empty set if the file doesn't exist.
    """
    if not target_path.exists():
        return set()

    try:
        with open(target_path) as f:
            data = json.load(f)
        return {
            content_hash(c["input"])
            for c in data.get("cases", [])
            if c.get("input")
        }
    except (json.JSONDecodeError, KeyError):
        return set()


def load_all_corpus_hashes(target_dir: Path) -> set[str]:
    """Load content hashes from ALL eval files in a directory.

    This catches duplicates even when promoting to a new file —
    the same string shouldn't appear anywhere in the corpus.
    """
    all_hashes: set[str] = set()
    if not target_dir.exists():
        return all_hashes

    for path in target_dir.glob("*.json"):
        try:
            with open(path) as f:
                data = json.load(f)
            for c in data.get("cases", []):
                if c.get("input"):
                    all_hashes.add(content_hash(c["input"]))
        except (json.JSONDecodeError, KeyError):
            continue

    return all_hashes


# ---------------------------------------------------------------------------
# Target file management
# ---------------------------------------------------------------------------

def resolve_target_path(explicit_target: Path | None, source_data: dict) -> Path:
    """Determine which eval file to append promoted cases to.

    Priority:
        1. Explicit --target path
        2. Domain-based file (e.g., evals/industry/fintech_eval_cases.json)
        3. Generic promoted_cases.json
    """
    if explicit_target:
        return explicit_target

    domain = source_data.get("domain", "unknown")
    if domain and domain != "unknown":
        safe_domain = domain.lower().replace(" ", "_").replace("/", "_")
        return DEFAULT_TARGET / f"{safe_domain}_eval_cases.json"

    return DEFAULT_TARGET / "promoted_cases.json"


def append_to_eval_file(
    target_path: Path,
    new_cases: list[dict],
    source_data: dict,
) -> int:
    """Append promoted cases to an existing eval file, or create a new one.

    Uses atomic write (temp file + rename) to prevent corruption.
    Returns the total number of cases in the file after appending.
    """
    if target_path.exists():
        with open(target_path) as f:
            existing = json.load(f)
        existing_cases = existing.get("cases", [])
    else:
        # Create new eval file with metadata
        source_org = source_data.get("source_org", "")
        domain = source_data.get("domain", "unknown")
        existing = {
            "description": f"Promoted triage cases — {domain}",
            "domain": domain,
            "source_org": source_org,
            "source_url": source_data.get("source_url", ""),
            "date_captured": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "eval_type": "capability",
            "schema_version": EVAL_SCHEMA_VERSION,
            "cases": [],
        }
        existing_cases = []

    # Append new cases
    all_cases = existing_cases + new_cases
    existing["cases"] = all_cases

    # Update metadata
    existing["date_captured"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if "promotion_history" not in existing:
        existing["promotion_history"] = []
    existing["promotion_history"].append({
        "promoted_at": datetime.now(timezone.utc).isoformat(),
        "cases_added": len(new_cases),
        "total_after": len(all_cases),
    })

    # Atomic write
    target_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        suffix=".json",
        prefix=".promote_",
        dir=str(target_path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, str(target_path))
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    return len(all_cases)


# ---------------------------------------------------------------------------
# Regression suite
# ---------------------------------------------------------------------------

def run_regression(model: str = "claude-sonnet-4-20250514") -> tuple[bool, str]:
    """Run the library eval as a regression gate.

    Returns (passed, summary_message).
    The gate threshold is ≥98% accuracy.
    """
    _log(f"\n{C.BOLD}Running regression suite...{C.RESET}")

    try:
        result = subprocess.run(
            [
                sys.executable, "-m", "evals.run_evals",
                "--runs", "1",
                "--model", model,
            ],
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=600,  # 10 minute timeout
        )
    except subprocess.TimeoutExpired:
        return False, "Regression suite timed out after 10 minutes."
    except FileNotFoundError:
        return False, "Could not find Python interpreter to run evals."

    # Parse accuracy from output
    output = result.stdout + result.stderr
    for line in output.splitlines():
        if "Average accuracy:" in line:
            try:
                pct_str = line.split(":")[-1].strip().rstrip("%")
                accuracy = float(pct_str)
                passed = accuracy >= 98.0
                return passed, f"Accuracy: {accuracy:.1f}% ({'PASS' if passed else 'FAIL'} — gate is ≥98%)"
            except (ValueError, IndexError):
                pass

    if result.returncode != 0:
        return False, f"Eval runner exited with code {result.returncode}."

    return True, "Regression suite completed (could not parse accuracy)."


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Promote reviewed triage cases to the permanent eval corpus. "
            "Filters by confidence, deduplicates, and optionally runs "
            "the regression suite."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 tools/promote_cases.py triage/opendoor_2026-03-29.json\n"
            "  python3 tools/promote_cases.py triage/stripe.json --target evals/industry/fintech_eval_cases.json\n"
            "  python3 tools/promote_cases.py triage/cases.json --dry-run\n"
            "  python3 tools/promote_cases.py triage/cases.json --run-evals\n"
        ),
    )

    parser.add_argument(
        "file",
        type=Path,
        help="Reviewed triage file (must contain cases with human_verdict).",
    )
    parser.add_argument(
        "--target", "-t",
        type=Path,
        default=None,
        help=(
            "Target eval file to append to. Defaults to "
            "evals/industry/<domain>_eval_cases.json."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be promoted without writing anything.",
    )
    parser.add_argument(
        "--run-evals",
        action="store_true",
        help="Run the regression suite after promotion.",
    )
    parser.add_argument(
        "--include-low",
        action="store_true",
        help="Include low-confidence cases (default: high + medium only).",
    )
    parser.add_argument(
        "--model",
        default="claude-sonnet-4-20250514",
        help="Model for regression suite (if --run-evals).",
    )

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Load source file
    if not args.file.exists():
        _log_err(f"File not found: {args.file}")
        sys.exit(1)

    with open(args.file) as f:
        source_data = json.load(f)

    cases = source_data.get("cases", [])
    if not cases:
        _log_err("No cases found in source file.")
        sys.exit(1)

    # --- Header ---
    reviewed = sum(1 for c in cases if c.get("human_verdict"))
    _log(f"{C.BOLD}ContentRX eval promotion{C.RESET}")
    _log(f"  Source: {args.file}")
    _log(f"  Total cases: {len(cases)}")
    _log(f"  Reviewed: {reviewed}")

    # --- Build category map from standards library ---
    category_map: dict[str, str] | None = None
    try:
        from content_checker.standards.loader import load_standards
        standards_data = load_standards()
        category_map = {}
        for cat in standards_data.get("categories", []):
            for std in cat.get("standards", []):
                category_map[std["id"]] = cat["name"]
    except ImportError:
        _log_warn("Could not load standards library — category lookup unavailable.")

    # --- Filter promotable cases ---
    promotable = [c for c in cases if is_promotable(c, include_low=args.include_low)]

    if not promotable:
        _log(f"\n  No cases meet promotion criteria.")
        _log(f"  Requirements: human_verdict set, confidence ≥ medium (or correction)")
        sys.exit(0)

    # --- Transform to eval schema ---
    eval_cases = [
        transform_case(c, source_file=str(args.file), category_map=category_map)
        for c in promotable
    ]

    # --- Deduplicate against existing corpus ---
    target_path = resolve_target_path(args.target, source_data)
    existing_hashes = load_all_corpus_hashes(DEFAULT_TARGET)
    # Also include hashes from the specific target if it's outside the default dir
    if target_path.parent != DEFAULT_TARGET:
        existing_hashes |= load_existing_hashes(target_path)

    before_dedup = len(eval_cases)
    eval_cases = [
        c for c in eval_cases
        if content_hash(c["input"]) not in existing_hashes
    ]
    dupes_removed = before_dedup - len(eval_cases)

    # --- Report ---
    _log(f"\n{C.BOLD}Promotion summary{C.RESET}")
    _log(f"  Promotable: {len(promotable)}")
    if dupes_removed:
        _log(f"  Duplicates removed: {dupes_removed}")
    _log(f"  New cases to promote: {len(eval_cases)}")
    _log(f"  Target: {target_path}")

    if eval_cases:
        # Category breakdown
        cats = Counter(c.get("triage_category", "unknown") for c in eval_cases)
        _log(f"\n  By triage category:")
        for cat, n in cats.most_common():
            _log(f"    {cat}: {n}")

        # Correction cases (highest-signal)
        corrections = [
            c for c in eval_cases
            if c.get("triage_category") in ("misclassification", "hallucination")
            or (c.get("human_verdict") != c.get("expected"))  # fallback for older schemas
        ]
        if corrections:
            _log(f"\n  {C.CYAN}Corrections (machine was wrong): {len(corrections)}{C.RESET}")
            for c in corrections[:5]:
                _log(f"    {c['case_id']}: {c['input'][:60]}...")

        # Standard coverage
        standards = Counter(c.get("standard_id", "none") for c in eval_cases)
        _log(f"\n  Standards covered: {len(standards)}")

    if not eval_cases:
        _log(f"\n  All promotable cases already exist in the corpus.")
        sys.exit(0)

    if args.dry_run:
        _log(f"\n  {C.YELLOW}DRY RUN — nothing written.{C.RESET}")
        _log(f"\n  Cases that would be promoted:")
        for c in eval_cases:
            verdict = c["expected"]
            conf = c.get("human_confidence", "?")
            _log(f"    [{verdict}/{conf}] {c['standard_id']}: {c['input'][:60]}...")
        sys.exit(0)

    # --- Write ---
    total_after = append_to_eval_file(target_path, eval_cases, source_data)
    _log_ok(f"Promoted {len(eval_cases)} cases to {target_path}")
    _log(f"  Corpus size: {total_after} cases")

    # --- Regression suite ---
    if args.run_evals:
        passed, summary = run_regression(model=args.model)
        if passed:
            _log_ok(summary)
        else:
            _log_err(summary)
            _log_warn(
                "The new cases may have exposed a real issue. "
                "Investigate before reverting — the cases are NOT rolled back."
            )
            sys.exit(1)

    _log(f"\n{C.BOLD}Done.{C.RESET}")


if __name__ == "__main__":
    main()
