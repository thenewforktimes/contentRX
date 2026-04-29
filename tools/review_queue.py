"""Production override review queue with stage-aware batching.

Human-eval build plan Session 8. Takes a stream of production override
events (from `violation_overrides`) and turns it into an ordered queue
that Robert reviews via the existing Phase 2 CLI (`tools/triage.py`).

The review cadence target is 50 items in 60 minutes. The queue is
organized so related items cluster together — same audience, same
subtype, same moment — so context-switching cost stays low.

Two phase-aware orderings:

  Early phase (<500 high-confidence precedent tuples in the
  auto-annotator cache): exploration-weighted. Novel (standard,
  content_type, verdict) combinations land near the top because each
  labeled case fills a new cell in the precedent index.

  Late phase (≥500 tuples): exploitation-weighted. standards_conflict
  promotes to position 2 because taxonomy bugs are the highest-
  remaining-value failure mode once the precedent index is populated.

The phase switch is automatic — `precedent_tuple_count()` below reads
the auto-annotator cache and the queue reshuffles on each build.

The primary batching dimension — audience — is provisional. Session 8
instruments an automatic re-test at 50 annotated general-audience
cases that recomputes the false-positive concentration against the
naive volume-share baseline. Below the 40% threshold, audience drops
as the outer dimension and the subtype ordering takes over. See
`tools/audience_retest.py`.

Usage:
    python3 tools/review_queue.py build \\
        --overrides production_overrides_2026_w16.json \\
        --out queue_2026_w16.json

    python3 tools/review_queue.py build \\
        --overrides ... --out ... --phase late \\
        --calibration-sample 10
"""

from __future__ import annotations

import argparse
import collections
import datetime as _dt
import json
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# Phase switch + tuple counting
# ---------------------------------------------------------------------------

PHASE_EARLY = "early"
PHASE_LATE = "late"

# 500-tuple threshold derives from a coverage calculation:
# ~47 standards × 4 practical content types × 2 verdicts = 376 plausible
# cells; 500 high-confidence precedents ≈ 1.3× baseline coverage with
# margin for moment-specific variations. See human-eval build plan
# Session 8 spec.
PHASE_SWITCH_TUPLE_COUNT = 500

# Plan-spec minimum precedents to count a tuple as "high confidence".
HIGH_CONFIDENCE_PRECEDENT_MIN = 3

# Cluster-of-3 pattern matches `tools/triage.py`'s existing UX.
BATCH_SIZE = 3

# Calibration sample percentages per phase (plan spec).
EARLY_CALIBRATION_PCT = 5
LATE_CALIBRATION_PCT = 10


def precedent_tuple_count(
    annotated_cases: list[dict[str, Any]],
    *,
    min_precedents: int = HIGH_CONFIDENCE_PRECEDENT_MIN,
) -> int:
    """Count unique (standard_id, content_type, verdict) tuples with
    at least `min_precedents` labeled examples.

    This is the signal that drives the early→late phase switch. Pure
    function — same input always yields the same count.
    """
    counts: collections.Counter[tuple[str, str, str]] = collections.Counter()
    for case in annotated_cases:
        std = case.get("standard_id")
        ct = case.get("content_type")
        verdict = case.get("human_verdict")
        if not std or not ct or not verdict:
            continue
        counts[(std, ct, verdict)] += 1
    return sum(1 for _, n in counts.items() if n >= min_precedents)


def infer_phase(annotated_cases: list[dict[str, Any]]) -> str:
    """Classify the queue into early vs late phase automatically."""
    n = precedent_tuple_count(annotated_cases)
    return PHASE_LATE if n >= PHASE_SWITCH_TUPLE_COUNT else PHASE_EARLY


# ---------------------------------------------------------------------------
# Queue candidate + classification
# ---------------------------------------------------------------------------


