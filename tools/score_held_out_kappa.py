"""Compute κ + 95% CI from the held-out manifest for the public
accuracy snapshot.

Different shape from `tools/run_held_out.py` even though the input
overlaps. `run_held_out.py` is the CI gate (exit 0 / 2 / 3 ; per-case
disagreement listing); this is the calibration data product (one
aggregate κ + 95% CI plus per-standard breakdown), and it never
fails the build.

Why this exists: `evals/graduation/readiness.json` is the long-term
substrate that `reports/accuracy/generate.py` reads to produce
`/accuracy`. The graduation pipeline is incomplete (per-standard κ
values are still null pending more data), so the public snapshot
renders "pending_measurement" on every load-bearing number. This
tool gives the snapshot a measured number TO SHIP based on the
held-out set Robert has already hand-labeled.

Once `tools/graduation_metrics.py` populates readiness.json with
real per-standard κ values, this fallback becomes redundant — the
generator prefers readiness.json over this file. We keep the tool
either way; the held-out aggregate is a useful substrate signal in
its own right (the source-of-truth for "how does the engine score
against Robert's blind labels right now").

Usage:

    python3 tools/score_held_out_kappa.py
    python3 tools/score_held_out_kappa.py --out evals/held_out/kappa.json
    python3 tools/score_held_out_kappa.py --corpus-dir /path/to/evals/industry

Exit codes mirror run_held_out.py:
    0 — wrote the report (regardless of agreement rate; this is data,
        not a gate)
    3 — source corpus or manifest not available; cannot compute

Output schema (1.0.0):

    {
      "schema_version": "1.0.0",
      "generated_at": "2026-05-05T18:00:00Z",
      "manifest_path": "evals/held_out/manifest.json",
      "evaluated": 100,
      "kappa": 0.85,
      "ci_low": 0.78,
      "ci_high": 0.92,
      "observed_agreement": 0.93,
      "by_standard": [
        {"standard_id": "ACC-01", "n": 14, "kappa": 0.82,
         "ci_low": 0.71, "ci_high": 0.93, "observed_agreement": 0.93}
      ]
    }

The `by_standard` rows are informational — useful for /admin and
for refinement-log review — but `reports/accuracy/generate.py`
reads only the aggregate (`kappa` + `ci_low` + `ci_high` +
`evaluated`) when falling back to this file.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Reuse the helpers from run_held_out.py (same loader, same engine
# shim) and drift_check.py (κ + 95% CI math; do not reinvent).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_held_out import (  # noqa: E402
    DEFAULT_CORPUS_DIR,
    DEFAULT_MANIFEST,
    EXIT_CORPUS_MISSING,
    EXIT_OK,
    _run_engine,
    load_corpus_index,
    load_manifest,
    normalize_verdict,
)
from drift_check import cohens_kappa_with_ci  # noqa: E402


SCHEMA_VERSION = "1.0.0"
DEFAULT_OUT = Path("evals/held_out/kappa.json")
MIN_N_FOR_PER_STANDARD = 10


def score(
    manifest: dict[str, Any],
    corpus_index: dict[str, dict[str, dict[str, Any]]],
    *,
    engine_fn=_run_engine,
) -> dict[str, Any]:
    """Run every manifest entry, return the structured kappa report.

    Mirrors `run_held_out.run()` but emits a calibration report
    instead of a CI-gate report. Pure function — `engine_fn` is
    monkey-patchable for tests.
    """
    entries = manifest.get("entries", [])
    pairs: list[tuple[str, str]] = []
    by_standard: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)

    for entry in entries:
        src = entry.get("source_file") or ""
        cid = str(entry.get("case_id") or "")
        case = corpus_index.get(src, {}).get(cid)
        if case is None:
            continue
        human = normalize_verdict(case.get("human_verdict"))
        engine = engine_fn(case)
        if human is None or engine is None:
            continue
        pairs.append((human, engine))
        std = entry.get("standard_id")
        if std:
            by_standard[std].append((human, engine))

    aggregate = cohens_kappa_with_ci(pairs)
    per_standard = []
    for std_id in sorted(by_standard.keys()):
        std_pairs = by_standard[std_id]
        if len(std_pairs) < MIN_N_FOR_PER_STANDARD:
            # Skip standards without enough cases for a stable estimate.
            # The aggregate still includes their pairs; we just don't
            # report a per-standard κ.
            continue
        std_summary = cohens_kappa_with_ci(std_pairs)
        per_standard.append(
            {
                "standard_id": std_id,
                "n": std_summary["n"],
                "kappa": std_summary["kappa"],
                "ci_low": std_summary["ci_low"],
                "ci_high": std_summary["ci_high"],
                "observed_agreement": std_summary["observed_agreement"],
            }
        )

    return {
        "evaluated": aggregate["n"],
        "kappa": aggregate["kappa"],
        "ci_low": aggregate["ci_low"],
        "ci_high": aggregate["ci_high"],
        "observed_agreement": aggregate["observed_agreement"],
        "by_standard": per_standard,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Score the held-out set against the current engine and emit "
            "κ + 95% CI for the public accuracy snapshot."
        ),
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
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output path (default: {DEFAULT_OUT}).",
    )
    args = parser.parse_args(argv)

    if not args.manifest.exists():
        print(f"ERROR: manifest {args.manifest} not found.", file=sys.stderr)
        return EXIT_CORPUS_MISSING
    if not args.corpus_dir.exists():
        print(
            f"ERROR: corpus dir {args.corpus_dir} not found. The industry "
            "corpus is gitignored — this scorer can't run without it.",
            file=sys.stderr,
        )
        return EXIT_CORPUS_MISSING

    manifest = load_manifest(args.manifest)
    corpus = load_corpus_index(args.corpus_dir)
    summary = score(manifest, corpus)

    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "manifest_path": str(args.manifest),
        **summary,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(payload, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {args.out}", file=sys.stderr)

    if summary["kappa"] is not None:
        print(
            f"  evaluated={summary['evaluated']} "
            f"κ={summary['kappa']:.4f} "
            f"95%CI=[{summary['ci_low']:.4f}, {summary['ci_high']:.4f}]",
            file=sys.stderr,
        )

    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
