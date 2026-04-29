#!/usr/bin/env python3
"""Interactive triage CLI for ContentRX scan exports.

Walks through exported scan results one case at a time, collecting
structured human judgments: verdict override, confidence, notes, and
a triage category that feeds the architectural roadmap.

Zero dependencies beyond Python 3.9+ stdlib. Imports nothing from
the content_checker package — this tool works on any machine with
a JSON export file.

Usage:
    python3 tools/triage.py triage/opendoor_2026-03-29.json
    python3 tools/triage.py triage/opendoor_2026-03-29.json --unreviewed
    python3 tools/triage.py triage/opendoor_2026-03-29.json --jump SCAN-2026-03-29-042
    python3 tools/triage.py triage/opendoor_2026-03-29.json --summary

Architecture:
    The tool is split into four layers that never cross boundaries:
    1. Data    — load, save, validate, atomic writes
    2. Display — terminal formatting, case rendering, colors
    3. Input   — keyboard prompts, shortcut handling, validation
    4. Flow    — review state machine, navigation, summary

    Each layer is a group of pure functions (display) or thin classes
    (data). The flow layer orchestrates them. No globals, no singletons,
    no mutable module state.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ═══════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════

# Valid values for human triage fields. These are the contract between
# the triage tool and downstream consumers (eval promotion, roadmap
# clustering, architecture analysis).

VERDICTS = ("pass", "fail")

CONFIDENCE_LEVELS = ("high", "medium", "low")

# Each category maps to a specific architectural response:
#   correct           → no action needed, machine got it right
#   misclassification → content type classifier needs work
#   hallucination     → LLM invented a violation that doesn't exist
#   missing_standard  → the standards library has a gap
#   context_gap       → the tool lacks context it needs (audience, data display, etc.)
TRIAGE_CATEGORIES = (
    "correct",
    "misclassification",
    "hallucination",
    "missing_standard",
    "context_gap",
)

# ANSI color codes for terminal output. The tool degrades gracefully
# when piped to a file or run in a terminal without color support.
_COLOR_SUPPORTED = hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


# ═══════════════════════════════════════════════════════════════════════
# Layer 1: Display — terminal formatting, case rendering, colors
# ═══════════════════════════════════════════════════════════════════════

class _Colors:
    """ANSI escape codes, disabled when stdout isn't a terminal."""

    RESET = "\033[0m" if _COLOR_SUPPORTED else ""
    BOLD = "\033[1m" if _COLOR_SUPPORTED else ""
    DIM = "\033[2m" if _COLOR_SUPPORTED else ""

    RED = "\033[31m" if _COLOR_SUPPORTED else ""
    GREEN = "\033[32m" if _COLOR_SUPPORTED else ""
    YELLOW = "\033[33m" if _COLOR_SUPPORTED else ""
    BLUE = "\033[34m" if _COLOR_SUPPORTED else ""
    MAGENTA = "\033[35m" if _COLOR_SUPPORTED else ""
    CYAN = "\033[36m" if _COLOR_SUPPORTED else ""
    WHITE = "\033[37m" if _COLOR_SUPPORTED else ""

    BG_RED = "\033[41m" if _COLOR_SUPPORTED else ""
    BG_GREEN = "\033[42m" if _COLOR_SUPPORTED else ""


C = _Colors()


def _hr(char: str = "─", width: int = 72) -> str:
    """Horizontal rule for visual separation between cases."""
    return C.DIM + (char * width) + C.RESET


def _verdict_badge(verdict: str) -> str:
    """Colored badge for pass/fail verdicts."""
    if verdict == "fail":
        return f"{C.BG_RED}{C.WHITE}{C.BOLD} FAIL {C.RESET}"
    return f"{C.BG_GREEN}{C.WHITE}{C.BOLD} PASS {C.RESET}"


def _category_color(category: str) -> str:
    """Color a triage category for visual scanning."""
    color_map = {
        "correct": C.GREEN,
        "misclassification": C.YELLOW,
        "hallucination": C.RED,
        "missing_standard": C.MAGENTA,
        "context_gap": C.CYAN,
    }
    color = color_map.get(category, "")
    return f"{color}{category}{C.RESET}"