@dataclass
class QueueCandidate:
    """One reviewable item on the production override queue.

    `payload` is the original override record so downstream surfaces
    (the CLI UI, the refinement-log writer) can hand the full record
    back to the reviewer.
    """

    case_id: str
    standard_id: str | None
    moment: str | None
    content_type: str | None
    audience: str | None
    review_reason: str | None
    is_standard_pushback: bool = False
    is_novel_combination: bool = False
    created_at: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def sort_key(self) -> tuple[str, str, str]:
        # Deterministic fallback sort within a category. Newest first
        # when timestamps are available so the queue leads with what
        # the reviewer has the most context on.
        return (
            self.created_at or "",
            self.standard_id or "",
            self.case_id,
        )


def _audience_of(candidate: QueueCandidate) -> str:
    """Normalize audience for outer batching. Everything that isn't
    explicitly `general` clusters as `product_ui` — the common case."""
    if candidate.audience == "general":
        return "general"
    return "product_ui"


def mark_novel_combinations(
    candidates: list[QueueCandidate],
    annotated_cases: list[dict[str, Any]],
    *,
    min_precedents: int = HIGH_CONFIDENCE_PRECEDENT_MIN,
) -> None:
    """Set `is_novel_combination` on candidates whose (standard,
    content_type, verdict) tuple has fewer than `min_precedents`
    annotations in the precedent index. Mutates in place.

    "Verdict" here means machine_verdict or expected verdict — the
    dimension the reviewer is calibrating against.
    """
    counts: collections.Counter[tuple[str, str, str]] = collections.Counter()
    for case in annotated_cases:
        std = case.get("standard_id")
        ct = case.get("content_type")
        v = case.get("human_verdict")
        if std and ct and v:
            counts[(std, ct, v)] += 1

    for cand in candidates:
        std = cand.standard_id or ""
        ct = cand.content_type or ""
        verdict = cand.payload.get("machine_verdict") or cand.payload.get("expected")
        if not verdict:
            # Without a verdict axis we can't tell novelty — leave alone.
            continue
        cand.is_novel_combination = counts[(std, ct, verdict)] < min_precedents


# ---------------------------------------------------------------------------
# Stage-aware ordering
# ---------------------------------------------------------------------------

# Category priorities per phase. Lower rank = earlier in the queue.
EARLY_CATEGORY_ORDER = (
    "novel_combination",
    "standards_conflict",
    "ensemble_disagreement",
    "standard_pushback",
    "other",
)
LATE_CATEGORY_ORDER = (
    "standards_conflict",
    "ensemble_disagreement",
    "novel_combination",
    "standard_pushback",
    "other",
)


def _categorize(cand: QueueCandidate) -> str:
    """First-matching category. Order matters — the later categories
    are catch-alls that only fire if none of the earlier labels apply."""
    # standard_pushback aggregates (Session 4): checked first because
    # they represent N overrides collapsed into a single review slot
    # and should stay together regardless of the other dimensions.
    if cand.is_standard_pushback:
        return "standard_pushback"
    rr = cand.review_reason
    if rr == "standards_conflict":
        return "standards_conflict"
    if rr == "ensemble_disagreement":
        return "ensemble_disagreement"
    if cand.is_novel_combination:
        return "novel_combination"
    return "other"


def _category_rank(category: str, phase: str) -> int:
    order = LATE_CATEGORY_ORDER if phase == PHASE_LATE else EARLY_CATEGORY_ORDER
    try:
        return order.index(category)
    except ValueError:
        return len(order)


