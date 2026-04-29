"""Batch summary + refinement-log candidate writer (Session 8).

Takes a completed review batch (agree/override/skip actions per case)
and emits:

  1. A human-readable summary line for the reviewer ("you agreed with
     44, overrode 4, skipped 2 — the 4 overrides concentrate on CLR-01
     in error_recovery").
  2. A list of detected patterns that might warrant a refinement-log
     entry (≥3 overrides on the same standard within one batch, a
     sudden content-type cluster, etc.).
  3. Optionally: a drafted candidate entry appended to
     `taxonomy_refinement_log.md` under "## Open refinements" for
     Robert to triage during the weekly cadence.

Usage:
    python3 tools/batch_summary.py analyze \\
        --batch completed_batch.json

    python3 tools/batch_summary.py draft-refinement \\
        --batch completed_batch.json --id REF-004 \\
        --log taxonomy_refinement_log.md

The batch file is the output of a triage.py run over a review-queue
batch: each entry carries the original case fields plus the reviewer's
`action` (agree|override|skip) and optional `reviewer_note`.
"""

from __future__ import annotations

import argparse
import collections
import datetime as _dt
import json
import sys
from pathlib import Path
from typing import Any


ACTION_AGREE = "agree"
ACTION_OVERRIDE = "override"
ACTION_SKIP = "skip"

# Plan spec: "the 4 overrides suggest standard 17 may be too strict on
# error states — open refinement-log entry?" — a cluster of 3+ overrides
# on the same standard inside a single batch is the default trigger.
REFINEMENT_OVERRIDE_THRESHOLD = 3


# ---------------------------------------------------------------------------
# Core analysis
# ---------------------------------------------------------------------------


