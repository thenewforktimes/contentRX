"""Run the held-out manifest against the current engine + compute κ.

Human-eval build plan Session 5. Reads
`evals/held_out/manifest.json`, looks each case up in the gitignored
industry corpus files under `evals/industry/`, executes the pipeline,
and compares the engine verdict against the stored `human_verdict`.
Emits agreement rate + Cohen's κ + a per-case diff report.

Usage:
    python3 tools/run_held_out.py
    python3 tools/run_held_out.py --corpus-dir /path/to/evals/industry
    python3 tools/run_held_out.py --report evals/held_out/last_run.json

Exit code:
    0 — full agreement (or approved regressions, when wired to CI)
    2 — at least one case disagreed (used by the Session 6 CI gate)
    3 — source corpus not available; cannot run the gate

The runner degrades gracefully when the source corpus is missing
(e.g., CI without the private data) so the gate is only ever green
when a real comparison ran. "Silent pass" is not a supported state.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_MANIFEST = Path("evals/held_out/manifest.json")
DEFAULT_CORPUS_DIR = Path("evals/industry")

EXIT_OK = 0
EXIT_DISAGREEMENT = 2
EXIT_CORPUS_MISSING = 3


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_manifest(path: Path) -> dict[str, Any]:
    with open(path) as f:
        return json.load(f)


def load_corpus_index(corpus_dir: Path) -> dict[str, dict[str, dict[str, Any]]]:
    """Build (source_file → case_id → case) from every JSON in corpus_dir.

    Mirrors `tools/select_held_out.py`'s loader including the `auto:`
    case_id synthesis so the manifest's references resolve.
    """
    index: dict[str, dict[str, dict[str, Any]]] = {}
    for path in sorted(corpus_dir.glob("*.json")):
        with open(path) as f:
            data = json.load(f)
        cases = data.get("cases", data) if isinstance(data, dict) else data
        if not isinstance(cases, list):
            continue
        per_file: dict[str, dict[str, Any]] = {}
        for i, case in enumerate(cases, start=1):
            cid = case.get("case_id")
            if cid is None or cid == "":
                cid = f"auto:{path.name}:{i}"
            per_file[str(cid)] = case
        index[path.name] = per_file
    return index


# ---------------------------------------------------------------------------
# Verdict comparison + κ
# ---------------------------------------------------------------------------


def normalize_verdict(v: str | None) -> str | None:
    """Collapse verdict strings to the 2-state pass/fail axis.

    `human_verdict` is always `pass` or `fail` (ternary review_status
    variants live on `review_status`, not here). The engine produces
    `overall_verdict` in {pass, fail, error}. We exclude `error` from
    κ because it's an engine health signal, not a judgment.
    """
    if v is None:
        return None
    if v == "error":
        return None
    if v == "fail":
        return "fail"
    if v == "pass":
        return "pass"
    return None


def cohens_kappa(pairs: list[tuple[str, str]]) -> float | None:
    """Two-rater Cohen's κ on the binary pass/fail axis.

    `pairs` is a list of (human_verdict, engine_verdict) tuples, each
    already normalized. Returns None if there isn't enough data (fewer
    than 2 cases after filtering, or one rater never varies).
    """
    if len(pairs) < 2:
        return None
    n = len(pairs)
    observed = sum(1 for a, b in pairs if a == b) / n
    counts_a = Counter(a for a, _ in pairs)
    counts_b = Counter(b for _, b in pairs)
    labels = set(counts_a) | set(counts_b)
    expected = sum(
        (counts_a.get(lbl, 0) / n) * (counts_b.get(lbl, 0) / n) for lbl in labels
    )
    if expected >= 1.0:
        return None  # perfect marginal agreement; κ undefined
    return (observed - expected) / (1.0 - expected)


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


def _run_engine(case: dict[str, Any]) -> str | None:
    """Invoke the content_checker pipeline on one case.

    Kept in a helper so tests can monkey-patch without importing the
    full engine stack. Returns the normalized 2-state verdict or None
    on engine error.
    """
    # Imported lazily so the runner's --help and manifest-validation
    # path don't pull in the engine (and its optional Anthropic client).
    from content_checker.pipeline import check

    text = case.get("text") or case.get("input") or ""
    content_type = case.get("content_type")
    try:
        result, _latency, _tokens = check(text, content_type=content_type)
    except Exception as exc:
        print(f"  engine error on {case.get('case_id')}: {exc}", file=sys.stderr)
        return None
    return normalize_verdict(result.overall_verdict)


def run(
    manifest: dict[str, Any],
    corpus_index: dict[str, dict[str, dict[str, Any]]],
    *,
    engine_fn=_run_engine,
) -> dict[str, Any]:
    """Execute every manifest entry + compute the agreement report."""
    entries = manifest.get("entries", [])
    disagreements: list[dict[str, Any]] = []
    missing_case: list[dict[str, Any]] = []
    engine_errors: list[dict[str, Any]] = []
    pairs: list[tuple[str, str]] = []

    for entry in entries:
        src = entry.get("source_file") or ""
        cid = str(entry.get("case_id") or "")
        case = corpus_index.get(src, {}).get(cid)
        if case is None:
            missing_case.append(entry)
            continue

        human = normalize_verdict(case.get("human_verdict"))
        engine = engine_fn(case)
        if engine is None:
            engine_errors.append(entry)
            continue
        if human is None:
            missing_case.append(entry)
            continue

        pairs.append((human, engine))
        if human != engine:
            disagreements.append(
                {
                    "case_id": cid,
                    "source_file": src,
                    "standard_id": entry.get("standard_id"),
                    "moment": entry.get("moment"),
                    "human_verdict": human,
                    "engine_verdict": engine,
                }
            )

    kappa = cohens_kappa(pairs)
    return {
        "total_entries": len(entries),
        "evaluated": len(pairs),
        "agreement_rate": (
            sum(1 for a, b in pairs if a == b) / len(pairs) if pairs else None
        ),
        "cohens_kappa": kappa,
        "disagreements": disagreements,
        "missing_case": missing_case,
        "engine_errors": engine_errors,
    }


def format_report(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"Total manifest entries: {report['total_entries']}")
    lines.append(f"Cases evaluated:        {report['evaluated']}")
    if report["evaluated"] == 0:
        lines.append("No cases evaluated — see missing_case + engine_errors.")
    else:
        ar = report["agreement_rate"]
        lines.append(
            f"Agreement rate:         {ar:.1%}" if ar is not None else "Agreement rate:  n/a"
        )
        k = report["cohens_kappa"]
        lines.append(
            f"Cohen's kappa:          {k:.4f}"
            if k is not None and not math.isnan(k)
            else "Cohen's kappa:          n/a (insufficient variance)"
        )
    if report["disagreements"]:
        lines.append("")
        lines.append(f"Disagreements ({len(report['disagreements'])}):")
        for d in report["disagreements"][:20]:
            lines.append(
                f"  {d['source_file']} · {d['case_id']} · "
                f"std={d.get('standard_id')} · moment={d.get('moment')} · "
                f"human={d['human_verdict']} engine={d['engine_verdict']}"
            )
        if len(report["disagreements"]) > 20:
            lines.append(f"  ... and {len(report['disagreements']) - 20} more")
    if report["missing_case"]:
        lines.append("")
        lines.append(
            f"Missing source case or verdict ({len(report['missing_case'])}):"
        )
        for m in report["missing_case"][:10]:
            lines.append(f"  {m.get('source_file')} · {m.get('case_id')}")
    if report["engine_errors"]:
        lines.append("")
        lines.append(f"Engine errors ({len(report['engine_errors'])}):")
        for e in report["engine_errors"][:10]:
            lines.append(f"  {e.get('source_file')} · {e.get('case_id')}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the held-out manifest against the current engine.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Manifest path (default: {DEFAULT_MANIFEST}).",
    )
    parser.add_argument(
        "--corpus-dir",
        type=Path,
        default=DEFAULT_CORPUS_DIR,
        help=f"Industry corpus dir (default: {DEFAULT_CORPUS_DIR}).",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="Optional JSON report path for the CI step to consume.",
    )
    args = parser.parse_args(argv)

    if not args.manifest.exists():
        print(f"ERROR: manifest {args.manifest} not found.", file=sys.stderr)
        return EXIT_CORPUS_MISSING
    if not args.corpus_dir.exists():
        print(
            f"ERROR: corpus dir {args.corpus_dir} not found. "
            "The industry corpus is gitignored — this runner can't green-"
            "pass without it. Either provide --corpus-dir pointing at a "
            "checkout that has the private data, or skip this gate in "
            "environments where the data isn't available.",
            file=sys.stderr,
        )
        return EXIT_CORPUS_MISSING

    manifest = load_manifest(args.manifest)
    corpus = load_corpus_index(args.corpus_dir)
    report = run(manifest, corpus)
    print(format_report(report))

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with open(args.report, "w") as f:
            json.dump(report, f, indent=2)
            f.write("\n")
        print(f"\nWrote report → {args.report}")

    if report["disagreements"]:
        return EXIT_DISAGREEMENT
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