def order_candidates(
    candidates: list[QueueCandidate],
    phase: str,
    *,
    audience_first: bool = True,
) -> list[QueueCandidate]:
    """Stage-aware ordering.

    When `audience_first` is True (default today), the outer dimension
    is audience — general-audience cases cluster first, then product_ui.
    The re-test at 50 annotated general-audience cases may flip this
    off (see `tools/audience_retest.py`).

    Within an audience, items sort by phase-specific category priority,
    then by standards_conflict/novel relevance, then by moment so the
    reviewer's context stays coherent across adjacent items.
    """
    def key(c: QueueCandidate) -> tuple[Any, ...]:
        cat = _categorize(c)
        return (
            # Audience bucket (only active when audience_first=True)
            _audience_of(c) if audience_first else "",
            _category_rank(cat, phase),
            c.moment or "",
            c.standard_id or "",
            # Stable tie-breaker
            c.created_at or "",
            c.case_id,
        )

    return sorted(candidates, key=key)


def chunk_into_batches(
    ordered: list[QueueCandidate],
    size: int = BATCH_SIZE,
) -> list[list[QueueCandidate]]:
    """Group an ordered queue into size-N batches.

    Batches never cross audience boundaries — when the outer dimension
    flips, the current batch closes even if it's under-sized. This
    matches the reviewer's "one context per batch" mental model.
    """
    batches: list[list[QueueCandidate]] = []
    current: list[QueueCandidate] = []
    current_bucket: str | None = None
    for cand in ordered:
        bucket = _audience_of(cand)
        if current and (bucket != current_bucket or len(current) >= size):
            batches.append(current)
            current = []
        current.append(cand)
        current_bucket = bucket
    if current:
        batches.append(current)
    return batches


# ---------------------------------------------------------------------------
# Calibration sample
# ---------------------------------------------------------------------------