def render_case(case: dict, index: int, total: int) -> str:
    """Format a single case for terminal display.

    Shows all machine-generated fields so the reviewer has full context.
    If the case has already been reviewed, shows the existing human
    judgments in a distinct color so the reviewer can see what they
    previously decided.
    """
    lines: list[str] = []

    # Header: case position and ID
    lines.append(_hr("═"))
    lines.append(
        f"{C.BOLD}Case {index + 1}/{total}{C.RESET}"
        f"  {C.DIM}{case.get('case_id', 'unknown')}{C.RESET}"
    )
    lines.append(_hr())

    # The text being evaluated — the most important field
    text = case.get("input", case.get("text", ""))
    lines.append(f"{C.BOLD}Text:{C.RESET}  {text}")
    lines.append("")

    # Machine classification metadata
    content_type = case.get("content_type", "unknown")
    moment = case.get("moment")
    parent = case.get("parent_frame")
    node = case.get("node_name")

    meta_parts = [f"type: {C.CYAN}{content_type}{C.RESET}"]
    if moment:
        meta_parts.append(f"moment: {C.MAGENTA}{moment}{C.RESET}")
    if parent:
        meta_parts.append(f"frame: {C.DIM}{parent}{C.RESET}")
    if node:
        meta_parts.append(f"node: {C.DIM}{node}{C.RESET}")
    lines.append("  ".join(meta_parts))

    # Machine verdict
    machine_verdict = case.get("machine_verdict", "unknown")
    lines.append(f"Machine verdict: {_verdict_badge(machine_verdict)}")
    lines.append("")

    # Violations (if any)
    violations = case.get("violations", [])
    if violations:
        lines.append(f"{C.BOLD}Violations ({len(violations)}):{C.RESET}")
        for v in violations:
            std_id = v.get("standard_id", "???")
            label = v.get("display_label", "")
            issue = v.get("issue", "")
            suggestion = v.get("suggestion", "")
            source = v.get("source", "")

            label_display = f" ({label})" if label else ""
            source_display = f" [{source}]" if source else ""

            lines.append(
                f"  {C.YELLOW}{std_id}{label_display}{C.RESET}"
                f"{C.DIM}{source_display}{C.RESET}"
            )
            if issue:
                lines.append(f"    Issue: {issue}")
            if suggestion:
                lines.append(f"    Fix:   {C.GREEN}{suggestion}{C.RESET}")
        lines.append("")
    else:
        lines.append(f"{C.DIM}No violations.{C.RESET}")
        lines.append("")

    # Summary (if present)
    summary = case.get("summary")
    if summary:
        lines.append(f"{C.DIM}Summary: {summary}{C.RESET}")
        lines.append("")

    # Previous human review (if resuming)
    if case.get("human_verdict") is not None:
        lines.append(f"{C.BLUE}{C.BOLD}── Previous review ──{C.RESET}")
        lines.append(
            f"  Verdict:    {_verdict_badge(case['human_verdict'])}"
            f"  Confidence: {case.get('human_confidence', '?')}"
        )
        if case.get("triage_category"):
            lines.append(
                f"  Category:   {_category_color(case['triage_category'])}"
            )
        if case.get("human_notes"):
            lines.append(f"  Notes:      {case['human_notes']}")
        reviewed_at = case.get("reviewed_at")
        if reviewed_at:
            lines.append(f"  {C.DIM}Reviewed: {reviewed_at}{C.RESET}")
        lines.append("")

    return "\n".join(lines)


