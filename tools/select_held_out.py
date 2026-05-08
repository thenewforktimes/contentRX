"""Generate the held-out manifest from the industry eval corpus.

Human-eval build plan Session 5. Carves a ~100-case subset from the
annotated industry corpus at `evals/industry/` and writes the manifest
to `evals/held_out/manifest.json`. The source case files stay in place;
the manifest only stores case_ids + selection metadata.

Usage:
    python3 tools/select_held_out.py
    python3 tools/select_held_out.py --target 120 --seed 42
    python3 tools/select_held_out.py --corpus-dir /path/to/evals/industry

The selection is deterministic: same eligible pool + same args always
produce the same manifest. Re-running after the corpus grows picks up
the new cases without churning the existing ones (stable ordering by
case_id).

Selection criteria (in priority order):
    1. Filter: human_confidence == "high" AND review_status in
       {approved, revised}.
    2. Moment coverage: every moment with ≥5 eligible cases gets ≥5
       held-out slots (up to the target budget).
    3. Standard coverage: every standard with ≥3 eligible cases gets
       ≥3 held-out slots.
    4. Source proportionality: remaining slots are filled proportional
       to each source file's share of the eligible pool.

Hard guarantees:
    - No case appears twice in the output manifest.
    - Every selected case comes from the eligible pool.
    - The total selected count equals min(target, eligible pool size).

See evals/held_out/README.md for the retirement rules and the
architectural motivation.
"""

from __future__ import annotations

import argparse
import collections
import datetime as _dt
import json
import sys
from pathlib import Path
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_CORPUS_DIR = Path("evals/industry")
DEFAULT_OUT_PATH = Path("evals/held_out/manifest.json")
DEFAULT_TARGET = 100
DEFAULT_SEED = 7  # Stable tie-breaker — don't change without a version bump.

MIN_PER_MOMENT = 5
MIN_PER_STANDARD = 3
MIN_CASES_TO_COVER_STANDARD = 3  # Only cover standards that have ≥3 in pool.


# ---------------------------------------------------------------------------
# Eligibility + IO
# ---------------------------------------------------------------------------


def load_cases(corpus_dir: Path) -> list[dict[str, Any]]:
    """Read every *.json under corpus_dir and return a flat case list.

    Each returned case is augmented with:
      - `_source_file` — basename of the source file (for traceability)
      - `case_id` synthesized when the source left it null/empty. The
        synthesized form is `auto:<source_file>:<1-based-index>`. A
        portion of eligible cases in some industry-corpus sources
        ship without `case_id`; skipping them would drop entire
        sources from the held-out pool, which breaks the
        generalization story. The `auto:` prefix makes it obvious at
        audit time that the ID is synthetic — the corpus should grow
        real `case_id` values over time.
    """
    all_cases: list[dict[str, Any]] = []
    for path in sorted(corpus_dir.glob("*.json")):
        with open(path) as f:
            data = json.load(f)
        cases = data.get("cases", data) if isinstance(data, dict) else data
        if not isinstance(cases, list):
            continue
        for i, case in enumerate(cases, start=1):
            case["_source_file"] = path.name
            cid = case.get("case_id")
            if cid is None or cid == "":
                case["case_id"] = f"auto:{path.name}:{i}"
            all_cases.append(case)
    return all_cases


def is_eligible(case: dict[str, Any]) -> bool:
    """High-confidence, approved/revised cases only (plan spec)."""
    return (
        case.get("human_confidence") == "high"
        and case.get("review_status") in {"approved", "revised"}
    )


# ---------------------------------------------------------------------------
# Selection algorithm
# ---------------------------------------------------------------------------


def _sort_key(case: dict[str, Any]) -> tuple[str, str]:
    """Deterministic tie-breaker — sort by (source_file, case_id)."""
    return (case.get("_source_file", ""), str(case.get("case_id", "")))


def _pick_for_coverage(
    bucket: Iterable[dict[str, Any]],
    target: int,
    already_selected_ids: set[str],
) -> list[dict[str, Any]]:
    """Pick up to `target` cases from `bucket`, skipping already-selected."""
    picked: list[dict[str, Any]] = []
    for case in sorted(bucket, key=_sort_key):
        if len(picked) >= target:
            break
        cid = str(case.get("case_id", ""))
        if cid in already_selected_ids:
            continue
        picked.append(case)
    return picked