def calibration_sample(
    high_confidence_pool: list[dict[str, Any]],
    *,
    queue_size: int,
    phase: str,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """Random sample of high-confidence verdicts mixed into the queue.

    5% in early phase, 10% in late — the plan's "miscalibration is the
    dominant remaining risk once the index is no longer the bottleneck"
    framing. The sample is seeded so re-builds over the same pool are
    reproducible.
    """
    pct = LATE_CALIBRATION_PCT if phase == PHASE_LATE else EARLY_CALIBRATION_PCT
    target = max(0, (queue_size * pct) // 100)
    if target == 0 or not high_confidence_pool:
        return []
    rng = rng or random.Random(7)
    pool = [c for c in high_confidence_pool if c.get("human_confidence") == "high"]
    if not pool:
        return []
    # Deterministic sample: sort first so seeding determines the pick.
    pool.sort(key=lambda c: str(c.get("case_id", "")))
    return rng.sample(pool, min(target, len(pool)))


# ---------------------------------------------------------------------------
# Adapter: override records → QueueCandidate
# ---------------------------------------------------------------------------


def candidate_from_override(record: dict[str, Any]) -> QueueCandidate:
    """Build a QueueCandidate from a `violation_overrides` row.

    Accepts both the shape emitted by the DB (snake_case) and the
    dashboard's JSON export (also snake_case). Falls back gracefully
    on missing fields.
    """
    rr = record.get("review_reason") or record.get("reviewReason")
    # Session 4: standard_pushback events aren't a row in the table —
    # they're an aggregation over (session_id, standard_id). The queue
    # builder flags them via `_standard_pushback` when the caller pre-
    # computes aggregates.
    is_pushback = bool(record.get("_standard_pushback"))
    return QueueCandidate(
        case_id=str(
            record.get("id")
            or record.get("case_id")
            or record.get("override_id")
            or ""
        ),
        standard_id=record.get("standard_id"),
        moment=record.get("moment"),
        content_type=record.get("content_type"),
        audience=record.get("audience"),
        review_reason=rr,
        is_standard_pushback=is_pushback,
        created_at=record.get("created_at") or record.get("createdAt"),
        payload=record,
    )


def build_queue(
    overrides: list[dict[str, Any]],
    annotated_cases: list[dict[str, Any]],
    *,
    phase: str | None = None,
    audience_first: bool = True,
    calibration_pool: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """End-to-end: overrides + precedent index → ordered batched queue."""
    candidates = [candidate_from_override(o) for o in overrides]
    mark_novel_combinations(candidates, annotated_cases)
    resolved_phase = phase or infer_phase(annotated_cases)
    ordered = order_candidates(
        candidates, resolved_phase, audience_first=audience_first,
    )
    batches = chunk_into_batches(ordered, size=BATCH_SIZE)

    calibration: list[dict[str, Any]] = []
    if calibration_pool:
        calibration = calibration_sample(
            calibration_pool,
            queue_size=len(ordered),
            phase=resolved_phase,
        )

    return {
        "schema_version": "1.0.0",
        "phase": resolved_phase,
        "audience_first": audience_first,
        "precedent_tuple_count": precedent_tuple_count(annotated_cases),
        "candidates": len(candidates),
        "batches": [
            {
                "audience": _audience_of(b[0]) if b else None,
                "size": len(b),
                "entries": [
                    {
                        "case_id": c.case_id,
                        "standard_id": c.standard_id,
                        "moment": c.moment,
                        "content_type": c.content_type,
                        "audience": c.audience,
                        "review_reason": c.review_reason,
                        "category": _categorize(c),
                        "is_novel_combination": c.is_novel_combination,
                        "is_standard_pushback": c.is_standard_pushback,
                        "created_at": c.created_at,
                    }
                    for c in b
                ],
            }
            for b in batches
        ],
        "calibration_sample": [
            {
                "case_id": c.get("case_id"),
                "standard_id": c.get("standard_id"),
                "moment": c.get("moment"),
                "content_type": c.get("content_type"),
                "human_verdict": c.get("human_verdict"),
            }
            for c in calibration
        ],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="Build an ordered queue from overrides.")
    b.add_argument(
        "--overrides", type=Path, required=True,
        help="JSON file: list of override records from violation_overrides.",
    )
    b.add_argument(
        "--annotated-cases", type=Path, default=None,
        help="JSON file: annotated corpus for precedent-index + phase.",
    )
    b.add_argument(
        "--calibration-pool", type=Path, default=None,
        help="JSON file: high-confidence cases to sample for calibration.",
    )
    b.add_argument("--out", type=Path, required=True)
    b.add_argument(
        "--phase",
        choices=[PHASE_EARLY, PHASE_LATE],
        default=None,
        help="Override phase detection (default: auto from precedent index).",
    )
    b.add_argument(
        "--no-audience-first",
        dest="audience_first",
        action="store_false",
        help="Drop audience as the outer dimension (post-retest state).",
    )

    args = parser.parse_args(argv)

    if args.cmd == "build":
        overrides_raw = _load_json(args.overrides)
        overrides = (
            overrides_raw.get("entries", overrides_raw)
            if isinstance(overrides_raw, dict)
            else overrides_raw
        )
        annotated: list[dict[str, Any]] = []
        if args.annotated_cases and args.annotated_cases.exists():
            annotated_raw = _load_json(args.annotated_cases)
            annotated = (
                annotated_raw.get("cases", annotated_raw)
                if isinstance(annotated_raw, dict)
                else annotated_raw
            )
        calibration_pool = annotated
        if args.calibration_pool and args.calibration_pool.exists():
            cal_raw = _load_json(args.calibration_pool)
            calibration_pool = (
                cal_raw.get("cases", cal_raw)
                if isinstance(cal_raw, dict)
                else cal_raw
            )

        queue = build_queue(
            overrides,
            annotated,
            phase=args.phase,
            audience_first=args.audience_first,
            calibration_pool=calibration_pool,
        )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(queue, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(
            f"Phase: {queue['phase']} "
            f"(precedent tuples: {queue['precedent_tuple_count']})"
        )
        print(
            f"Queue: {queue['candidates']} candidates → "
            f"{len(queue['batches'])} batches"
        )
        if queue["calibration_sample"]:
            print(f"Calibration sample: {len(queue['calibration_sample'])} cases")
        print(f"Wrote {args.out}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
