"""Eval runner for the content standards checker.

Tests every standard in the library against its correct and incorrect examples.
Runs multiple passes to measure stability. Reports accuracy, precision, recall,
false positive rate, standard ID accuracy, latency, and estimated cost.

Standards with checkable_from != plain_text are skipped by default (they require
rich text or visual context that the CLI checker can't evaluate).

Usage:
    python run_evals.py                  # 3 runs, library cases (default)
    python run_evals.py --runs 5         # 5 runs
    python run_evals.py --novel          # only novel (generalization) cases
    python run_evals.py --novel --runs 5 # novel cases, 5 runs
    python run_evals.py --new-only       # only test standards with a 'sources' field
    python run_evals.py --category TRN   # only test one category prefix
    python run_evals.py --all            # include rich_text and visual standards
"""

import json
import sys
import time
import os
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve paths — works from evals/ or repo root
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent if SCRIPT_DIR.name == "evals" else SCRIPT_DIR

STANDARDS_PATH = REPO_ROOT / "standards" / "standards_library.json"
NOVEL_CASES_PATH = SCRIPT_DIR / "novel_cases.json"
CLI_DIR = REPO_ROOT / "cli"

sys.path.insert(0, str(CLI_DIR))
from checker import check_content, load_standards, build_system_prompt


def build_test_cases(standards_data, category_filter=None, new_only=False, include_all=False):
    """Build test cases from the standards library.

    Each standard produces 2 cases:
      - correct example → expected verdict: pass
      - incorrect example → expected verdict: fail

    By default, only standards with checkable_from=plain_text are included.
    Use include_all=True to include rich_text and visual standards.
    """
    cases = []
    skipped = []
    for cat in standards_data["categories"]:
        for std in cat["standards"]:
            # Apply filters
            if category_filter and not std["id"].startswith(category_filter):
                continue
            if new_only and "sources" not in std:
                continue
            if not include_all and std.get("checkable_from", "plain_text") != "plain_text":
                skipped.append(f"{std['id']} ({std.get('checkable_from', 'unknown')})")
                continue

            # Pick a content type where this standard is relevant.
            # Library evals test the scan + validation pipeline, not the classifier.
            relevant_types = std.get("relevant_content_types", [])
            content_type = relevant_types[0] if relevant_types else "short_ui_copy"

            cases.append({
                "case_id": f"{std['id']} correct",
                "standard_id": std["id"],
                "input": std["correct"],
                "expected": "pass",
                "category": cat["name"],
                "content_type": content_type,
            })
            cases.append({
                "case_id": f"{std['id']} incorrect",
                "standard_id": std["id"],
                "input": std["incorrect"],
                "expected": "fail",
                "category": cat["name"],
                "content_type": content_type,
            })
    return cases, skipped


def load_novel_cases(category_filter=None, standards_data=None):
    """Load novel (generalization) test cases from novel_cases.json.

    These are hand-written cases that test whether the agent reasons about
    standards vs. pattern-matching against the library examples.

    Each case should have a content_type field specifying the context it
    should be evaluated in. Falls back to deriving from the standard's
    relevant_content_types if the field is missing.
    """
    if not NOVEL_CASES_PATH.exists():
        print(f"Novel cases file not found: {NOVEL_CASES_PATH}")
        return []

    with open(NOVEL_CASES_PATH) as f:
        data = json.load(f)

    # Fallback lookup for cases missing content_type
    type_lookup = {}
    if standards_data:
        for cat in standards_data["categories"]:
            for std in cat["standards"]:
                relevant = std.get("relevant_content_types", [])
                type_lookup[std["id"]] = relevant[0] if relevant else "short_ui_copy"

    cases = []
    for case in data["cases"]:
        if category_filter and not case["standard_id"].startswith(category_filter):
            continue
        cases.append({
            "case_id": case["case_id"],
            "standard_id": case["standard_id"],
            "input": case["input"],
            "expected": case["expected"],
            "category": case["category"],
            "content_type": case.get("content_type") or type_lookup.get(case["standard_id"], "short_ui_copy"),
        })
    return cases


