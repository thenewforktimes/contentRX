"""Auto-annotator for eval case generation.

Takes raw extracted content (from extract_content.py) or a URL, runs each
case through the checker pipeline for a machine verdict, then uses a
calibrated LLM pass to pre-fill human annotation fields. Output is a
complete eval case file ready for human review.

Usage:
    # Annotate an existing extracted file
    python auto_annotate.py --input extracted_cases.json --output annotated.json

    # Full pipeline: extract from URL + annotate
    python auto_annotate.py https://example.com --domain healthcare \\
        --org "Kaiser Permanente" --output annotated.json

    # Dry run: show what would be annotated without calling the API
    python auto_annotate.py --input extracted.json --dry-run

    # Use specific calibration files
    python auto_annotate.py --input extracted.json --output annotated.json \\
        --calibration ../evals/industry/healthcare_eval_cases.json \\
        --calibration ../evals/industry/fintech_eval_cases.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Annotation constants
# ---------------------------------------------------------------------------

# Confidence thresholds based on precedent count
CONFIDENCE_HIGH_THRESHOLD = 3   # 3+ identical precedents → high
CONFIDENCE_MEDIUM_THRESHOLD = 1  # 1-2 precedents → medium, 0 → low

# Default model for annotation LLM calls
ANNOTATION_MODEL = "claude-sonnet-4-20250514"

# Default calibration file locations (relative to this file)
DEFAULT_CALIBRATION_PATHS = [
    Path(__file__).parent.parent / "evals" / "industry" / "healthcare_eval_cases.json",
    Path(__file__).parent.parent / "evals" / "industry" / "fintech_eval_cases.json",
]


# ---------------------------------------------------------------------------
# Standard → category mapping
# ---------------------------------------------------------------------------

def _build_category_map(standards_data: dict) -> dict[str, str]:
    """Build a standard_id → category name lookup from the standards library."""
    mapping: dict[str, str] = {}
    for cat in standards_data.get("categories", []):
        for std in cat.get("standards", []):
            mapping[std["id"]] = cat["name"]
    return mapping


# ---------------------------------------------------------------------------
# Stage 1: Machine verdict
# ---------------------------------------------------------------------------

def run_machine_verdict(
    case: dict,
    category_map: dict[str, str],
    model: str = ANNOTATION_MODEL,
) -> dict:
    """Run a single case through the checker pipeline and fill machine fields.

    Populates: standard_id (if multi-standard), expected, category.
    Also attaches the full checker output as _machine_result for stage 2.

    Args:
        case: An eval case dict with at least 'input' and 'content_type'.
        category_map: standard_id → category name lookup.
        model: Claude model for the checker pipeline.

    Returns:
        The case dict with machine fields populated and _machine_result attached.
    """
    from content_checker import check

    text = case["input"]
    content_type = case.get("content_type")

    try:
        result, latency, tokens = check(text, content_type=content_type, model=model)
    except Exception as exc:
        case["_machine_error"] = str(exc)
        case["_machine_result"] = None
        return case

    # If the case already has a standard_id (from extraction or manual assignment),
    # check whether the machine found a violation for that specific standard.
    assigned_standard = case.get("standard_id")

    if assigned_standard:
        # Look for this specific standard in violations
        matching_violations = [
            v for v in result.violations
            if v.standard_id == assigned_standard
        ]
        case["expected"] = "fail" if matching_violations else "pass"
        case["category"] = category_map.get(assigned_standard, case.get("category"))
    else:
        # No standard pre-assigned. If the checker found violations, use the
        # first one as the primary standard. Otherwise mark as pass.
        if result.violations:
            primary = result.violations[0]
            case["standard_id"] = primary.standard_id
            case["expected"] = "fail"
            case["category"] = category_map.get(primary.standard_id)
        else:
            case["expected"] = "pass"

    # Attach full result for stage 2 (not persisted to output)
    case["_machine_result"] = result.to_dict()
    case["_machine_latency"] = latency
    case["_machine_tokens"] = tokens.to_dict()

    return case


# ---------------------------------------------------------------------------
# Stage 2: Calibrated human annotation
# ---------------------------------------------------------------------------

def run_annotation(
    case: dict,
    system_prompt: str,
    model: str = ANNOTATION_MODEL,
) -> dict:
    """Run the calibrated LLM annotation pass for a single case.

    Uses the calibration prompt (built from existing human annotations)
    to generate human_verdict, human_confidence, and human_notes that
    match the annotator's voice and judgment patterns.

    Args:
        case: An eval case dict with machine verdict already populated.
        system_prompt: The calibration system prompt from annotator_prompt.py.
        model: Claude model for annotation.

    Returns:
        The case dict with human annotation fields populated and review_status set.
    """
    import anthropic

    # Build the user message with all context the annotator needs
    machine_result = case.get("_machine_result")
    if machine_result is None:
        # Machine stage failed — mark for manual review
        case["human_verdict"] = None
        case["human_confidence"] = "low"
        case["human_notes"] = f"Machine stage failed: {case.get('_machine_error', 'unknown error')}. Needs manual review."
        case["review_status"] = "flagged"
        return case

    # Build reasoning context from the checker's output
    violations_summary = ""
    if machine_result.get("violations"):
        violation_lines = []
        for v in machine_result["violations"]:
            violation_lines.append(
                f"  - {v['standard_id']}: {v['issue']} (suggestion: {v['suggestion']})"
            )
        violations_summary = "Machine violations:\n" + "\n".join(violation_lines)
    else:
        violations_summary = "Machine violations: none"

    user_message = (
        f"Annotate this case.\n\n"
        f"Input: \"{case['input']}\"\n"
        f"Content type: {case.get('content_type', 'unknown')}\n"
        f"Standard being tested: {case.get('standard_id', 'unknown')}\n"
        f"Machine verdict (expected): {case.get('expected', 'unknown')}\n"
        f"Source: {case.get('source', 'unknown')}\n"
        f"Extraction note: {case.get('note', 'none')}\n\n"
        f"{violations_summary}\n"
        f"Machine summary: {machine_result.get('summary', 'none')}\n\n"
        f"Provide your annotation as JSON."
    )

    client = anthropic.Anthropic()

    try:
        response = client.messages.create(
            model=model,
            max_tokens=500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
    except Exception as exc:
        case["human_verdict"] = None
        case["human_confidence"] = "low"
        case["human_notes"] = f"Annotation API call failed: {exc}"
        case["review_status"] = "flagged"
        return case

    raw = response.content[0].text.strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    try:
        annotation = json.loads(raw)
    except json.JSONDecodeError:
        case["human_verdict"] = None
        case["human_confidence"] = "low"
        case["human_notes"] = f"Failed to parse annotation response: {raw[:200]}"
        case["review_status"] = "flagged"
        return case

    # Validate and apply annotation fields
    verdict = annotation.get("human_verdict", "").lower()
    if verdict not in ("pass", "fail"):
        case["human_verdict"] = None
        case["human_notes"] = f"Invalid verdict '{verdict}' from annotator. {annotation.get('human_notes', '')}"
        case["human_confidence"] = "low"
        case["review_status"] = "flagged"
        return case

    confidence = annotation.get("human_confidence", "low").lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    case["human_verdict"] = verdict
    case["human_confidence"] = confidence
    case["human_notes"] = annotation.get("human_notes", "")

    # Set review status based on confidence and agreement
    if case["human_verdict"] != case.get("expected"):
        # Disagreement — always needs review regardless of confidence
        case["review_status"] = "pending"
    elif confidence == "high":
        case["review_status"] = "pending"
    else:
        case["review_status"] = "pending"

    # Track annotation tokens (not persisted, used for cost reporting)
    case["_annotation_tokens"] = {
        "input": response.usage.input_tokens,
        "output": response.usage.output_tokens,
    }

    return case


# ---------------------------------------------------------------------------
# Pipeline orchestrator
# ---------------------------------------------------------------------------

def annotate_cases(
    cases: list[dict],
    calibration_files: list[Path],
    model: str = ANNOTATION_MODEL,
    dry_run: bool = False,
) -> tuple[list[dict], dict]:
    """Run both annotation stages on a list of eval cases.

    Args:
        cases: List of eval case dicts (from extract_content.py or manual creation).
        calibration_files: Paths to existing annotated eval case files for few-shot calibration.
        model: Claude model for all LLM calls.
        dry_run: If True, skip API calls and show what would be annotated.

    Returns:
        (annotated_cases, run_stats)
    """
    from annotator_prompt import load_annotated_cases

    total_cases = len(cases)
    skipped = 0
    errors = 0
    disagreements = 0
    total_machine_tokens = {"input": 0, "output": 0}
    total_annotation_tokens = {"input": 0, "output": 0}
    start_time = time.time()

    # Load calibration data (needed for both dry-run reporting and real runs)
    existing_annotations = load_annotated_cases(*calibration_files)

    _log(f"Starting annotation of {total_cases} cases")
    _log(f"Calibration examples: {len(existing_annotations)} annotated cases from {len(calibration_files)} files")
    _log(f"Model: {model}")
    _log("")

    if dry_run:
        _log("DRY RUN — no API calls will be made\n")
        for i, case in enumerate(cases):
            already_annotated = case.get("human_verdict") is not None
            status = "SKIP (already annotated)" if already_annotated else "WOULD ANNOTATE"
            _log(f"  [{i + 1}/{total_cases}] {status}: {case.get('case_id', 'unknown')}")
            _log(f"    Input: {case['input'][:60]}{'...' if len(case['input']) > 60 else ''}")
            _log(f"    Content type: {case.get('content_type', 'unknown')}")
            _log(f"    Standard: {case.get('standard_id', 'unassigned')}")
        skipped_count = sum(1 for c in cases if c.get("human_verdict") is not None)
        would_annotate = sum(1 for c in cases if c.get("human_verdict") is None)
        stats = {
            "total_cases": total_cases,
            "annotated": 0,  # dry run doesn't annotate anything
            "skipped": skipped_count,
            "errors": 0,
            "disagreements": 0,
            "would_annotate": would_annotate,
            "dry_run": True,
        }
        return cases, stats

    # Heavy imports deferred past dry-run so dry-run works without the package
    from content_checker.standards.loader import load_standards
    from annotator_prompt import build_calibration_prompt

    standards_data = load_standards()
    category_map = _build_category_map(standards_data)
    calibration_prompt = build_calibration_prompt(existing_annotations)

    for i, case in enumerate(cases):
        case_id = case.get("case_id", f"case-{i}")

        # Skip cases that already have human annotations
        if case.get("human_verdict") is not None:
            _log(f"  [{i + 1}/{total_cases}] SKIP (annotated): {case_id}")
            skipped += 1
            # Ensure review_status exists on pre-annotated cases
            if "review_status" not in case:
                case["review_status"] = "approved"
            continue

        _log(f"  [{i + 1}/{total_cases}] Annotating: {case_id}")

        # Stage 1: Machine verdict
        case = run_machine_verdict(case, category_map, model=model)

        if case.get("_machine_tokens"):
            total_machine_tokens["input"] += case["_machine_tokens"]["input"]
            total_machine_tokens["output"] += case["_machine_tokens"]["output"]

        if case.get("_machine_error"):
            _log(f"    Machine error: {case['_machine_error']}")
            errors += 1
            continue

        _log(f"    Machine verdict: {case.get('expected', '?')} ({case.get('standard_id', 'none')})")

        # Stage 2: Calibrated annotation
        case = run_annotation(case, calibration_prompt, model=model)

        if case.get("_annotation_tokens"):
            total_annotation_tokens["input"] += case["_annotation_tokens"]["input"]
            total_annotation_tokens["output"] += case["_annotation_tokens"]["output"]

        if case.get("human_verdict") and case.get("expected"):
            is_disagreement = case["human_verdict"] != case["expected"]
            if is_disagreement:
                disagreements += 1
            verdict_label = f"{case['human_verdict']} (DISAGREE)" if is_disagreement else case["human_verdict"]
        else:
            verdict_label = case.get("human_verdict", "error")

        _log(f"    Annotation: {verdict_label}, confidence={case.get('human_confidence', '?')}")

    elapsed = time.time() - start_time

    # Cost estimation (Claude Sonnet pricing as of 2025)
    machine_cost = (total_machine_tokens["input"] * 3.0 + total_machine_tokens["output"] * 15.0) / 1_000_000
    annotation_cost = (total_annotation_tokens["input"] * 3.0 + total_annotation_tokens["output"] * 15.0) / 1_000_000
    total_cost = machine_cost + annotation_cost

    stats = {
        "total_cases": total_cases,
        "annotated": total_cases - skipped - errors,
        "skipped": skipped,
        "errors": errors,
        "disagreements": disagreements,
        "elapsed_seconds": round(elapsed, 1),
        "machine_tokens": total_machine_tokens,
        "annotation_tokens": total_annotation_tokens,
        "estimated_cost": f"${total_cost:.2f}",
        "dry_run": False,
    }

    _log("")
    _log(f"Done in {elapsed:.1f}s")
    _log(f"  Annotated: {stats['annotated']}, Skipped: {skipped}, Errors: {errors}")
    _log(f"  Disagreements: {disagreements}")
    _log(f"  Estimated cost: ${total_cost:.2f} (machine: ${machine_cost:.2f}, annotation: ${annotation_cost:.2f})")

    return cases, stats


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def _clean_case_for_output(case: dict) -> dict:
    """Remove internal fields before writing to disk."""
    internal_keys = [
        "_machine_result", "_machine_latency", "_machine_tokens",
        "_machine_error", "_annotation_tokens",
    ]
    return {k: v for k, v in case.items() if k not in internal_keys}


def build_output(
    cases: list[dict],
    stats: dict,
    source_url: str = "",
    domain: str = "unknown",
    source_org: str = "",
    input_file: str = "",
) -> dict:
    """Build the final output JSON with metadata."""
    clean_cases = [_clean_case_for_output(c) for c in cases]

    # Derive source description
    if source_url:
        source_desc = f"Auto-annotated from {source_url}"
    elif input_file:
        source_desc = f"Auto-annotated from {input_file}"
    else:
        source_desc = "Auto-annotated eval cases"

    return {
        "description": source_desc,
        "domain": domain,
        "source_org": source_org,
        "source_url": source_url,
        "date_captured": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "eval_type": "capability",
        "schema_version": "1.1.0",
        "annotation_stats": {
            "total_cases": stats["total_cases"],
            "auto_annotated": stats.get("annotated", 0),
            "pre_annotated": stats.get("skipped", 0),
            "errors": stats.get("errors", 0),
            "disagreements": stats.get("disagreements", 0),
            "review_pending": sum(
                1 for c in clean_cases
                if c.get("review_status") == "pending"
            ),
        },
        "cases": clean_cases,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log(msg: str) -> None:
    """Log to stderr so stdout stays clean for piped JSON output."""
    print(msg, file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Auto-annotate eval cases with machine verdicts and calibrated "
            "human annotations. Supports both URL extraction and pre-extracted "
            "JSON input."
        ),
        epilog=(
            "Examples:\n"
            "  python auto_annotate.py --input extracted.json --output annotated.json\n"
            "  python auto_annotate.py https://kp.org --domain healthcare --org 'Kaiser Permanente' --output cases.json\n"
            "  python auto_annotate.py --input cases.json --dry-run\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Input source: URL or file
    parser.add_argument(
        "url",
        nargs="?",
        default=None,
        help="URL to extract content from (runs extract_content.py first).",
    )
    parser.add_argument(
        "--input", "-i",
        dest="input_file",
        help="Pre-extracted JSON file to annotate (skip extraction).",
    )

    # Output
    parser.add_argument(
        "--output", "-o",
        help="Output file path. If omitted, prints JSON to stdout.",
    )

    # Metadata
    parser.add_argument(
        "--domain", "-d",
        default="unknown",
        help="Domain label (e.g., healthcare, fintech).",
    )
    parser.add_argument(
        "--org",
        default="",
        help="Source organization name.",
    )

    # Calibration
    parser.add_argument(
        "--calibration", "-c",
        action="append",
        dest="calibration_files",
        help="Path to annotated eval case file for calibration. Can be specified multiple times.",
    )

    # Options
    parser.add_argument(
        "--model",
        default=ANNOTATION_MODEL,
        help=f"Claude model for annotation (default: {ANNOTATION_MODEL}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be annotated without making API calls.",
    )

    args = parser.parse_args()

    # Validate: need either a URL or an input file
    if not args.url and not args.input_file:
        parser.error("Provide either a URL or --input file.")

    # Resolve calibration files
    if args.calibration_files:
        calibration_paths = [Path(p) for p in args.calibration_files]
    else:
        calibration_paths = [p for p in DEFAULT_CALIBRATION_PATHS if p.exists()]

    if not calibration_paths:
        _log(
            "Warning: no calibration files found. Annotation quality will be "
            "lower without few-shot examples. Use --calibration to specify paths."
        )

    # Load or extract cases
    if args.input_file:
        _log(f"Loading cases from {args.input_file}...")
        input_path = Path(args.input_file)
        if not input_path.exists():
            _log(f"Error: file not found: {args.input_file}")
            sys.exit(1)
        with open(input_path) as f:
            input_data = json.load(f)
        cases = input_data.get("cases", [])
        source_url = input_data.get("source_url", "")
        domain = args.domain if args.domain != "unknown" else input_data.get("domain", "unknown")
        source_org = args.org or input_data.get("source_org", "")
    else:
        # URL mode: run extractor inline
        _log(f"Extracting content from {args.url}...")
        try:
            from extract_content import extract_from_html, fetch_html, to_eval_cases
        except ImportError:
            _log(
                "Error: extract_content.py not found. Make sure you're running "
                "from the tools/ directory or that extract_content.py is on PYTHONPATH."
            )
            sys.exit(1)

        try:
            html = fetch_html(args.url)
        except Exception as exc:
            _log(f"Error fetching URL: {exc}")
            sys.exit(1)

        contents = extract_from_html(html)
        if not contents:
            _log("No user-facing content found.")
            sys.exit(0)

        eval_data = to_eval_cases(
            contents,
            source_url=args.url,
            domain=args.domain,
            source_org=args.org,
        )
        cases = eval_data.get("cases", [])
        source_url = args.url
        domain = args.domain
        source_org = args.org

    if not cases:
        _log("No cases to annotate.")
        sys.exit(0)

    _log(f"Found {len(cases)} cases\n")

    # Run annotation pipeline
    annotated_cases, stats = annotate_cases(
        cases,
        calibration_files=calibration_paths,
        model=args.model,
        dry_run=args.dry_run,
    )

    # Build output
    output = build_output(
        annotated_cases,
        stats,
        source_url=source_url,
        domain=domain,
        source_org=source_org,
        input_file=args.input_file or "",
    )

    # Write output
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2)
        _log(f"\nWrote {len(cases)} cases to {args.output}")
    else:
        print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
