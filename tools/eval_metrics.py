#!/usr/bin/env python3
"""Eval corpus metrics — Tier 1 analysis.

Reads all eval corpus files and produces a markdown report with:
    1. Agreement rate by standard ID (which standards are most contentious)
    2. Override direction by standard (over-flag vs under-flag)
    3. Per-corpus summary with patch yield signal
    4. Coverage gaps (standards and moments with sparse eval data)

Run from project root:
    python3 tools/eval_metrics.py

Output to file:
    python3 tools/eval_metrics.py > evals/results/metrics_report.md

Architecture note:
    This is a development-time analysis tool, not a production dependency.
    It consumes the eval corpus files in evals/industry/ and produces a
    read-only report. It does not modify any files.

    The script handles both migrated (machine_verdict populated) and
    un-migrated (machine_verdict null, falls back to expected) corpus
    files. Run migrate_eval_schema.py first for cleanest results.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_all_corpora(evals_dir: Path) -> list[dict]:
    """Load all eval corpus files and return a flat list of cases.

    Each case gets an injected _source_file field for per-corpus grouping.
    Handles both migrated and un-migrated schemas. Cases that lack both
    verdict fields (machine_verdict and expected) are skipped — they can't
    contribute to agreement metrics.
    """
    all_cases = []
    skipped = 0
    corpus_files = sorted(evals_dir.glob("*_eval_cases.json"))

    for filepath in corpus_files:
        with open(filepath) as f:
            data = json.load(f)

        cases = data.get("cases", [])
        metadata = data.get("metadata", {})

        for case in cases:
            # Normalize: use machine_verdict if populated, fall back to expected
            if case.get("machine_verdict") is None:
                case["machine_verdict"] = case.get("expected")

            # Skip cases that have no usable verdict pair
            mv = case.get("machine_verdict")
            hv = case.get("human_verdict")
            if mv is None or hv is None:
                skipped += 1
                continue

            case["_source_file"] = filepath.name
            case["_source_org"] = case.get("source_org", metadata.get("source_org", filepath.stem))
            all_cases.append(case)

    if skipped > 0:
        print(f"Note: {skipped} cases skipped (missing machine_verdict "
              f"or human_verdict). Run migrate_eval_schema.py first.",
              file=sys.stderr)

    return all_cases


# ---------------------------------------------------------------------------
# Metric computations
# ---------------------------------------------------------------------------

def compute_agreement_by_standard(cases: list[dict]) -> list[dict]:
    """Compute agreement rate per standard ID.

    Returns list of dicts sorted by disagreement count (most contentious first).
    """
    stats: dict[str, dict] = defaultdict(lambda: {
        "agree": 0, "disagree": 0,
        "machine_fail_human_pass": 0,  # false positive (over-flag)
        "machine_pass_human_fail": 0,  # false negative (under-flag)
        "total": 0,
        "sources": set(),
    })

    for case in cases:
        mv = case.get("machine_verdict")
        hv = case.get("human_verdict")
        std = case.get("standard_id") or "unknown"

        if mv is None or hv is None:
            continue

        s = stats[std]
        s["total"] += 1
        s["sources"].add(case.get("_source_org", "?"))

        if mv == hv:
            s["agree"] += 1
        else:
            s["disagree"] += 1
            if mv == "fail" and hv == "pass":
                s["machine_fail_human_pass"] += 1
            elif mv == "pass" and hv == "fail":
                s["machine_pass_human_fail"] += 1

    results = []
    for std_id, s in stats.items():
        rate = s["agree"] / s["total"] * 100 if s["total"] > 0 else 0
        results.append({
            "standard_id": std_id,
            "total": s["total"],
            "agree": s["agree"],
            "disagree": s["disagree"],
            "agreement_rate": round(rate, 1),
            "over_flag": s["machine_fail_human_pass"],
            "under_flag": s["machine_pass_human_fail"],
            "direction": _direction_label(s["machine_fail_human_pass"],
                                          s["machine_pass_human_fail"]),
            "sources": len(s["sources"]),
        })

    # Sort: most disagreements first, then by standard ID for stability
    results.sort(key=lambda r: (-r["disagree"], r["standard_id"] or ""))
    return results


def _direction_label(over: int, under: int) -> str:
    """Human-readable label for override direction."""
    if over == 0 and under == 0:
        return "—"
    if over > 0 and under == 0:
        return "over-flags"
    if under > 0 and over == 0:
        return "under-flags"
    return "mixed"


def compute_corpus_summary(cases: list[dict]) -> list[dict]:
    """Compute per-corpus summary metrics."""
    corpora: dict[str, dict] = defaultdict(lambda: {
        "total": 0, "agree": 0, "disagree": 0,
        "over_flag": 0, "under_flag": 0,
        "org": "",
        "standards_seen": set(),
        "moments_seen": set(),
    })

    for case in cases:
        source = case.get("_source_file", "unknown")
        mv = case.get("machine_verdict")
        hv = case.get("human_verdict")

        if mv is None or hv is None:
            continue

        c = corpora[source]
        c["total"] += 1
        c["org"] = case.get("_source_org", "?")
        c["standards_seen"].add(case.get("standard_id") or "unknown")
        moment = case.get("moment")
        if moment:
            c["moments_seen"].add(moment)

        if mv == hv:
            c["agree"] += 1
        else:
            c["disagree"] += 1
            if mv == "fail" and hv == "pass":
                c["over_flag"] += 1
            elif mv == "pass" and hv == "fail":
                c["under_flag"] += 1

    results = []
    for source, c in sorted(corpora.items()):
        rate = c["agree"] / c["total"] * 100 if c["total"] > 0 else 0
        results.append({
            "file": source,
            "org": c["org"],
            "total": c["total"],
            "agree": c["agree"],
            "disagree": c["disagree"],
            "agreement_rate": round(rate, 1),
            "over_flag": c["over_flag"],
            "under_flag": c["under_flag"],
            "standards_coverage": len(c["standards_seen"]),
            "moments_coverage": len(c["moments_seen"]),
        })

    return results


def compute_coverage_gaps(
    cases: list[dict],
    all_standards: list[str] | None = None,
) -> dict:
    """Identify standards and moments with sparse eval coverage.

    Returns dict with sparse_standards (< 5 cases) and moment_distribution.
    """
    std_counts: dict[str, int] = defaultdict(int)
    moment_counts: dict[str, int] = defaultdict(int)

    for case in cases:
        std = case.get("standard_id")
        if std:
            std_counts[std] += 1
        moment = case.get("moment")
        if moment:
            moment_counts[moment] += 1

    sparse = {sid: count for sid, count in std_counts.items() if count < 5}
    well_covered = {sid: count for sid, count in std_counts.items() if count >= 5}

    return {
        "standard_counts": dict(sorted(std_counts.items(),
                                        key=lambda x: -x[1])),
        "sparse_standards": dict(sorted(sparse.items(),
                                         key=lambda x: x[1])),
        "well_covered_standards": dict(sorted(well_covered.items(),
                                               key=lambda x: -x[1])),
        "moment_counts": dict(sorted(moment_counts.items(),
                                      key=lambda x: -x[1])),
    }


def compute_patch_yield(corpus_summaries: list[dict]) -> list[dict]:
    """Compute patch yield signal per corpus.

    Patch yield = disagreements that became patches / total cases.
    Since we can't determine exact patch counts from the corpus alone,
    we report override counts as the upper bound on patchable findings.
    The actual patches are fewer (some overrides cluster into the same fix).
    """
    results = []
    for c in corpus_summaries:
        yield_pct = (c["disagree"] / c["total"] * 100
                     if c["total"] > 0 else 0)
        results.append({
            "org": c["org"],
            "total": c["total"],
            "overrides": c["disagree"],
            "yield_pct": round(yield_pct, 1),
        })
    return results


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def generate_report(
    cases: list[dict],
    evals_dir: Path,
) -> str:
    """Generate a full Tier 1 metrics report as markdown."""
    lines = []
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    std_metrics = compute_agreement_by_standard(cases)
    corpus_metrics = compute_corpus_summary(cases)
    coverage = compute_coverage_gaps(cases)
    yield_metrics = compute_patch_yield(corpus_metrics)

    total_cases = len([c for c in cases
                       if c.get("machine_verdict") and c.get("human_verdict")])
    total_agree = sum(c["agree"] for c in corpus_metrics)
    total_disagree = sum(c["disagree"] for c in corpus_metrics)
    overall_rate = (total_agree / total_cases * 100
                    if total_cases > 0 else 0)

    lines.append(f"# Eval metrics report")
    lines.append(f"")
    lines.append(f"Generated: {now}")
    lines.append(f"Corpora: {len(corpus_metrics)} files, "
                 f"{total_cases} cases, "
                 f"{round(overall_rate, 1)}% overall agreement")
    lines.append(f"")

    # --- Section 1: Agreement by standard ---
    lines.append(f"## 1. Agreement by standard")
    lines.append(f"")
    lines.append(f"Sorted by disagreement count (most contentious first). "
                 f"Standards with 0 disagreements omitted for brevity.")
    lines.append(f"")
    lines.append(f"| Standard | Cases | Agree | Disagree | Rate | "
                 f"Over-flag | Under-flag | Direction | Sources |")
    lines.append(f"|---|---|---|---|---|---|---|---|---|")

    for s in std_metrics:
        if s["disagree"] > 0:
            lines.append(
                f"| {s['standard_id']} | {s['total']} | {s['agree']} | "
                f"{s['disagree']} | {s['agreement_rate']}% | "
                f"{s['over_flag']} | {s['under_flag']} | "
                f"{s['direction']} | {s['sources']} |"
            )

    lines.append(f"")

    # Standards with perfect agreement
    perfect = [s for s in std_metrics if s["disagree"] == 0]
    if perfect:
        perfect_ids = ", ".join(s["standard_id"] for s in perfect)
        lines.append(f"**Perfect agreement ({len(perfect)} standards):** "
                     f"{perfect_ids}")
        lines.append(f"")

    # --- Section 2: Override direction summary ---
    total_over = sum(s["over_flag"] for s in std_metrics)
    total_under = sum(s["under_flag"] for s in std_metrics)
    lines.append(f"## 2. Override direction")
    lines.append(f"")
    lines.append(f"Total overrides: {total_disagree} "
                 f"({total_over} over-flag, {total_under} under-flag)")
    lines.append(f"")
    if total_over > 0 and total_under > 0:
        ratio = total_over / total_under
        lines.append(f"Over-flag to under-flag ratio: "
                     f"{ratio:.1f}:1")
    elif total_over > 0:
        lines.append(f"All overrides are over-flags (machine too conservative). "
                     f"This is the correct failure mode for a flag-cite-suggest tool.")
    lines.append(f"")

    # --- Section 3: Per-corpus summary ---
    lines.append(f"## 3. Per-corpus summary")
    lines.append(f"")
    lines.append(f"| Corpus | Org | Cases | Agreement | Over-flag | "
                 f"Under-flag | Standards | Moments |")
    lines.append(f"|---|---|---|---|---|---|---|---|")

    for c in corpus_metrics:
        lines.append(
            f"| {c['file']} | {c['org']} | {c['total']} | "
            f"{c['agreement_rate']}% | {c['over_flag']} | "
            f"{c['under_flag']} | {c['standards_coverage']} | "
            f"{c['moments_coverage']} |"
        )

    lines.append(f"")

    # --- Section 4: Patch yield ---
    lines.append(f"## 4. Patch yield signal")
    lines.append(f"")
    lines.append(f"Override rate per corpus (upper bound on patchable findings).")
    lines.append(f"Declining yield across sessions = calibration converging.")
    lines.append(f"")
    lines.append(f"| Corpus | Cases | Overrides | Yield |")
    lines.append(f"|---|---|---|---|")

    for y in yield_metrics:
        lines.append(
            f"| {y['org']} | {y['total']} | {y['overrides']} | "
            f"{y['yield_pct']}% |"
        )

    lines.append(f"")

    # --- Section 5: Coverage gaps ---
    lines.append(f"## 5. Coverage")
    lines.append(f"")

    lines.append(f"### Standards with most eval coverage")
    lines.append(f"")
    top_covered = list(coverage["well_covered_standards"].items())[:15]
    if top_covered:
        lines.append(f"| Standard | Cases |")
        lines.append(f"|---|---|")
        for sid, count in top_covered:
            lines.append(f"| {sid} | {count} |")
        lines.append(f"")

    lines.append(f"### Standards with sparse coverage (< 5 cases)")
    lines.append(f"")
    sparse = coverage["sparse_standards"]
    if sparse:
        lines.append(f"These standards need more eval cases before their "
                     f"agreement rates are meaningful.")
        lines.append(f"")
        lines.append(f"| Standard | Cases |")
        lines.append(f"|---|---|")
        for sid, count in sparse.items():
            lines.append(f"| {sid} | {count} |")
        lines.append(f"")
    else:
        lines.append(f"All evaluated standards have ≥ 5 cases.")
        lines.append(f"")

    # Standards not evaluated at all
    evaluated_stds = set(coverage["standard_counts"].keys())
    # Can't check against full library without loading it, so just report count
    lines.append(f"**Total standards evaluated:** {len(evaluated_stds)}")
    lines.append(f"")

    lines.append(f"### Moment distribution")
    lines.append(f"")
    moments = coverage["moment_counts"]
    if moments:
        lines.append(f"| Moment | Cases |")
        lines.append(f"|---|---|")
        for moment, count in moments.items():
            lines.append(f"| {moment} | {count} |")
        lines.append(f"")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    evals_dir = Path("evals/industry")
    if not evals_dir.exists():
        print(f"Error: {evals_dir} not found. Run from project root.",
              file=sys.stderr)
        sys.exit(1)

    corpus_files = sorted(evals_dir.glob("*_eval_cases.json"))
    if not corpus_files:
        print(f"No eval corpus files found in {evals_dir}",
              file=sys.stderr)
        sys.exit(1)

    cases = load_all_corpora(evals_dir)
    report = generate_report(cases, evals_dir)
    print(report)


if __name__ == "__main__":
    main()