def run_single_eval(cases, model, run_number, total_runs, check_kwargs=None):
    """Run one pass of all test cases. Returns list of result dicts.

    check_kwargs: extra keyword arguments passed to check_content
    (e.g., skip_validation=True for library runs).
    """
    check_kwargs = check_kwargs or {}
    results = []
    total = len(cases)

    for i, case in enumerate(cases, 1):
        label = f"[Run {run_number}/{total_runs}] [{i}/{total}] {case['case_id']}"
        print(f"  {label}...", end=" ", flush=True)

        try:
            result, latency, tokens = check_content(
                case["input"],
                content_type_override=case.get("content_type"),
                model=model,
                **check_kwargs,
            )
            verdict = result.get("overall_verdict", "error")
            correct = verdict == case["expected"]

            # Check if the agent cited the right standard ID on failures
            standard_id_match = None
            if case["expected"] == "fail" and verdict == "fail":
                violations = result.get("violations", [])
                cited_ids = [v.get("standard_id", "") for v in violations]
                standard_id_match = case["standard_id"] in cited_ids

            icon = "✓" if correct else "✗"
            color = "\033[32m" if correct else "\033[31m"
            print(f"{color}{icon}\033[0m  verdict={verdict} expected={case['expected']} ({latency:.1f}s)")

            results.append({
                "case_id": case["case_id"],
                "standard_id": case["standard_id"],
                "category": case["category"],
                "input": case["input"],
                "expected": case["expected"],
                "actual": verdict,
                "correct": correct,
                "standard_id_match": standard_id_match,
                "latency": latency,
                "tokens": tokens,
            })

        except Exception as e:
            print(f"\033[31m✗ ERROR: {e}\033[0m")
            results.append({
                "case_id": case["case_id"],
                "standard_id": case["standard_id"],
                "category": case["category"],
                "input": case["input"],
                "expected": case["expected"],
                "actual": "error",
                "correct": False,
                "standard_id_match": None,
                "latency": 0,
                "tokens": {"input": 0, "output": 0},
                "error": str(e),
            })

    return results


def compute_metrics(all_runs, cases):
    """Compute aggregate metrics across all runs."""
    run_accuracies = []
    stability = {}
    total_latency = 0
    total_input_tokens = 0
    total_output_tokens = 0
    total_checks = 0

    # Per-case tracking across runs
    for case in cases:
        stability[case["case_id"]] = {
            "outcomes": [],
            "input": case["input"],
            "expected": case["expected"],
        }

    for run_results in all_runs:
        correct_count = sum(1 for r in run_results if r["correct"])
        run_accuracies.append(correct_count / len(run_results))

        for r in run_results:
            stability[r["case_id"]]["outcomes"].append(r["correct"])
            total_latency += r["latency"]
            total_input_tokens += r["tokens"]["input"]
            total_output_tokens += r["tokens"]["output"]
            total_checks += 1

    # Classify stability
    for case_id, data in stability.items():
        times_correct = sum(data["outcomes"])
        times_wrong = len(data["outcomes"]) - times_correct
        if times_wrong == 0:
            data["status"] = "stable_pass"
        elif times_correct == 0:
            data["status"] = "stable_fail"
        else:
            data["status"] = "unstable"
        data["times_correct"] = times_correct
        data["times_wrong"] = times_wrong

    # Count stability categories
    stable_passes = sum(1 for d in stability.values() if d["status"] == "stable_pass")
    stable_fails = sum(1 for d in stability.values() if d["status"] == "stable_fail")
    unstable = sum(1 for d in stability.values() if d["status"] == "unstable")

    # False positive rate (correct examples incorrectly flagged as fail)
    pass_cases_total = 0
    false_positives = 0
    for run_results in all_runs:
        for r in run_results:
            if r["expected"] == "pass":
                pass_cases_total += 1
                if r["actual"] == "fail":
                    false_positives += 1

    # Standard ID accuracy (when agent correctly fails, did it cite the right ID?)
    id_checks_total = 0
    id_checks_correct = 0
    for run_results in all_runs:
        for r in run_results:
            if r["standard_id_match"] is not None:
                id_checks_total += 1
                if r["standard_id_match"]:
                    id_checks_correct += 1

    # Cost estimate (Claude Sonnet pricing: $3/M input, $15/M output)
    estimated_cost = (total_input_tokens / 1_000_000 * 3) + (total_output_tokens / 1_000_000 * 15)

    return {
        "run_accuracies": run_accuracies,
        "average_accuracy": sum(run_accuracies) / len(run_accuracies),
        "stable_passes": stable_passes,
        "stable_fails": stable_fails,
        "unstable": unstable,
        "total_cases": len(cases),
        "false_positives": false_positives,
        "false_positive_rate": false_positives / pass_cases_total if pass_cases_total > 0 else 0,
        "standard_id_accuracy": id_checks_correct / id_checks_total if id_checks_total > 0 else None,
        "average_latency": total_latency / total_checks if total_checks > 0 else 0,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "estimated_cost_usd": estimated_cost,
        "stability": stability,
    }