def render_summary(cases: list[dict]) -> str:
    """Summary dashboard showing triage category distribution and
    agreement rates. This is the first thing you look at to understand
    where the tool is failing and what to fix next."""
    lines: list[str] = []

    reviewed = [c for c in cases if c.get("human_verdict") is not None]
    unreviewed = len(cases) - len(reviewed)

    lines.append("")
    lines.append(_hr("═"))
    lines.append(f"{C.BOLD}Triage summary{C.RESET}")
    lines.append(_hr())

    # Progress
    lines.append(
        f"Total cases: {len(cases)}  |  "
        f"Reviewed: {C.GREEN}{len(reviewed)}{C.RESET}  |  "
        f"Remaining: {C.YELLOW}{unreviewed}{C.RESET}"
    )
    lines.append("")

    if not reviewed:
        lines.append(f"{C.DIM}No cases reviewed yet.{C.RESET}")
        return "\n".join(lines)

    # Agreement rate: how often the human agreed with the machine
    agreements = sum(
        1 for c in reviewed
        if c.get("human_verdict") == c.get("machine_verdict")
    )
    agreement_pct = (agreements / len(reviewed)) * 100 if reviewed else 0
    lines.append(
        f"Human–machine agreement: {C.BOLD}{agreement_pct:.1f}%{C.RESET}"
        f"  ({agreements}/{len(reviewed)})"
    )
    lines.append("")

    # Category distribution — this is the roadmap signal
    lines.append(f"{C.BOLD}Category distribution:{C.RESET}")
    category_counts: dict[str, int] = {}
    for c in reviewed:
        cat = c.get("triage_category", "uncategorized")
        category_counts[cat] = category_counts.get(cat, 0) + 1

    # Sort by count descending for quick visual scanning
    for cat, count in sorted(
        category_counts.items(), key=lambda x: -x[1]
    ):
        bar_width = int((count / len(reviewed)) * 40)
        bar = "█" * bar_width
        pct = (count / len(reviewed)) * 100
        lines.append(
            f"  {_category_color(cat):>30s}  "
            f"{C.DIM}{bar}{C.RESET}  {count} ({pct:.0f}%)"
        )
    lines.append("")

    # Confidence distribution
    lines.append(f"{C.BOLD}Confidence distribution:{C.RESET}")
    conf_counts: dict[str, int] = {}
    for c in reviewed:
        conf = c.get("human_confidence", "unset")
        conf_counts[conf] = conf_counts.get(conf, 0) + 1
    for conf in ("high", "medium", "low", "unset"):
        count = conf_counts.get(conf, 0)
        if count > 0:
            pct = (count / len(reviewed)) * 100
            lines.append(f"  {conf:>10s}: {count} ({pct:.0f}%)")
    lines.append("")

    # Disagreement breakdown: cases where human overrode machine
    overrides = [
        c for c in reviewed
        if c.get("human_verdict") != c.get("machine_verdict")
    ]
    if overrides:
        lines.append(
            f"{C.BOLD}Verdict overrides ({len(overrides)}):{C.RESET}"
        )
        # Group by direction: machine said fail but human said pass, or vice versa
        false_positives = [
            c for c in overrides if c.get("machine_verdict") == "fail"
        ]
        false_negatives = [
            c for c in overrides if c.get("machine_verdict") == "pass"
        ]
        if false_positives:
            lines.append(
                f"  Machine FAIL → Human PASS (false positives): "
                f"{C.YELLOW}{len(false_positives)}{C.RESET}"
            )
        if false_negatives:
            lines.append(
                f"  Machine PASS → Human FAIL (false negatives): "
                f"{C.RED}{len(false_negatives)}{C.RESET}"
            )
        lines.append("")

    lines.append(_hr("═"))
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════
# Layer 2: Data — load, save, validate, atomic writes
# ═══════════════════════════════════════════════════════════════════════

def load_triage_file(path: Path) -> dict[str, Any]:
    """Load and validate a triage export JSON file.

    Validates the basic structure (must have a 'cases' array) but is
    tolerant of schema variations — older exports might be missing
    fields that newer ones have.
    """
    if not path.exists():
        print(f"{C.RED}Error: file not found: {path}{C.RESET}")
        sys.exit(1)

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"{C.RED}Error: invalid JSON in {path}: {e}{C.RESET}")
        sys.exit(1)

    if not isinstance(data, dict) or "cases" not in data:
        print(
            f"{C.RED}Error: expected a JSON object with a 'cases' array. "
            f"Got: {type(data).__name__}{C.RESET}"
        )
        sys.exit(1)

    cases = data["cases"]
    if not isinstance(cases, list):
        print(f"{C.RED}Error: 'cases' must be an array.{C.RESET}")
        sys.exit(1)

    # Ensure every case has the four human triage fields (null if unset)
    for case in cases:
        case.setdefault("human_verdict", None)
        case.setdefault("human_confidence", None)
        case.setdefault("human_notes", None)
        case.setdefault("triage_category", None)
        case.setdefault("reviewed_at", None)

    return data


