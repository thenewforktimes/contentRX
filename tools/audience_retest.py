"""Audience re-test trigger — Session 8 instrumentation.

The queue ordering's outer dimension is `audience`, applied as a
provisional hypothesis. An early eval on a small panel (12 cases)
showed five of five preprocessor violations in general-audience
content were false positives — but at that sample size the 95% CI
is wide. Session 8 formalizes a re-test:

  At 50 annotated general-audience cases, recompute the false-positive
  concentration. Keep audience as the outer dimension only if
  concentration exceeds 40% of false positives; otherwise drop
  audience and let the review-reason subtypes drive batching directly.

This tool counts annotated general-audience cases across the corpus
and, once the trigger fires, emits a clear keep-or-drop decision
output. Run it before each `review_queue.py build` — its decision
flips `--no-audience-first` on when the hypothesis is rejected.

Usage:
    python3 tools/audience_retest.py --corpus-dir evals/industry
    python3 tools/audience_retest.py --corpus-dir ... --json
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path
from typing import Any


# Plan-spec trigger + threshold.
TRIGGER_ANNOTATED_COUNT = 50
KEEP_IF_CONCENTRATION_ABOVE = 0.40  # Keep audience-first if >40% FPs.


def _is_annotated(case: dict[str, Any]) -> bool:
    return (
        case.get("human_verdict") in ("pass", "fail")
        and case.get("human_confidence") is not None
    )


def _is_general_audience(case: dict[str, Any]) -> bool:
    """Detect general-audience cases in the corpus.

    Cases carry audience either as `audience: "general"` (explicit) or,
    for older captures, as `domain: "marketing"` with
    `source_org` pointing at a marketing site. We only trust the
    explicit `audience` tag — inference is fragile and would bias the
    re-test.
    """
    return case.get("audience") == "general"


def _is_false_positive(case: dict[str, Any]) -> bool:
    """A false positive is: machine said `fail`, human said `pass`."""
    mv = case.get("machine_verdict")
    hv = case.get("human_verdict")
    return mv == "fail" and hv == "pass"


def compute_retest(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Walk the corpus, compute FP concentration, emit the decision."""
    annotated = [c for c in cases if _is_annotated(c)]
    general = [c for c in annotated if _is_general_audience(c)]

    annotated_general_count = len(general)
    trigger_met = annotated_general_count >= TRIGGER_ANNOTATED_COUNT

    total_fps = [c for c in annotated if _is_false_positive(c)]
    general_fps = [c for c in general if _is_false_positive(c)]

    # Baseline: if general-audience FPs are just proportional to the
    # general-audience share of annotated cases, audience adds no
    # signal. Concentration ratio = P(general | FP) / P(general | ann).
    concentration = None
    if total_fps and annotated:
        p_general_given_fp = len(general_fps) / len(total_fps)
        p_general_baseline = len(general) / len(annotated)
        concentration = p_general_given_fp
        excess = p_general_given_fp - p_general_baseline
    else:
        excess = None

    if not trigger_met:
        decision = "pending"
        reason = (
            f"Trigger not met: {annotated_general_count}/"
            f"{TRIGGER_ANNOTATED_COUNT} annotated general-audience cases."
        )
    elif concentration is None:
        decision = "inconclusive"
        reason = (
            f"Trigger met ({annotated_general_count} annotated), but no "
            "false positives available to compute concentration."
        )
    elif concentration >= KEEP_IF_CONCENTRATION_ABOVE:
        decision = "keep_audience_first"
        reason = (
            f"P(general | FP) = {concentration:.2%} ≥ threshold "
            f"{KEEP_IF_CONCENTRATION_ABOVE:.0%}. Audience-first batching "
            "stays; the hypothesis holds."
        )
    else:
        decision = "drop_audience_first"
        reason = (
            f"P(general | FP) = {concentration:.2%} < threshold "
            f"{KEEP_IF_CONCENTRATION_ABOVE:.0%}. Audience-first batching "
            "should drop; let subtypes drive queue order directly."
        )

    return {
        "trigger_met": trigger_met,
        "annotated_general_count": annotated_general_count,
        "trigger_count_required": TRIGGER_ANNOTATED_COUNT,
        "total_annotated": len(annotated),
        "total_false_positives": len(total_fps),
        "general_false_positives": len(general_fps),
        "general_audience_concentration_in_fps": concentration,
        "baseline_share_of_general_in_annotated": (
            len(general) / len(annotated) if annotated else None
        ),
        "excess_over_baseline": excess,
        "keep_threshold": KEEP_IF_CONCENTRATION_ABOVE,
        "decision": decision,
        "reason": reason,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def load_cases(corpus_dir: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for path in sorted(corpus_dir.glob("*.json")):
        with open(path) as f:
            data = json.load(f)
        c = data.get("cases", data) if isinstance(data, dict) else data
        if isinstance(c, list):
            cases.extend(c)
    return cases


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corpus-dir",
        type=Path,
        default=Path("evals/industry"),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON only (for the queue builder).",
    )
    args = parser.parse_args(argv)

    if not args.corpus_dir.exists():
        print(
            f"ERROR: corpus {args.corpus_dir} not found. "
            "Run from a checkout that has the private corpus, or "
            "pass --corpus-dir.",
            file=sys.stderr,
        )
        return 2

    cases = load_cases(args.corpus_dir)
    result = compute_retest(cases)

    if args.json:
        print(json.dumps(result, indent=2))
        return 0

    print(
        f"Annotated general-audience cases: "
        f"{result['annotated_general_count']} / "
        f"{result['trigger_count_required']}"
    )
    if result["general_audience_concentration_in_fps"] is not None:
        print(
            f"P(general | FP) = "
            f"{result['general_audience_concentration_in_fps']:.2%} "
            f"(baseline "
            f"{result['baseline_share_of_general_in_annotated']:.2%})"
        )
    print(f"Decision: {result['decision']}")
    print(f"Reason:   {result['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