def write_reports(metrics, model, num_runs, output_dir):
    """Write markdown and JSON reports."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Markdown report
    md = f"""# Stability report: {num_runs} eval runs

**Date:** {now}
**Model:** {model}
**Cases:** {metrics['total_cases']}

## Per-run accuracy

"""
    for i, acc in enumerate(metrics["run_accuracies"], 1):
        md += f"- Run {i}: {acc * 100:.1f}%\n"
    md += f"- Average: {metrics['average_accuracy'] * 100:.1f}%\n"

    md += f"""
## Stability

- Stable passes (correct every time): {metrics['stable_passes']}/{metrics['total_cases']}
- Stable fails (wrong every time): {metrics['stable_fails']}/{metrics['total_cases']}
- Unstable (flipped between runs): {metrics['unstable']}/{metrics['total_cases']}

## Quality metrics

- False positives: {metrics['false_positives']}
- False positive rate: {metrics['false_positive_rate'] * 100:.1f}%
- Standard ID accuracy: {f"{metrics['standard_id_accuracy'] * 100:.1f}%" if metrics['standard_id_accuracy'] is not None else "N/A"}

## Performance

- Average latency: {metrics['average_latency']:.1f}s per check
- Total tokens: {metrics['total_input_tokens']:,} input / {metrics['total_output_tokens']:,} output
- Estimated cost: ${metrics['estimated_cost_usd']:.2f}
"""

    # Flag unstable cases
    unstable_cases = {k: v for k, v in metrics["stability"].items() if v["status"] == "unstable"}
    if unstable_cases:
        md += "\n## Unstable cases\n\n"
        for case_id, data in unstable_cases.items():
            md += f"- **{case_id}**: correct {data['times_correct']}/{data['times_correct'] + data['times_wrong']} times\n"
            md += f"  - Input: \"{data['input']}\"\n"
            md += f"  - Expected: {data['expected']}\n"

    with open(output_dir / "stability_report.md", "w") as f:
        f.write(md)

    # JSON report
    json_report = {
        "run_accuracies": metrics["run_accuracies"],
        "average_accuracy": metrics["average_accuracy"],
        "false_positive_rate": metrics["false_positive_rate"],
        "standard_id_accuracy": metrics["standard_id_accuracy"],
        "average_latency": metrics["average_latency"],
        "estimated_cost_usd": metrics["estimated_cost_usd"],
        "stability": metrics["stability"],
    }

    with open(output_dir / "stability_report.json", "w") as f:
        json.dump(json_report, f, indent=2)

    return output_dir / "stability_report.md"


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Run evals for the content standards checker.")
    parser.add_argument("--runs", type=int, default=3, help="Number of eval runs (default: 3)")
    parser.add_argument("--model", default="claude-sonnet-4-20250514", help="Model to use")
    parser.add_argument("--novel", action="store_true", help="Run novel (generalization) test cases instead of library cases")
    parser.add_argument("--new-only", action="store_true", help="Only test standards with a 'sources' field")
    parser.add_argument("--category", help="Only test standards with this ID prefix (e.g., TRN, GRM)")
    parser.add_argument("--all", action="store_true", dest="include_all", help="Include rich_text and visual standards (skipped by default)")
    parser.add_argument("--output", default=None, help="Output directory (default: evals/results/)")
    args = parser.parse_args()

    output_dir = args.output or str(REPO_ROOT / "evals" / "results")

    print(f"Content standards checker — eval runner")
    print(f"Model: {args.model}")
    print(f"Runs: {args.runs}")
    if args.novel:
        print(f"Mode: novel (generalization) cases")

    if args.novel:
        standards_data = load_standards()
        cases = load_novel_cases(
            category_filter=args.category,
            standards_data=standards_data,
        )
        skipped = []
    else:
        standards_data = load_standards()
        cases, skipped = build_test_cases(
            standards_data,
            category_filter=args.category,
            new_only=args.new_only,
            include_all=args.include_all,
        )

    if not cases:
        print("No test cases matched the filters.")
        return

    if args.novel:
        unique_standards = len(set(c["standard_id"] for c in cases))
        print(f"Test cases: {len(cases)} novel cases across {unique_standards} standards")
    else:
        print(f"Test cases: {len(cases)} ({len(cases) // 2} standards × 2 examples)")
    if skipped:
        print(f"Skipped (not checkable from plain text): {', '.join(skipped)}")
    filters = []
    if args.new_only:
        filters.append("new standards only")
    if args.category:
        filters.append(f"category={args.category}")
    if args.include_all:
        filters.append("including rich_text and visual standards")
    if filters:
        print(f"Filters: {', '.join(filters)}")
    print()

    all_runs = []

    # Library evals test "does the system know its own rules" — use all standards
    # with no content type context or validation. This is preprocess + one LLM call
    # against the full library, matching v3.1.1 behavior plus deterministic checks.
    # Novel evals test real-world accuracy with the full pipeline.
    if args.novel:
        check_kwargs = {}
    else:
        check_kwargs = {"skip_validation": True, "skip_filter": True}
        print(f"Library mode: all standards, no filtering, no validation\n")

    for run_num in range(1, args.runs + 1):
        print(f"── Run {run_num}/{args.runs} ──")
        results = run_single_eval(cases, args.model, run_num, args.runs, check_kwargs=check_kwargs)
        all_runs.append(results)
        correct = sum(1 for r in results if r["correct"])
        print(f"  Run {run_num} accuracy: {correct}/{len(results)} ({correct/len(results)*100:.1f}%)\n")

    metrics = compute_metrics(all_runs, cases)
    report_path = write_reports(metrics, args.model, args.runs, output_dir)

    print(f"── Summary ──")
    print(f"Average accuracy: {metrics['average_accuracy'] * 100:.1f}%")
    print(f"Stable passes: {metrics['stable_passes']}/{metrics['total_cases']}")
    print(f"Unstable: {metrics['unstable']}/{metrics['total_cases']}")
    print(f"False positive rate: {metrics['false_positive_rate'] * 100:.1f}%")
    if metrics["standard_id_accuracy"] is not None:
        print(f"Standard ID accuracy: {metrics['standard_id_accuracy'] * 100:.1f}%")
    print(f"Average latency: {metrics['average_latency']:.1f}s")
    print(f"Estimated cost: ${metrics['estimated_cost_usd']:.2f}")
    print(f"\nReports written to: {report_path.parent}")


if __name__ == "__main__":
    main()