def select_held_out(
    cases: list[dict[str, Any]],
    *,
    target: int = DEFAULT_TARGET,
    min_per_moment: int = MIN_PER_MOMENT,
    min_per_standard: int = MIN_PER_STANDARD,
    min_cases_to_cover_standard: int = MIN_CASES_TO_COVER_STANDARD,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Core selection logic. Returns (selected_cases, stats).

    Pure function — same inputs always produce the same output. The
    stats dict is suitable for embedding into the manifest so future
    re-runs can audit why a given case was included.
    """
    eligible = [c for c in cases if is_eligible(c)]
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    reasons: dict[str, list[str]] = collections.defaultdict(list)

    def _add(case: dict[str, Any], reason: str) -> None:
        cid = str(case.get("case_id", ""))
        if cid in selected_ids:
            if reason not in reasons[cid]:
                reasons[cid].append(reason)
            return
        selected.append(case)
        selected_ids.add(cid)
        reasons[cid].append(reason)

    def _room() -> int:
        return max(0, target - len(selected))

    # --- Pass 1: moment coverage (every moment with ≥min_per_moment
    #             eligible cases gets that many slots, capped at budget). ---
    by_moment: dict[str | None, list[dict[str, Any]]] = collections.defaultdict(list)
    for c in eligible:
        by_moment[c.get("moment")].append(c)
    for moment, bucket in sorted(by_moment.items(), key=lambda kv: (kv[0] is None, kv[0] or "")):
        if moment is None or moment == "":
            continue  # Skip unlabeled moments for the coverage pass.
        if len(bucket) < min_per_moment:
            continue  # Not enough to form a meaningful slice.
        slots = min(min_per_moment, _room())
        if slots == 0:
            break
        picks = _pick_for_coverage(bucket, slots, selected_ids)
        for p in picks:
            _add(p, f"moment_coverage:{moment}")

    # --- Pass 2: standard coverage (also capped at remaining budget). ---
    by_standard: dict[str | None, list[dict[str, Any]]] = collections.defaultdict(list)
    for c in eligible:
        by_standard[c.get("standard_id")].append(c)
    for standard, bucket in sorted(by_standard.items(), key=lambda kv: (kv[0] is None, kv[0] or "")):
        if not standard:
            continue
        if len(bucket) < min_cases_to_cover_standard:
            continue
        slots = min(min_per_standard, _room())
        if slots == 0:
            break
        picks = _pick_for_coverage(bucket, slots, selected_ids)
        for p in picks:
            _add(p, f"standard_coverage:{standard}")

    # --- Pass 3: source proportionality. ---
    # Remaining budget spreads across source files proportional to each
    # file's share of the eligible pool (minus cases already selected).
    remaining = max(0, target - len(selected))
    if remaining > 0:
        by_source: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
        for c in eligible:
            by_source[c.get("_source_file", "unknown")].append(c)
        total_eligible = sum(len(v) for v in by_source.values())
        if total_eligible > 0:
            # Largest-remainder allocation so we hit `remaining` exactly.
            quotas: list[tuple[str, float]] = [
                (src, remaining * len(rows) / total_eligible)
                for src, rows in by_source.items()
            ]
            floors = {src: int(q) for src, q in quotas}
            allocated = sum(floors.values())
            slack = remaining - allocated
            fractional = sorted(
                (((q - int(q)), src) for src, q in quotas),
                reverse=True,
            )
            for _, src in fractional[:slack]:
                floors[src] += 1
            for src, rows in sorted(by_source.items(), key=lambda kv: kv[0]):
                picks = _pick_for_coverage(rows, floors.get(src, 0), selected_ids)
                for p in picks:
                    _add(p, f"source_proportionality:{src}")

    # Some sources may have had fewer leftover cases than their quota —
    # fill the shortfall from any remaining eligible cases in
    # deterministic order so we hit `target` when the pool allows.
    if len(selected) < target:
        picks = _pick_for_coverage(eligible, target - len(selected), selected_ids)
        for p in picks:
            _add(p, "fill_remainder")

    # Cap at target in case coverage passes already exceeded it. Deterministic
    # trim — drop whichever cases land past `target` in source+case_id order.
    if len(selected) > target:
        selected.sort(key=_sort_key)
        selected = selected[:target]
        selected_ids = {str(c.get("case_id", "")) for c in selected}

    # Final deterministic sort for manifest output.
    selected.sort(key=_sort_key)

    stats = {
        "eligible_pool": len(eligible),
        "target": target,
        "selected": len(selected),
        "reasons_per_case": {cid: rs for cid, rs in reasons.items() if cid in selected_ids},
        "moment_distribution": dict(
            collections.Counter(c.get("moment") or "(none)" for c in selected)
        ),
        "standard_distribution": dict(
            collections.Counter(c.get("standard_id") or "(none)" for c in selected)
        ),
        "source_distribution": dict(
            collections.Counter(c.get("_source_file", "unknown") for c in selected)
        ),
    }
    return selected, stats


def build_manifest(
    selected: list[dict[str, Any]],
    stats: dict[str, Any],
    *,
    corpus_dir: Path,
    target: int,
    generated_at: str,
) -> dict[str, Any]:
    """Wrap the selection into a committable manifest shape.

    The manifest intentionally does not duplicate the raw text or
    `human_notes` — those stay in the (gitignored) source corpus. We
    store `case_id` + `_source_file` + the selection metadata needed
    to re-derive the manifest from scratch.
    """
    entries: list[dict[str, Any]] = []
    reasons_per_case = stats.get("reasons_per_case", {})
    for case in selected:
        cid = str(case.get("case_id", ""))
        entries.append(
            {
                "case_id": cid,
                "source_file": case.get("_source_file"),
                "standard_id": case.get("standard_id"),
                "content_type": case.get("content_type"),
                "moment": case.get("moment"),
                "human_verdict": case.get("human_verdict"),
                "human_confidence": case.get("human_confidence"),
                "review_status": case.get("review_status"),
                "triage_category": case.get("category"),
                "selection_reasons": reasons_per_case.get(cid, []),
            }
        )

    return {
        "description": (
            "Held-out golden-set manifest for the industry corpus. "
            "Carved by tools/select_held_out.py from the files under "
            "evals/industry/. The raw cases stay in those files; this "
            "manifest is a reference list used by the CI held-out gate "
            "and the /accuracy page denominator."
        ),
        "schema_version": "1.0.0",
        "generated_at": generated_at,
        "corpus_dir": str(corpus_dir),
        "selection_spec": {
            "target": target,
            "min_per_moment": MIN_PER_MOMENT,
            "min_per_standard": MIN_PER_STANDARD,
            "min_cases_to_cover_standard": MIN_CASES_TO_COVER_STANDARD,
            "eligibility": (
                "human_confidence == 'high' AND "
                "review_status in {'approved','revised'}"
            ),
        },
        "stats": {
            k: v
            for k, v in stats.items()
            if k != "reasons_per_case"  # redundant — lives per-entry
        },
        "entries": entries,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate the held-out manifest from the industry corpus.",
    )
    parser.add_argument(
        "--corpus-dir",
        type=Path,
        default=DEFAULT_CORPUS_DIR,
        help=f"Path to the industry corpus (default: {DEFAULT_CORPUS_DIR}).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT_PATH,
        help=f"Where to write the manifest (default: {DEFAULT_OUT_PATH}).",
    )
    parser.add_argument(
        "--target",
        type=int,
        default=DEFAULT_TARGET,
        help=f"Target number of cases (default: {DEFAULT_TARGET}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute selection + print stats but don't write the manifest.",
    )
    args = parser.parse_args(argv)

    if not args.corpus_dir.exists():
        print(
            f"ERROR: corpus dir {args.corpus_dir} not found. "
            "The industry corpus is gitignored (see .gitignore); run this "
            "from a checkout that has the private data, or pass "
            "--corpus-dir to point at one.",
            file=sys.stderr,
        )
        return 2

    cases = load_cases(args.corpus_dir)
    selected, stats = select_held_out(cases, target=args.target)

    generated_at = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = build_manifest(
        selected,
        stats,
        corpus_dir=args.corpus_dir,
        target=args.target,
        generated_at=generated_at,
    )

    print(f"Eligible pool: {stats['eligible_pool']}")
    print(f"Selected:      {stats['selected']}  (target {stats['target']})")
    print("Moment distribution:")
    for m, n in sorted(stats["moment_distribution"].items()):
        print(f"  {m}: {n}")
    print("Source distribution:")
    for s, n in sorted(stats["source_distribution"].items()):
        print(f"  {s}: {n}")

    if args.dry_run:
        print("(dry-run — manifest not written)")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