def summarize_batch(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Walk a completed batch and tally reviewer actions + patterns."""
    agree = override = skip = 0
    override_by_standard: collections.Counter[str] = collections.Counter()
    override_by_moment: collections.Counter[str] = collections.Counter()
    override_by_content_type: collections.Counter[str] = collections.Counter()
    override_details: list[dict[str, Any]] = []

    for entry in entries:
        action = (entry.get("action") or "").lower()
        if action == ACTION_AGREE:
            agree += 1
            continue
        if action == ACTION_SKIP:
            skip += 1
            continue
        if action == ACTION_OVERRIDE:
            override += 1
            std = entry.get("standard_id") or "(none)"
            moment = entry.get("moment") or "(none)"
            ct = entry.get("content_type") or "(none)"
            override_by_standard[std] += 1
            override_by_moment[moment] += 1
            override_by_content_type[ct] += 1
            override_details.append(
                {
                    "case_id": entry.get("case_id"),
                    "standard_id": std,
                    "moment": moment,
                    "content_type": ct,
                    "reviewer_note": entry.get("reviewer_note"),
                }
            )

    patterns: list[dict[str, Any]] = []
    for std, count in override_by_standard.items():
        if count >= REFINEMENT_OVERRIDE_THRESHOLD:
            # Find the moment / content_type the overrides concentrate in.
            moments_for_std = collections.Counter(
                d["moment"] for d in override_details if d["standard_id"] == std
            )
            cts_for_std = collections.Counter(
                d["content_type"] for d in override_details if d["standard_id"] == std
            )
            patterns.append(
                {
                    "kind": "recurring_standard_override",
                    "standard_id": std,
                    "count": count,
                    "dominant_moment": moments_for_std.most_common(1)[0][0]
                    if moments_for_std
                    else None,
                    "dominant_content_type": cts_for_std.most_common(1)[0][0]
                    if cts_for_std
                    else None,
                    "case_ids": [
                        d["case_id"] for d in override_details if d["standard_id"] == std
                    ],
                }
            )

    total = agree + override + skip
    summary_line = (
        f"Reviewed {total}: agreed {agree}, overrode {override}, skipped {skip}."
    )
    if patterns:
        p = patterns[0]
        summary_line += (
            f" Pattern: {p['count']} overrides on {p['standard_id']}"
            f"{' in ' + p['dominant_moment'] if p['dominant_moment'] else ''}"
            f" — may warrant a refinement-log entry."
        )

    return {
        "total": total,
        "agree": agree,
        "override": override,
        "skip": skip,
        "override_by_standard": dict(override_by_standard),
        "override_by_moment": dict(override_by_moment),
        "override_by_content_type": dict(override_by_content_type),
        "patterns": patterns,
        "summary_line": summary_line,
    }


# ---------------------------------------------------------------------------
# Refinement-log candidate writer
# ---------------------------------------------------------------------------


def render_refinement_candidate(
    pattern: dict[str, Any],
    *,
    ref_id: str,
    batch_label: str | None = None,
    today: _dt.date | None = None,
) -> str:
    """Format a pattern as an 'Open refinements' entry in the log.

    Matches the existing format in `taxonomy_refinement_log.md`:
    heading → Current category → Proposed split/change → Triggering
    case → Architectural consequence → Date → Verdict.
    """
    today = today or _dt.date.today()
    std = pattern["standard_id"]
    count = pattern["count"]
    moment = pattern.get("dominant_moment")
    ct = pattern.get("dominant_content_type")
    case_ids = pattern.get("case_ids", [])

    scope = ""
    if moment and moment != "(none)":
        scope += f" in `{moment}`"
    if ct and ct != "(none)":
        scope += f" on `{ct}`"

    batch_line = f" (batch: {batch_label})" if batch_label else ""

    triggering = ", ".join(f"`{cid}`" for cid in case_ids[:5])
    if len(case_ids) > 5:
        triggering += f", +{len(case_ids) - 5} more"

    return (
        f"### {ref_id}: recurring override on `{std}`{scope}\n\n"
        f"**Current category:** `{std}` — {count} overrides in a single "
        f"review batch{batch_line}.\n\n"
        f"**Triggering cases:** {triggering}.\n\n"
        f"**Note:** Cluster of overrides suggests the standard may be too "
        f"strict or mis-scoped for this context. Before filing an approved "
        f"refinement, confirm the pattern holds across independent sources "
        f"(two-source rule).\n\n"
        f"**Architectural consequence:** Under review. If confirmed, "
        f"candidate actions include: moment-weight adjustment "
        f"(emphasize/relax/suppress), content_type_notes carve-out, or "
        f"standard-text revision.\n\n"
        f"**Date logged:** {today.strftime('%Y-%m-%d')}\n\n"
        f"**Verdict:** Pending — auto-detected from Session 8 review "
        f"queue; awaits two-source confirmation before approval.\n"
    )


def append_to_log(log_path: Path, entry_text: str) -> None:
    """Append a new entry under the `## Open refinements` heading.

    Preserves ordering — new entries land at the bottom of Open
    refinements, above Approved/Declined sections.
    """
    with open(log_path) as f:
        content = f.read()

    marker = "## Open refinements"
    approved_marker = "## Approved refinements"
    if marker not in content:
        raise ValueError(f"Log missing '## Open refinements' section: {log_path}")

    idx = content.find(approved_marker)
    if idx < 0:
        # No Approved section yet — append at end of Open section.
        new_content = content.rstrip() + "\n\n\n" + entry_text.rstrip() + "\n"
    else:
        head = content[:idx].rstrip()
        tail = content[idx:]
        new_content = head + "\n\n\n" + entry_text.rstrip() + "\n\n\n" + tail

    with open(log_path, "w") as f:
        f.write(new_content)


def suggest_next_ref_id(log_path: Path) -> str:
    """Find the highest existing REF-NNN and suggest the next."""
    try:
        with open(log_path) as f:
            content = f.read()
    except FileNotFoundError:
        return "REF-001"
    import re
    ids = re.findall(r"REF-(\d+)", content)
    nums = sorted({int(x) for x in ids})
    if not nums:
        return "REF-001"
    return f"REF-{nums[-1] + 1:03d}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)


def _extract_entries(blob: Any) -> list[dict[str, Any]]:
    if isinstance(blob, list):
        return blob
    if isinstance(blob, dict):
        if "entries" in blob:
            return blob["entries"]
        if "batches" in blob:
            flat: list[dict[str, Any]] = []
            for b in blob["batches"]:
                flat.extend(b.get("entries", []))
            return flat
    return []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Batch summary + refinement-log writer.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("analyze", help="Summarize a completed batch.")
    a.add_argument("--batch", type=Path, required=True)
    a.add_argument("--out", type=Path, default=None)

    d = sub.add_parser("draft-refinement", help="Append a candidate to the log.")
    d.add_argument("--batch", type=Path, required=True)
    d.add_argument(
        "--log", type=Path,
        default=Path("_private/taxonomy_refinement_log.md"),
    )
    d.add_argument(
        "--id", default=None,
        help="REF-ID to use. Defaults to next available (REF-NNN).",
    )
    d.add_argument("--batch-label", default=None)

    args = parser.parse_args(argv)

    if args.cmd == "analyze":
        entries = _extract_entries(_load_json(args.batch))
        report = summarize_batch(entries)
        print(report["summary_line"])
        if report["patterns"]:
            print("Patterns:")
            for p in report["patterns"]:
                print(f"  {p['kind']}: {p['standard_id']} × {p['count']}")
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            with open(args.out, "w") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
                f.write("\n")
            print(f"Wrote {args.out}")
        return 0

    if args.cmd == "draft-refinement":
        entries = _extract_entries(_load_json(args.batch))
        report = summarize_batch(entries)
        if not report["patterns"]:
            print("No patterns detected — nothing to draft.")
            return 0
        ref_id = args.id or suggest_next_ref_id(args.log)
        # Draft one candidate per detected pattern.
        for i, pattern in enumerate(report["patterns"]):
            this_id = ref_id if i == 0 else suggest_next_ref_id(args.log)
            entry = render_refinement_candidate(
                pattern,
                ref_id=this_id,
                batch_label=args.batch_label,
            )
            append_to_log(args.log, entry)
            print(f"Appended {this_id}: {pattern['standard_id']} × {pattern['count']}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
