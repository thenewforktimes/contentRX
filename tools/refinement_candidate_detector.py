"""Nightly detector for auto-proposed refinement-log candidates.

Human-eval build plan Session 34. Reads an aggregated signal dump
(produced by the admin endpoint or a manual export) and proposes
candidate entries for the taxonomy refinement log so Robo can triage
during the weekly review rhythm.

Three candidate families:

1. Retirement — standards firing rarely (≤0.5% over 90 days),
   standards with high production override rate (>30% over 30 days),
   and standards subsumed by a more recent standard (no unique fires
   in 30 days).

2. Refinement — recurring override patterns on a single standard
   that can't be fixed by a content_type_notes tweak, and
   standards_conflict clusters (Session 2 subtype) repeating across
   sources.

3. Moment / content-type — out_of_distribution clusters (Session 2
   subtype) that have accumulated ≥5 cases in 60 days from ≥2
   distinct sources. The two-source minimum matches the existing
   refinement-log discipline: one source is not enough evidence even
   when the pattern is visually striking (button_cta precedent).

Output is markdown written to the `## Proposed refinements
(auto-detected)` section of `taxonomy_refinement_log.md`. Each entry
uses the existing format: current category, proposed split / change,
triggering cases, architectural consequence, verdict `pending`.

Design notes:

- Pure-logic module: `propose_candidates(signals)` in → list of
  `Candidate` dataclasses out. Exhaustively unit-testable, no DB or
  network access.
- The markdown writer is a separate layer. It's idempotent: running
  twice with the same signals produces the same log content. Existing
  auto-detected entries are diffed by `ref_id` so the detector
  doesn't duplicate.
- A `--dry-run` mode prints the proposed markdown to stdout without
  touching the log.

CLI:

    python3 tools/refinement_candidate_detector.py --signals signals.json --log taxonomy_refinement_log.md
    python3 tools/refinement_candidate_detector.py --signals signals.json --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# Canonical thresholds. Pinned in the plan spec — do not relax without
# a refinement-log entry proposing the change.
RETIREMENT_FIRE_RATE_MAX = 0.005  # 0.5% over the 90-day window
RETIREMENT_FIRE_WINDOW_DAYS = 90
OVERRIDE_RATE_MAX = 0.30  # 30% over the 30-day window
OVERRIDE_WINDOW_DAYS = 30
SUBSUMPTION_WINDOW_DAYS = 30

OOD_CASE_COUNT_MIN = 5
OOD_WINDOW_DAYS = 60
OOD_SOURCE_COUNT_MIN = 2

# Auto-detected entries use a separate numeric space so they can't
# collide with Robo-proposed REF-NNN entries. The REF-A prefix signals
# "auto" at a glance.
AUTO_REF_PREFIX = "REF-A"


# ---------------------------------------------------------------------------
# Input signal types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StandardSignal:
    """Aggregate signal for a single standard over the scan window."""

    standard_id: str
    # 90-day fire counts.
    fires_90d: int
    total_evaluations_90d: int
    # 30-day override + fire counts (for override-rate computation).
    fires_30d: int
    overrides_30d: int
    # IDs of standards that ALSO fired on the same evaluations this
    # one fired on, in the 30-day window. Populated by the signal
    # exporter; used for subsumption detection.
    co_firing_standards_30d: dict[str, int] = field(default_factory=dict)
    # Number of this standard's fires in the 30-day window that
    # were NOT co-fired by any other standard. If this is zero and
    # co-firing is consistently with a newer standard, we propose
    # subsumption.
    unique_fires_30d: int = 0


@dataclass(frozen=True)
class OverrideCluster:
    """A repeated (standard_id, override_reason_code) override cluster."""

    standard_id: str
    reason_code: str
    count_30d: int
    distinct_actors: int
    sample_text_hashes: tuple[str, ...] = ()


@dataclass(frozen=True)
class OODCluster:
    """An out_of_distribution cluster accumulated over the window."""

    moment: str | None
    content_type: str | None
    case_count_60d: int
    distinct_sources: int
    sample_text_hashes: tuple[str, ...] = ()
    # Sample triage notes if the review-queue surface captured them.
    representative_note: str | None = None


@dataclass(frozen=True)
class ConflictCluster:
    """A recurring standards_conflict between two or more standards."""

    standard_ids: tuple[str, ...]
    count_30d: int
    distinct_sources: int


@dataclass(frozen=True)
class SignalDump:
    """The full nightly signal export — input to the detector."""

    generated_at: str  # ISO 8601
    standards: list[StandardSignal]
    override_clusters: list[OverrideCluster]
    ood_clusters: list[OODCluster]
    conflict_clusters: list[ConflictCluster]
    # If this standard was introduced more recently (and its appearance
    # in the co-firing list should be read as "newer"), record its
    # creation date here. Keys are standard_ids.
    standard_first_seen: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Candidate output types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    """A single proposed refinement-log entry."""

    ref_id: str  # "REF-A001" etc.
    kind: str  # "retirement" | "refinement" | "moment_content_type"
    title: str
    current_category: str
    proposed_change: str
    triggering_cases: str
    architectural_consequence: str
    date_logged: str  # YYYY-MM-DD


# ---------------------------------------------------------------------------
# Pure detection logic
# ---------------------------------------------------------------------------


def propose_candidates(
    signals: SignalDump,
    *,
    starting_index: int = 1,
    today: str | None = None,
) -> list[Candidate]:
    """Turn a signal dump into a sorted list of candidate entries.

    `starting_index` is the first integer used in the `REF-A###` id.
    Callers that want to append to an existing log should pass the
    next-unused number so new candidates don't collide with the prior
    run. `today` is overridable for deterministic tests.
    """
    today_str = today or datetime.now(timezone.utc).date().isoformat()
    out: list[Candidate] = []
    index = starting_index

    # Retirement candidates (three sub-families).
    for std in signals.standards:
        # Rare-fires.
        if std.total_evaluations_90d > 0:
            fire_rate = std.fires_90d / std.total_evaluations_90d
            if fire_rate <= RETIREMENT_FIRE_RATE_MAX:
                out.append(
                    Candidate(
                        ref_id=_format_ref_id(index),
                        kind="retirement",
                        title=f"{std.standard_id} — rare-fire retirement candidate",
                        current_category=std.standard_id,
                        proposed_change=(
                            f"Retire {std.standard_id}. Fired on "
                            f"{std.fires_90d} of {std.total_evaluations_90d} "
                            f"evaluations ({fire_rate:.2%}) over the last "
                            f"{RETIREMENT_FIRE_WINDOW_DAYS} days — below the "
                            f"{RETIREMENT_FIRE_RATE_MAX:.1%} threshold for "
                            "continued inclusion."
                        ),
                        triggering_cases=(
                            f"Auto-detected on {today_str} from the nightly "
                            "signal dump."
                        ),
                        architectural_consequence=(
                            f"Removal from `standards_library.json` + filter "
                            f"routing. If the rule is genuinely rare, the "
                            "engine saves LLM tokens per scan. If instead "
                            "the rule is rare because the auto-annotator "
                            "isn't surfacing candidate cases, treat this "
                            "as a signal to grow the precedent index, not "
                            "to retire the standard."
                        ),
                        date_logged=today_str,
                    )
                )
                index += 1

        # High-override-rate.
        if std.fires_30d >= 10:  # Floor to avoid noise from rare standards.
            override_rate = std.overrides_30d / std.fires_30d
            if override_rate > OVERRIDE_RATE_MAX:
                out.append(
                    Candidate(
                        ref_id=_format_ref_id(index),
                        kind="retirement",
                        title=f"{std.standard_id} — override-rate retirement candidate",
                        current_category=std.standard_id,
                        proposed_change=(
                            f"Retire or retune {std.standard_id}. "
                            f"{std.overrides_30d} of {std.fires_30d} fires "
                            f"({override_rate:.1%}) in the last "
                            f"{OVERRIDE_WINDOW_DAYS} days were overridden — "
                            f"above the {OVERRIDE_RATE_MAX:.0%} threshold."
                        ),
                        triggering_cases=(
                            f"Auto-detected on {today_str} from production "
                            "override stream."
                        ),
                        architectural_consequence=(
                            "If overrides cluster under a single reason "
                            "code, consider narrowing the standard with a "
                            "`content_type_notes` clause before retirement. "
                            "If overrides span all reason codes, retirement "
                            "is likely the right call."
                        ),
                        date_logged=today_str,
                    )
                )
                index += 1

        # Subsumption: unique_fires_30d == 0 AND co-firing with a
        # newer standard is the dominant pattern.
        if std.fires_30d >= 10 and std.unique_fires_30d == 0 and std.co_firing_standards_30d:
            newer_co_firers = [
                sid
                for sid in std.co_firing_standards_30d
                if _is_newer(sid, std.standard_id, signals.standard_first_seen)
            ]
            if newer_co_firers:
                co_firer = max(
                    newer_co_firers,
                    key=lambda sid: std.co_firing_standards_30d.get(sid, 0),
                )
                out.append(
                    Candidate(
                        ref_id=_format_ref_id(index),
                        kind="retirement",
                        title=f"{std.standard_id} — subsumed by {co_firer}",
                        current_category=std.standard_id,
                        proposed_change=(
                            f"Retire {std.standard_id}. In the last "
                            f"{SUBSUMPTION_WINDOW_DAYS} days it produced "
                            "no unique fires — every case it caught was "
                            f"also caught by {co_firer}, a more recent "
                            "standard."
                        ),
                        triggering_cases=(
                            f"Auto-detected on {today_str}. Co-firing "
                            "counts: "
                            + ", ".join(
                                f"{sid}×{count}"
                                for sid, count in sorted(
                                    std.co_firing_standards_30d.items(),
                                    key=lambda kv: -kv[1],
                                )[:3]
                            )
                            + "."
                        ),
                        architectural_consequence=(
                            "Confirm the newer standard covers the intent of "
                            f"{std.standard_id} exactly; if so, retire and "
                            "redirect any `relevant_content_types` references."
                        ),
                        date_logged=today_str,
                    )
                )
                index += 1

    # Refinement candidates — repeated override patterns.
    for cluster in signals.override_clusters:
        if cluster.count_30d >= 10 and cluster.distinct_actors >= 3:
            out.append(
                Candidate(
                    ref_id=_format_ref_id(index),
                    kind="refinement",
                    title=(
                        f"{cluster.standard_id} — recurring "
                        f"`{cluster.reason_code}` overrides"
                    ),
                    current_category=cluster.standard_id,
                    proposed_change=(
                        "Refine or narrow the standard. "
                        f"{cluster.count_30d} overrides from "
                        f"{cluster.distinct_actors} distinct actors over "
                        f"{OVERRIDE_WINDOW_DAYS} days all cite "
                        f"`{cluster.reason_code}`."
                    ),
                    triggering_cases=(
                        f"Auto-detected on {today_str}. "
                        + _format_sample_list(cluster.sample_text_hashes, "text_hash")
                    ),
                    architectural_consequence=(
                        "If the reason_code is `not_applicable_here`, "
                        "consider adding a `content_type_notes` carve-out "
                        "for the dominant content_type. If it's "
                        "`standard_too_strict`, evaluate narrowing the "
                        "rule text or introducing a moment-specific relax."
                    ),
                    date_logged=today_str,
                )
            )
            index += 1

    # Refinement candidates — standards_conflict clusters.
    for cluster in signals.conflict_clusters:
        if cluster.count_30d >= 5 and cluster.distinct_sources >= 2:
            id_list = " + ".join(cluster.standard_ids)
            out.append(
                Candidate(
                    ref_id=_format_ref_id(index),
                    kind="refinement",
                    title=f"{id_list} — recurring standards_conflict",
                    current_category=id_list,
                    proposed_change=(
                        "Reconcile the overlap. "
                        f"{cluster.count_30d} standards_conflict events "
                        f"across {cluster.distinct_sources} sources in "
                        f"{OVERRIDE_WINDOW_DAYS} days involve these "
                        "standards together."
                    ),
                    triggering_cases=(
                        f"Auto-detected on {today_str} from the "
                        "review-queue subtype stream (Session 2's "
                        "`standards_conflict`)."
                    ),
                    architectural_consequence=(
                        "Either merge the standards, adjust "
                        "`related_standards` so precedence is explicit, "
                        "or split one of them into a moment-specific "
                        "variant."
                    ),
                    date_logged=today_str,
                )
            )
            index += 1

    # Moment / content-type candidates — out_of_distribution clusters.
    for cluster in signals.ood_clusters:
        if (
            cluster.case_count_60d >= OOD_CASE_COUNT_MIN
            and cluster.distinct_sources >= OOD_SOURCE_COUNT_MIN
        ):
            axis = _describe_ood_axis(cluster)
            out.append(
                Candidate(
                    ref_id=_format_ref_id(index),
                    kind="moment_content_type",
                    title=f"{axis} — out_of_distribution cluster",
                    current_category=axis,
                    proposed_change=(
                        f"Evaluate {axis} as a candidate refinement. "
                        f"{cluster.case_count_60d} out_of_distribution "
                        f"cases accumulated across "
                        f"{cluster.distinct_sources} sources in "
                        f"{OOD_WINDOW_DAYS} days."
                    ),
                    triggering_cases=(
                        f"Auto-detected on {today_str}. "
                        + _format_sample_list(
                            cluster.sample_text_hashes, "text_hash"
                        )
                        + (
                            f"\n\nRepresentative note: {cluster.representative_note}"
                            if cluster.representative_note
                            else ""
                        )
                    ),
                    architectural_consequence=(
                        "If the split produces a verdict-changing "
                        "difference on the held-out golden set, approve. "
                        "Otherwise decline per the refinement-log "
                        "decision criterion (one-source-only evidence is "
                        "not sufficient — this auto-detection clears the "
                        "two-source minimum, but the verdict-impact test "
                        "still applies)."
                    ),
                    date_logged=today_str,
                )
            )
            index += 1

    out.sort(key=lambda c: c.ref_id)
    return out


def _is_newer(
    candidate_sid: str,
    subject_sid: str,
    first_seen: dict[str, str],
) -> bool:
    cand = first_seen.get(candidate_sid)
    subj = first_seen.get(subject_sid)
    if not cand or not subj:
        return False
    return cand > subj


def _format_ref_id(index: int) -> str:
    return f"{AUTO_REF_PREFIX}{index:03d}"


def _format_sample_list(hashes: Iterable[str], label: str) -> str:
    """Render up to three truncated hash samples as a short prose line.

    `label` is the singular noun ("text_hash", "case_id"); the plural
    is formed by appending "es" to anything ending in "h" and "s"
    otherwise — good enough for the labels we use.
    """
    h = list(hashes)
    if not h:
        return ""
    shown = [x[:10] for x in h[:3]]
    suffix = f" (+{len(h) - 3} more)" if len(h) > 3 else ""
    plural = f"{label}es" if label.endswith("h") else f"{label}s"
    return f"Sample {plural}: {', '.join(shown)}{suffix}."


def _describe_ood_axis(cluster: OODCluster) -> str:
    if cluster.moment and cluster.content_type:
        return f"{cluster.moment} × {cluster.content_type}"
    if cluster.moment:
        return cluster.moment
    if cluster.content_type:
        return cluster.content_type
    return "(unclassified)"


# ---------------------------------------------------------------------------
# Log-file IO
# ---------------------------------------------------------------------------

AUTO_SECTION_HEADER = "## Proposed refinements (auto-detected)"


def render_markdown(candidates: list[Candidate]) -> str:
    """Render a list of candidates as markdown entries under the
    auto-detected section header.
    """
    if not candidates:
        return (
            f"{AUTO_SECTION_HEADER}\n"
            "\n"
            "(No auto-detected candidates at the last run.)\n"
        )

    body = [AUTO_SECTION_HEADER, ""]
    for c in candidates:
        body.append(f"### {c.ref_id}: {c.title}")
        body.append("")
        body.append(f"**Current category:** `{c.current_category}`")
        body.append("")
        body.append(f"**Proposed change:** {c.proposed_change}")
        body.append("")
        body.append(f"**Triggering cases:** {c.triggering_cases}")
        body.append("")
        body.append(f"**Architectural consequence:** {c.architectural_consequence}")
        body.append("")
        body.append(f"**Date logged:** {c.date_logged}")
        body.append("")
        body.append("**Verdict:** Pending — Robo triages during the weekly review rhythm.")
        body.append("")
    return "\n".join(body) + "\n"


def splice_auto_section(log_text: str, new_section: str) -> str:
    """Replace (or insert) the `## Proposed refinements (auto-detected)`
    section inside the refinement log.

    Placement rule: the auto-detected section lives BEFORE
    `## Approved refinements` so triaging is natural — Robo reviews
    pending candidates first, then promotes approved ones.

    Whitespace invariant: the section body always ends with exactly
    two newlines before the next `## ` header (one blank line in the
    rendered markdown). First-run insertion and subsequent replaces
    produce byte-identical output — the nightly workflow depends on
    that idempotency to no-op when signals haven't changed.
    """
    # Canonical form: strip trailing whitespace from the new section,
    # then append exactly `\n\n` so the block is separated from the
    # following header by one blank line.
    canonical_section = new_section.rstrip() + "\n\n"

    if AUTO_SECTION_HEADER in log_text:
        # Replace existing block. Lookahead requires a newline before
        # `## ` so `###` (three hashes) inside the block's own entries
        # doesn't falsely terminate the match.
        pattern = re.compile(
            re.escape(AUTO_SECTION_HEADER)
            + r".*?(?=\n##\s|\Z)",
            re.DOTALL,
        )
        # Trim any trailing newline from the substitution so the
        # existing `\n` before the next `## ` stays in place — the
        # lookahead left it unconsumed.
        return pattern.sub(canonical_section.rstrip() + "\n", log_text, count=1)

    # First-run insertion: place it immediately above
    # `## Approved refinements` (if present) or at the end of the file.
    approved_match = re.search(r"^##\s+Approved refinements\b", log_text, re.MULTILINE)
    if approved_match:
        insert_at = approved_match.start()
        return log_text[:insert_at] + canonical_section + log_text[insert_at:]

    return log_text.rstrip() + "\n\n" + canonical_section


def load_signals(path: Path) -> SignalDump:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return SignalDump(
        generated_at=raw.get("generated_at", ""),
        standards=[StandardSignal(**s) for s in raw.get("standards", [])],
        override_clusters=[
            OverrideCluster(**{
                **c,
                "sample_text_hashes": tuple(c.get("sample_text_hashes", [])),
            })
            for c in raw.get("override_clusters", [])
        ],
        ood_clusters=[
            OODCluster(**{
                **c,
                "sample_text_hashes": tuple(c.get("sample_text_hashes", [])),
            })
            for c in raw.get("ood_clusters", [])
        ],
        conflict_clusters=[
            ConflictCluster(**{
                **c,
                "standard_ids": tuple(c.get("standard_ids", [])),
            })
            for c in raw.get("conflict_clusters", [])
        ],
        standard_first_seen=raw.get("standard_first_seen", {}),
    )


def next_available_auto_index(log_text: str) -> int:
    """Find the next integer to assign to a `REF-ANNN` id so runs don't
    re-use numbers. If no existing auto entries are found, start at 1.
    """
    ids = re.findall(
        rf"^###\s+{re.escape(AUTO_REF_PREFIX)}(\d+)\b",
        log_text,
        re.MULTILINE,
    )
    if not ids:
        return 1
    return max(int(i) for i in ids) + 1


def existing_auto_id_by_title(log_text: str) -> dict[str, str]:
    """Parse existing `### REF-ANNN: <title>` headers out of the log.

    Returns title → id. Used so nightly runs with unchanged signals
    preserve ids — the PR diff ends up empty and the workflow no-ops
    via `peter-evans/create-pull-request`'s built-in "no changes →
    no PR" behavior.
    """
    pattern = re.compile(
        rf"^###\s+({re.escape(AUTO_REF_PREFIX)}\d+)\s*:\s*(.+?)\s*$",
        re.MULTILINE,
    )
    out: dict[str, str] = {}
    for match in pattern.finditer(log_text):
        ref_id, title = match.group(1), match.group(2)
        out[title] = ref_id
    return out


def reconcile_ref_ids(
    candidates: list[Candidate],
    existing_log: str,
) -> list[Candidate]:
    """Reuse prior-run ids for candidates whose titles match existing
    auto-detected entries. New candidates get fresh ids starting at
    `max(existing) + 1`.

    The reason we match on title (not on a content hash) is that the
    title already carries the semantic key — standard_id +
    reason_code for refinement, moment × content_type for OOD — and
    keeping the key in the title means reviewers can eyeball
    stability at a glance. When the title changes, the candidate is
    semantically different and deserves a new id.
    """
    existing = existing_auto_id_by_title(existing_log)
    next_num = next_available_auto_index(existing_log)

    reconciled: list[Candidate] = []
    for cand in candidates:
        if cand.title in existing:
            ref_id = existing[cand.title]
        else:
            ref_id = _format_ref_id(next_num)
            next_num += 1
        reconciled.append(
            Candidate(
                ref_id=ref_id,
                kind=cand.kind,
                title=cand.title,
                current_category=cand.current_category,
                proposed_change=cand.proposed_change,
                triggering_cases=cand.triggering_cases,
                architectural_consequence=cand.architectural_consequence,
                date_logged=cand.date_logged,
            )
        )
    reconciled.sort(key=lambda c: c.ref_id)
    return reconciled


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--signals",
        type=Path,
        required=True,
        help="Path to the JSON signal dump produced by the admin endpoint.",
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=Path("taxonomy_refinement_log.md"),
        help="Path to the refinement log to update.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the would-be section to stdout; do not touch the log.",
    )
    args = parser.parse_args()

    signals = load_signals(args.signals)
    existing_log = args.log.read_text(encoding="utf-8") if args.log.exists() else ""

    # Two-pass id assignment: first pass allocates fresh ids from 1 so
    # the detector's output is deterministic without the log. Second
    # pass reconciles against the committed log so unchanged signals
    # don't churn the ids nightly.
    raw_candidates = propose_candidates(signals, starting_index=1)
    candidates = reconcile_ref_ids(raw_candidates, existing_log)
    section = render_markdown(candidates)

    if args.dry_run:
        print(section)
        return 0

    updated = splice_auto_section(existing_log, section)
    args.log.write_text(updated, encoding="utf-8")
    print(
        f"wrote {len(candidates)} candidate(s) to {args.log} "
        f"(starting ref index {starting}).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())


__all__: list[str] = [
    "AUTO_REF_PREFIX",
    "AUTO_SECTION_HEADER",
    "Candidate",
    "ConflictCluster",
    "OODCluster",
    "OOD_CASE_COUNT_MIN",
    "OOD_SOURCE_COUNT_MIN",
    "OOD_WINDOW_DAYS",
    "OVERRIDE_RATE_MAX",
    "OVERRIDE_WINDOW_DAYS",
    "OverrideCluster",
    "RETIREMENT_FIRE_RATE_MAX",
    "RETIREMENT_FIRE_WINDOW_DAYS",
    "SignalDump",
    "StandardSignal",
    "existing_auto_id_by_title",
    "load_signals",
    "next_available_auto_index",
    "propose_candidates",
    "reconcile_ref_ids",
    "render_markdown",
    "splice_auto_section",
]

_: Any = None  # quiet Any-import for type-checkers