def save_triage_file(data: dict[str, Any], path: Path) -> None:
    """Atomic save: write to a temp file in the same directory, then
    rename. This guarantees the file is never in a half-written state,
    even if the process is killed mid-write.

    The rename is atomic on POSIX systems. On Windows it's close enough
    for a CLI tool (Python's os.replace is as atomic as the OS allows).
    """
    # Write to a temp file in the same directory so rename works
    # (rename across filesystem boundaries would fail)
    dir_path = path.parent
    dir_path.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(
        dir=dir_path, prefix=".triage_", suffix=".json.tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")  # trailing newline for POSIX compliance
        os.replace(tmp_path, path)
    except BaseException:
        # Clean up the temp file on any failure, including KeyboardInterrupt
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def update_triage_metadata(data: dict[str, Any]) -> None:
    """Update the file-level metadata to reflect the current triage state.

    This metadata block lets downstream tools (eval promotion, roadmap
    generation) quickly assess triage completeness without scanning
    every case.
    """
    cases = data["cases"]
    reviewed = [c for c in cases if c.get("human_verdict") is not None]

    data["triage_stats"] = {
        "total_cases": len(cases),
        "reviewed": len(reviewed),
        "unreviewed": len(cases) - len(reviewed),
        "last_reviewed_at": max(
            (c.get("reviewed_at", "") for c in reviewed),
            default=None,
        ),
        "category_counts": _count_categories(reviewed),
        "agreement_rate": (
            sum(
                1 for c in reviewed
                if c.get("human_verdict") == c.get("machine_verdict")
            )
            / len(reviewed)
            if reviewed
            else None
        ),
    }


def _count_categories(reviewed: list[dict]) -> dict[str, int]:
    """Count occurrences of each triage category."""
    counts: dict[str, int] = {}
    for c in reviewed:
        cat = c.get("triage_category", "uncategorized")
        counts[cat] = counts.get(cat, 0) + 1
    return dict(sorted(counts.items(), key=lambda x: -x[1]))


# ── Taxonomy refinement log ──

def _next_ref_id(log_path: Path) -> str:
    """Read the refinement log and return the next REF-XXX ID.

    Scans for existing '### REF-' headers to find the highest number,
    then increments. Returns 'REF-001' if the file is empty or missing.
    """
    highest = 0
    if log_path.exists():
        import re as _re
        for line in log_path.read_text(encoding="utf-8").splitlines():
            m = _re.match(r"### REF-(\d+)", line)
            if m:
                highest = max(highest, int(m.group(1)))
    return f"REF-{highest + 1:03d}"


def save_refinement(
    log_path: Path,
    *,
    ref_id: str,
    current_category: str,
    proposed_split: str,
    triggering_case_id: str,
    triggering_text: str,
    note: str,
) -> None:
    """Append a taxonomy refinement entry to the log file.

    Creates the file with the standard header if it doesn't exist.
    Appends under the '## Open refinements' section.
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    entry = f"""
### {ref_id}: {current_category} — proposed split

**Current category:** `{current_category}`

**Proposed split:** {proposed_split}

**Triggering case:** {triggering_case_id} — "{triggering_text[:80]}{"…" if len(triggering_text) > 80 else ""}"

**Note:** {note}

**Date logged:** {now}

**Verdict:** Pending — accumulate more triage cases before deciding.

