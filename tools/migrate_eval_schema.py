#!/usr/bin/env python3
"""Eval corpus schema migration and validation.

Fixes:
    1. Backfills machine_verdict from expected (was null across all corpora)
    2. Validates required fields and allowed values
    3. Reports schema health metrics per corpus

Run from project root:
    python3 tools/migrate_eval_schema.py

Dry run (report only, no writes):
    python3 tools/migrate_eval_schema.py --dry-run

Architecture note:
    The eval schema has three verdict fields with distinct semantics:

    expected        What the machine pipeline produced (pass/fail).
                    Set by the auto-annotator at annotation time.
                    This is the machine's call — not a ground truth label.

    machine_verdict Mirror of expected. Exists for semantic clarity so that
                    downstream metrics code doesn't have to know that
                    "expected" means "machine prediction." Backfilled by
                    this migration for all pre-v4.6.1 cases.

    human_verdict   What the human annotator decided after reviewing the
                    machine's call. This is the authoritative ground truth
                    for calibration purposes.

    Disagreement = expected != human_verdict (equivalently,
    machine_verdict != human_verdict). This is the signal that drives
    patches.

    human_confidence should capture the annotator's certainty:
        high    — clear-cut, would bet on this call
        medium  — defensible but could see the other side
        low     — coin flip, need more context or a second opinion

    If human_confidence is the same value for all cases in a corpus, the
    annotator is not using the scale. This script flags that as a warning.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Schema contract
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = {
    "id", "text", "content_type", "standard_id", "expected",
    "human_verdict", "human_confidence", "review_status", "triage_category",
}

ALLOWED_VERDICTS = {"pass", "fail"}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}
ALLOWED_REVIEW_STATUS = {"approved", "pending", "disputed", "revised", "flagged"}
ALLOWED_TRIAGE = {"correct", "context_gap", "misclassification",
                  "hallucination", "missing_standard"}


def validate_case(case: dict, case_idx: int, filename: str) -> list[str]:
    """Validate a single eval case against the schema contract.

    Returns a list of warning/error strings. Empty list = clean.
    """
    issues = []
    case_id = case.get("id", f"index-{case_idx}")

    # Required fields
    missing = REQUIRED_FIELDS - set(case.keys())
    if missing:
        issues.append(f"  {case_id}: missing fields: {sorted(missing)}")

    # Verdict values
    for field in ("expected", "human_verdict", "machine_verdict"):
        val = case.get(field)
        if val is not None and val not in ALLOWED_VERDICTS:
            issues.append(
                f"  {case_id}: {field}='{val}' not in {ALLOWED_VERDICTS}"
            )

    # Confidence value
    conf = case.get("human_confidence")
    if conf is not None and conf not in ALLOWED_CONFIDENCE:
        issues.append(
            f"  {case_id}: human_confidence='{conf}' not in "
            f"{ALLOWED_CONFIDENCE}"
        )

    # Review status
    status = case.get("review_status")
    if status is not None and status not in ALLOWED_REVIEW_STATUS:
        issues.append(
            f"  {case_id}: review_status='{status}' not in "
            f"{ALLOWED_REVIEW_STATUS}"
        )

    # Triage category
    triage = case.get("triage_category")
    if triage is not None and triage not in ALLOWED_TRIAGE:
        issues.append(
            f"  {case_id}: triage_category='{triage}' not in "
            f"{ALLOWED_TRIAGE}"
        )

    # machine_verdict should match expected (post-migration)
    mv = case.get("machine_verdict")
    exp = case.get("expected")
    if mv is not None and exp is not None and mv != exp:
        issues.append(
            f"  {case_id}: machine_verdict='{mv}' != expected='{exp}' — "
            f"these must agree (machine_verdict mirrors expected)"
        )

    return issues


def validate_corpus(filepath: Path, dry_run: bool = False) -> dict:
    """Validate and optionally migrate a single eval corpus file.

    Returns a summary dict with counts and issues.
    """
    with open(filepath) as f:
        data = json.load(f)

    cases = data.get("cases", [])
    filename = filepath.name

    summary = {
        "file": filename,
        "total_cases": len(cases),
        "machine_verdict_null": 0,
        "machine_verdict_backfilled": 0,
        "validation_issues": [],
        "confidence_distribution": {},
        "agreement_rate": 0.0,
        "warnings": [],
    }

    agrees = 0
    for i, case in enumerate(cases):
        # --- Migration: backfill machine_verdict from expected ---
        if case.get("machine_verdict") is None and case.get("expected") is not None:
            summary["machine_verdict_null"] += 1
            if not dry_run:
                case["machine_verdict"] = case["expected"]
                summary["machine_verdict_backfilled"] += 1

        # --- Validation ---
        issues = validate_case(case, i, filename)
        summary["validation_issues"].extend(issues)

        # --- Metrics ---
        conf = case.get("human_confidence", "missing")
        summary["confidence_distribution"][conf] = (
            summary["confidence_distribution"].get(conf, 0) + 1
        )

        if case.get("expected") == case.get("human_verdict"):
            agrees += 1

    if cases:
        summary["agreement_rate"] = round(agrees / len(cases) * 100, 1)

    # --- Corpus-level warnings ---
    conf_values = set(summary["confidence_distribution"].keys())
    if len(conf_values) == 1 and len(cases) > 10:
        only_value = list(conf_values)[0]
        summary["warnings"].append(
            f"All {len(cases)} cases have human_confidence='{only_value}'. "
            f"If this is accurate, consider whether the confidence scale is "
            f"being used meaningfully. A corpus with zero variance in "
            f"confidence provides no signal for prioritizing patches."
        )

    # --- Write back if not dry run ---
    if not dry_run and summary["machine_verdict_backfilled"] > 0:
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)

    return summary


def main():
    dry_run = "--dry-run" in sys.argv

    # Find all eval corpus files
    evals_dir = Path("evals/industry")
    if not evals_dir.exists():
        print(f"Error: {evals_dir} not found. Run from project root.")
        sys.exit(1)

    corpus_files = sorted(evals_dir.glob("*_eval_cases.json"))
    if not corpus_files:
        print(f"No eval corpus files found in {evals_dir}")
        sys.exit(1)

    print(f"{'DRY RUN — ' if dry_run else ''}Eval corpus schema migration")
    print(f"Found {len(corpus_files)} corpus files in {evals_dir}")
    print("=" * 70)

    total_cases = 0
    total_backfilled = 0
    total_issues = 0
    all_warnings = []

    for filepath in corpus_files:
        summary = validate_corpus(filepath, dry_run)
        total_cases += summary["total_cases"]
        total_backfilled += summary["machine_verdict_backfilled"]
        total_issues += len(summary["validation_issues"])

        status = "✓" if not summary["validation_issues"] else "⚠"
        backfill_msg = ""
        if summary["machine_verdict_null"] > 0:
            if dry_run:
                backfill_msg = f" ({summary['machine_verdict_null']} need backfill)"
            else:
                backfill_msg = f" ({summary['machine_verdict_backfilled']} backfilled)"

        print(f"\n{status} {summary['file']}: {summary['total_cases']} cases, "
              f"{summary['agreement_rate']}% agreement{backfill_msg}")

        if summary["confidence_distribution"]:
            print(f"  Confidence: {summary['confidence_distribution']}")

        for issue in summary["validation_issues"]:
            print(f"  ⚠ {issue}")

        for warning in summary["warnings"]:
            all_warnings.append(f"  {summary['file']}: {warning}")

    print("\n" + "=" * 70)
    print(f"Total: {total_cases} cases across {len(corpus_files)} corpora")
    if dry_run:
        print(f"Backfill needed: {sum(s['machine_verdict_null'] for s in [validate_corpus(f, True) for f in corpus_files])} cases")
    else:
        print(f"Backfilled: {total_backfilled} machine_verdict fields")
    print(f"Validation issues: {total_issues}")

    if all_warnings:
        print(f"\nWarnings ({len(all_warnings)}):")
        for w in all_warnings:
            print(w)

    if total_issues > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