"""

    if not log_path.exists():
        header = (
            "# Taxonomy refinement log\n\n"
            "Granularity gaps in the content type taxonomy, surfaced through "
            "real-world triage. Each entry captures what the taxonomy can't "
            "currently distinguish and whether the distinction would change "
            "the tool's behavior.\n\n"
            "**Decision criterion:** only split a content type when the "
            "distinction would change which standards are evaluated, how "
            "they're weighted, or whether a violation is flagged.\n\n"
            "## Open refinements\n"
        )
        log_path.write_text(header + entry, encoding="utf-8")
    else:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(entry)

    print(
        f"  {C.GREEN}✓ Refinement {ref_id} saved to "
        f"{log_path.name}{C.RESET}"
    )


# ═══════════════════════════════════════════════════════════════════════
# Layer 3: Input — keyboard prompts, shortcut handling, validation
# ═══════════════════════════════════════════════════════════════════════

def prompt_choice(
    prompt_text: str,
    options: tuple[str, ...],
    shortcuts: dict[str, str] | None = None,
    default: str | None = None,
    allow_empty: bool = False,
) -> str | None:
    """Prompt the user to choose from a set of options.

    Supports single-key shortcuts for speed. Shows the shortcut map
    on the first call, then compacts to just the prompt on subsequent
    calls so experienced reviewers aren't slowed down.

    Returns None only if allow_empty is True and the user hits Enter.
    """
    if shortcuts is None:
        shortcuts = {}

    # Build the display: show each option with its shortcut key
    option_display_parts = []
    for opt in options:
        # Find the shortcut key for this option (if any)
        key = next((k for k, v in shortcuts.items() if v == opt), None)
        if key:
            option_display_parts.append(f"[{C.BOLD}{key}{C.RESET}] {opt}")
        else:
            option_display_parts.append(opt)

    hint = "  ".join(option_display_parts)
    default_hint = f" {C.DIM}(default: {default}){C.RESET}" if default else ""

    while True:
        print(f"{prompt_text}{default_hint}")
        print(f"  {hint}")
        try:
            raw = input(f"  {C.BOLD}>{C.RESET} ").strip().lower()
        except EOFError:
            # Handle piped input ending
            return default

        # Empty input → use default if available
        if not raw:
            if default:
                return default
            if allow_empty:
                return None
            continue

        # Check shortcuts first
        if raw in shortcuts:
            return shortcuts[raw]

        # Check full option names
        if raw in options:
            return raw

        # Partial match (type enough to be unambiguous)
        matches = [o for o in options if o.startswith(raw)]
        if len(matches) == 1:
            return matches[0]

        print(f"  {C.RED}Invalid choice. Try again.{C.RESET}")


def prompt_free_text(prompt_text: str, default: str = "") -> str:
    """Prompt for free-text input. Returns default if empty."""
    default_hint = f" {C.DIM}(Enter to skip){C.RESET}" if not default else ""
    try:
        raw = input(f"{prompt_text}{default_hint}\n  {C.BOLD}>{C.RESET} ").strip()
    except EOFError:
        return default
    return raw if raw else default


# ═══════════════════════════════════════════════════════════════════════
# Layer 4: Flow — review state machine, navigation, summary
# ═══════════════════════════════════════════════════════════════════════

def collect_refinement(case: dict, log_path: Path) -> None:
    """Collect a taxonomy refinement entry mid-triage.

    Triggered by [r] during case review. Pre-fills the current category
    from the case being reviewed. Collects the proposed split and a note,
    then appends to the refinement log. Returns to the same case
    without advancing the cursor.
    """
    print(f"\n{C.BOLD}── Log a taxonomy refinement ──{C.RESET}")

    current_category = case.get("content_type", "unknown")
    print(
        f"Current category: {C.CYAN}{current_category}{C.RESET}"
    )

    # What should the split be?
    proposed = prompt_free_text(
        "What distinction is missing? (e.g., 'section_header vs component label')"
    )
    if not proposed:
        print(f"  {C.DIM}Cancelled.{C.RESET}")
        return

    # Why does it matter?
    note = prompt_free_text(
        "Why would this change the tool's behavior?"
    )
    if not note:
        note = "(no note)"

    ref_id = _next_ref_id(log_path)
    case_id = case.get("case_id", "unknown")
    case_text = case.get("input", case.get("text", ""))

    save_refinement(
        log_path,
        ref_id=ref_id,
        current_category=current_category,
        proposed_split=proposed,
        triggering_case_id=case_id,
        triggering_text=case_text,
        note=note,
    )
    print("")


def review_case(case: dict, index: int, total: int) -> str:
    """Walk through the review workflow for a single case.

    Returns a command string:
        'next'  — advance to the next case
        'back'  — go back to the previous case
        'skip'  — skip this case without reviewing
        'quit'  — save and exit
        'summary' — show summary dashboard
        'refinement' — log a taxonomy refinement (handled by caller)

    The workflow is a simple state machine:
        1. Show the case
        2. Quick agree? (if machine verdict seems right, one key to confirm)
        3. If not, collect verdict override
        4. Collect confidence
        5. Collect triage category
        6. Collect notes (optional)
        7. Stamp reviewed_at timestamp
    """
    # Display the case
    print(render_case(case, index, total))

    # Navigation options available at every prompt
    print(
        f"{C.DIM}Navigation: [s]kip  [b]ack  [q]uit  "
        f"[d]ashboard  [r]efinement{C.RESET}"
    )
    print("")

    # Step 1: Quick agreement check
    # This is the fast path for the common case where the machine is right.
    # One keypress to confirm and move on.
    machine_verdict = case.get("machine_verdict", "unknown")
    print(
        f"Machine says {_verdict_badge(machine_verdict)}. "
        f"Do you agree?"
    )

    agree_result = prompt_choice(
        "",
        ("yes", "no", "skip", "back", "quit", "dashboard", "refinement"),
        shortcuts={
            "y": "yes",
            "n": "no",
            "s": "skip",
            "b": "back",
            "q": "quit",
            "d": "dashboard",
            "r": "refinement",
        },
        default="yes",
    )

    # Handle navigation commands
    if agree_result in ("skip", "back", "quit", "dashboard", "refinement"):
        if agree_result == "dashboard":
            return "summary"
        return agree_result

    if agree_result == "yes":
        # Fast path: human agrees with machine
        human_verdict = machine_verdict
    else:
        # Override: human disagrees, flip the verdict
        human_verdict = "pass" if machine_verdict == "fail" else "fail"
        print(f"  → Overriding to {_verdict_badge(human_verdict)}")

    # Step 2: Confidence
    confidence = prompt_choice(
        "Confidence?",
        CONFIDENCE_LEVELS,
        shortcuts={"h": "high", "m": "medium", "l": "low"},
        default="high" if agree_result == "yes" else "medium",
    )
    if confidence in ("skip", "back", "quit"):
        return confidence

    # Step 3: Triage category
    # For agreements, default to 'correct'. For overrides, no default —
    # force the reviewer to think about WHY the machine was wrong.
    cat_default = "correct" if agree_result == "yes" else None
    category = prompt_choice(
        "Triage category?",
        TRIAGE_CATEGORIES,
        shortcuts={
            "c": "correct",
            "m": "misclassification",
            "h": "hallucination",
            "x": "missing_standard",
            "g": "context_gap",
        },
        default=cat_default,
    )
    if category in ("skip", "back", "quit"):
        return category

    # Step 4: Notes (optional free text)
    notes = prompt_free_text("Notes (optional)?")

    # Stamp the review
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    case["human_verdict"] = human_verdict
    case["human_confidence"] = confidence
    case["triage_category"] = category
    case["human_notes"] = notes if notes else None
    case["reviewed_at"] = now

    print(f"\n  {C.GREEN}✓ Saved{C.RESET}")
    return "next"


def run_triage(
    data: dict[str, Any],
    path: Path,
    *,
    unreviewed_only: bool = False,
    jump_to: str | None = None,
    refinement_log: Path | None = None,
) -> None:
    """Main triage loop. Walks through cases, saves incrementally.

    The outer loop handles navigation (next, back, skip, jump, refinement)
    while review_case handles the per-case state machine. This separation
    means adding new navigation commands never touches review logic.
    """
    cases = data["cases"]
    log_path = refinement_log or Path("_private/taxonomy_refinement_log.md")

    if not cases:
        print(f"{C.YELLOW}No cases in this file.{C.RESET}")
        return

    # Build the index of cases to review
    if unreviewed_only:
        review_indices = [
            i for i, c in enumerate(cases)
            if c.get("human_verdict") is None
        ]
        if not review_indices:
            print(f"{C.GREEN}All cases already reviewed!{C.RESET}")
            print(render_summary(cases))
            return
        print(
            f"{C.DIM}Showing {len(review_indices)} unreviewed cases "
            f"(of {len(cases)} total).{C.RESET}"
        )
    else:
        review_indices = list(range(len(cases)))

    # Jump to a specific case ID if requested
    cursor = 0
    if jump_to:
        for i, idx in enumerate(review_indices):
            if cases[idx].get("case_id") == jump_to:
                cursor = i
                break
        else:
            print(
                f"{C.YELLOW}Case ID '{jump_to}' not found. "
                f"Starting from the beginning.{C.RESET}"
            )

    # Install a signal handler so Ctrl+C saves cleanly instead of
    # leaving a half-written file or losing the current session.
    interrupted = False

    def _handle_sigint(signum, frame):
        nonlocal interrupted
        interrupted = True
        print(f"\n{C.YELLOW}Ctrl+C received. Saving and exiting...{C.RESET}")

    original_handler = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGINT, _handle_sigint)

    try:
        while 0 <= cursor < len(review_indices):
            if interrupted:
                break

            case_index = review_indices[cursor]
            case = cases[case_index]

            try:
                command = review_case(
                    case, case_index, len(cases)
                )
            except KeyboardInterrupt:
                # Second Ctrl+C during a review — exit immediately
                print(
                    f"\n{C.YELLOW}Interrupted. Saving progress...{C.RESET}"
                )
                break

            if command == "next":
                # Save after every reviewed case — incremental progress
                update_triage_metadata(data)
                save_triage_file(data, path)
                cursor += 1
            elif command == "back":
                cursor = max(0, cursor - 1)
            elif command == "skip":
                cursor += 1
            elif command == "summary":
                print(render_summary(cases))
                # Don't advance cursor — let the reviewer continue
                # from the same case after viewing the summary
            elif command == "refinement":
                # Collect a taxonomy refinement, then re-show the
                # same case so the reviewer can continue their review
                collect_refinement(case, log_path)
            elif command == "quit":
                break

        # Final save and summary on exit
        update_triage_metadata(data)
        save_triage_file(data, path)

        reviewed_count = sum(
            1 for c in cases if c.get("human_verdict") is not None
        )
        print(f"\n{C.GREEN}Progress saved to {path}{C.RESET}")
        print(
            f"Reviewed: {reviewed_count}/{len(cases)} "
            f"({len(cases) - reviewed_count} remaining)"
        )

        if reviewed_count > 0:
            print(render_summary(cases))

    finally:
        # Restore the original signal handler
        signal.signal(signal.SIGINT, original_handler)


# ═══════════════════════════════════════════════════════════════════════
# CLI entry point
# ═══════════════════════════════════════════════════════════════════════

def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser. Separated from main() for testability."""
    parser = argparse.ArgumentParser(
        description="Interactive triage tool for ContentRX scan exports.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Keyboard shortcuts during review:\n"
            "  [y] agree with machine    [n] override verdict\n"
            "  [s] skip case             [b] go back\n"
            "  [d] show dashboard        [q] save and quit\n"
            "  [r] log a taxonomy refinement\n"
            "\n"
            "Triage categories:\n"
            "  [c] correct              Machine got it right\n"
            "  [m] misclassification    Wrong content type\n"
            "  [h] hallucination        LLM invented a violation\n"
            "  [x] missing_standard     Standards library gap\n"
            "  [g] context_gap          Tool lacks needed context\n"
        ),
    )
    parser.add_argument(
        "file",
        type=Path,
        help="Path to the triage export JSON file.",
    )
    parser.add_argument(
        "--unreviewed", "-u",
        action="store_true",
        help="Show only unreviewed cases (skip already-triaged ones).",
    )
    parser.add_argument(
        "--jump", "-j",
        type=str,
        default=None,
        metavar="CASE_ID",
        help="Jump to a specific case ID (e.g., SCAN-2026-03-29-042).",
    )
    parser.add_argument(
        "--summary", "-s",
        action="store_true",
        help="Show the summary dashboard and exit (no interactive review).",
    )
    parser.add_argument(
        "--refinement-log", "-r",
        type=Path,
        default=None,
        metavar="PATH",
        help=(
            "Path to the taxonomy refinement log "
            "(default: _private/taxonomy_refinement_log.md)."
        ),
    )
    return parser


def main() -> None:
    """Entry point for the triage CLI."""
    parser = build_parser()
    args = parser.parse_args()

    # Load the triage file
    data = load_triage_file(args.file)
    cases = data["cases"]

    print(f"\n{C.BOLD}ContentRX triage tool{C.RESET}")
    print(f"File: {args.file}")
    print(f"Cases: {len(cases)}")

    reviewed = sum(1 for c in cases if c.get("human_verdict") is not None)
    if reviewed > 0:
        print(
            f"Previously reviewed: {C.GREEN}{reviewed}{C.RESET} "
            f"({len(cases) - reviewed} remaining)"
        )
    print("")

    # Summary-only mode
    if args.summary:
        if reviewed == 0:
            print(f"{C.DIM}No cases reviewed yet.{C.RESET}")
        else:
            print(render_summary(cases))
        return

    # Interactive review mode
    run_triage(
        data,
        args.file,
        unreviewed_only=args.unreviewed,
        jump_to=args.jump,
        refinement_log=args.refinement_log,
    )


if __name__ == "__main__":
    main()
