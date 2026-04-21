#!/usr/bin/env python3
"""Triage assist: pre-classify annotated cases before human review.

Sits between the auto-annotator and the triage CLI. Adds suggested
classifications to each case so the human reviewer can confirm with
one keypress instead of classifying from scratch.

Two stages:
    1. Deterministic pattern matching (instant, zero cost)
       Catches obvious patterns: emoji widgets, nav links, data display,
       very short strings, known false positive clusters.

    2. LLM-powered classification (for ambiguous remainder)
       Uses few-shot examples from confirmed triage data to suggest
       a category, confidence, and reasoning.

Output fields added to each case:
    suggested_category    — one of the triage taxonomy categories
    suggested_confidence  — high / medium / low
    suggested_notes       — one-line reasoning for the suggestion

These fields are NEVER auto-approved. The human always has the final say.
The triage CLI shows them as defaults when present.

Usage:
    python3 tools/triage_assist.py triage/ditto_cases.json
    python3 tools/triage_assist.py triage/ditto_cases.json --calibration triage/opendoor_reviewed.json
    python3 tools/triage_assist.py triage/ditto_cases.json --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional


# ═══════════════════════════════════════════════════════════════════════
# Triage taxonomy (must match triage.py)
# ═══════════════════════════════════════════════════════════════════════

TRIAGE_CATEGORIES = (
    "correct",
    "misclassification",
    "hallucination",
    "missing_standard",
    "context_gap",
)


# ═══════════════════════════════════════════════════════════════════════
# Stage 1: Deterministic pattern matching
#
# Each pattern function returns (category, confidence, notes) or None.
# First match wins. Order matters — most specific patterns first.
# ═══════════════════════════════════════════════════════════════════════

def _is_emoji_widget(text: str) -> bool:
    """Detect emoji reaction buttons: '❤️13', '🔥5', '👏8', etc."""
    # Strip whitespace, check if it's emoji(s) + optional number
    stripped = text.strip()
    # Remove all emoji characters and see if only digits/whitespace remain
    without_emoji = re.sub(
        r"[\U0001F300-\U0001FAFF\U00002702-\U000027B0"
        r"\U0000FE00-\U0000FE0F\U0000200D\U00002600-\U000026FF"
        r"\U0000FE0F\U00002B50\U00002764]+",
        "", stripped,
    )
    without_emoji = without_emoji.strip()
    # It's an emoji widget if removing emoji leaves only digits or nothing
    return bool(stripped) and (not without_emoji or without_emoji.isdigit())


def _is_nav_footer_link(text: str, content_type: str) -> bool:
    """Detect navigation and footer links classified as buttons or labels."""
    if content_type not in ("button_cta", "ui_label"):
        return False
    # Single or two-word strings that look like site nav
    words = text.strip().split()
    if len(words) > 4:
        return False
    nav_patterns = {
        "solutions", "product", "products", "resources", "company",
        "legal", "pricing", "enterprise", "blog", "careers",
        "about", "contact", "help", "support", "docs",
        "documentation", "community", "developers", "security",
        "privacy", "terms", "login", "log in", "sign up",
    }
    return text.strip().lower() in nav_patterns


def _is_title_case_label(text: str, content_type: str, standard_id: Optional[str]) -> bool:
    """Detect title case strings flagged by CON-02 that are likely navigation or headings."""
    if standard_id != "CON-02":
        return False
    if content_type not in ("ui_label", "heading"):
        return False
    # Check if the string is actually title case (most words capitalized)
    words = text.strip().split()
    if len(words) < 2:
        return False
    # Skip small words that are conventionally lowercase in title case
    skip_words = {"a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "is"}
    capitalized = sum(1 for w in words if w[0].isupper() or w.lower() in skip_words)
    return capitalized >= len(words) * 0.7


def _is_data_display(text: str) -> bool:
    """Detect data display strings (chart labels, metrics, etc.)."""
    # Strings that are primarily numbers, percentages, or currency
    stripped = text.strip()
    if re.match(r"^[\d$%,.KMBkmb\s|:\-/]+$", stripped):
        return True
    return False


def _is_too_short(text: str) -> bool:
    """Detect strings too short for meaningful evaluation."""
    return len(text.strip()) <= 2


def pattern_classify(case: dict) -> Optional[tuple[str, str, str]]:
    """Run all deterministic patterns against a case.

    Returns (category, confidence, notes) or None if no pattern matches.
    """
    text = case.get("input", case.get("text", ""))
    content_type = case.get("content_type", "")
    standard_id = case.get("standard_id")
    expected = case.get("expected", "")

    # Only classify fail cases and unprocessed cases — passes are already correct
    if expected == "pass":
        return ("correct", "high", "Machine verdict is pass, no violation flagged.")

    # Emoji reaction widgets
    if _is_emoji_widget(text):
        return (
            "context_gap",
            "high",
            "Emoji reaction widget, not a CTA. Misclassified as button_cta.",
        )

    # Too short for evaluation
    if _is_too_short(text):
        return (
            "context_gap",
            "high",
            f"String is {len(text.strip())} characters — too short for meaningful evaluation.",
        )

    # Navigation / footer links flagged as buttons
    if _is_nav_footer_link(text, content_type):
        return (
            "context_gap",
            "high",
            "Website navigation link, not a product UI button.",
        )

    # Title case labels flagged by CON-02
    if _is_title_case_label(text, content_type, standard_id):
        return (
            "context_gap",
            "high",
            "Title case is conventional for navigation and marketing headings. Not product UI.",
        )

    # Data display strings
    if _is_data_display(text):
        return (
            "context_gap",
            "high",
            "Data display or metric label. Formatting standards don't apply.",
        )

    return None


# ═══════════════════════════════════════════════════════════════════════
# Stage 2: LLM-powered classification
# ═══════════════════════════════════════════════════════════════════════

TRIAGE_ASSIST_PROMPT = """You are a triage assistant for ContentRX, a content standards checker. You help classify evaluation cases before human review.

For each case, you'll see the text, content type, the standard that was flagged (if any), and the machine verdict. Your job is to suggest a triage category.

## Triage categories

- **correct** — The machine verdict is right. The violation (or pass) is accurate.
- **misclassification** — The content type was wrong, which caused the wrong standards to apply.
- **hallucination** — The LLM invented a violation that doesn't exist in the text.
- **missing_standard** — The text has a real quality issue but no standard covers it.
- **context_gap** — The machine lacks context it needs. The content is from a different surface (marketing site, presentation, internal doc) than product UI, or the text is a data label, chart element, or other non-standard content.

## How to decide

1. If the machine said pass and the text looks fine → correct
2. If the machine flagged a violation that genuinely exists → correct
3. If the text is website navigation, marketing headings, or non-product content → context_gap
4. If the content type is wrong (e.g., a heading classified as button_cta) → misclassification
5. If the violation doesn't match what's actually in the text → hallucination
6. If there's a real issue but no standard covers it → missing_standard

Respond with ONLY a JSON object for each case. No explanation outside the JSON.

{
  "suggested_category": "one of the five categories",
  "suggested_confidence": "high or medium or low",
  "suggested_notes": "one sentence explaining your reasoning"
}"""


def _build_few_shot_examples(calibration_cases: list[dict]) -> str:
    """Build few-shot examples from confirmed triage data."""
    if not calibration_cases:
        return ""

    examples = []
    # Prioritize diversity: one example per category
    seen_categories = set()
    for case in calibration_cases:
        cat = case.get("triage_category") or case.get("human_notes", "")
        if not case.get("human_verdict"):
            continue
        category = case.get("triage_category", "")
        if category in seen_categories:
            continue
        seen_categories.add(category)

        text = case.get("input", case.get("text", ""))[:80]
        ct = case.get("content_type", "unknown")
        std = case.get("standard_id", "none")
        verdict = case.get("expected", case.get("machine_verdict", "unknown"))
        human_cat = case.get("triage_category", "unknown")
        human_notes = case.get("human_notes", "")

        examples.append(
            f'Text: "{text}"\n'
            f"Content type: {ct} | Standard: {std} | Machine verdict: {verdict}\n"
            f"→ Category: {human_cat}\n"
            f"→ Notes: {human_notes}"
        )

        if len(examples) >= 5:
            break

    if not examples:
        return ""

    return "\n\n## Examples from past triage\n\n" + "\n\n".join(examples)


def llm_classify_batch(
    cases: list[dict],
    calibration_cases: list[dict],
    model: str = "claude-sonnet-4-20250514",
) -> list[dict]:
    """Classify a batch of cases using an LLM call.

    Returns a list of {suggested_category, suggested_confidence, suggested_notes}
    dicts, one per input case.
    """
    import anthropic

    few_shot = _build_few_shot_examples(calibration_cases)
    system = TRIAGE_ASSIST_PROMPT + few_shot

    # Build the user message with all cases
    lines = []
    for i, case in enumerate(cases):
        text = case.get("input", case.get("text", ""))[:120]
        ct = case.get("content_type", "unknown")
        std = case.get("standard_id", "none")
        verdict = case.get("expected", case.get("machine_verdict", "unknown"))
        lines.append(
            f"Case {i + 1}:\n"
            f'  Text: "{text}"\n'
            f"  Content type: {ct}\n"
            f"  Standard flagged: {std}\n"
            f"  Machine verdict: {verdict}"
        )

    user_message = (
        "Classify each case below. Respond with a JSON array of objects, "
        "one per case, in order.\n\n" + "\n\n".join(lines)
    )

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()
    # Strip markdown fences
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    try:
        results = json.loads(raw)
        if isinstance(results, dict):
            results = [results]
        return results
    except json.JSONDecodeError:
        # If the LLM returns malformed JSON, return low-confidence defaults
        return [
            {
                "suggested_category": "correct",
                "suggested_confidence": "low",
                "suggested_notes": "LLM classification failed — needs manual review.",
            }
            for _ in cases
        ]


# ═══════════════════════════════════════════════════════════════════════
# Orchestrator
# ═══════════════════════════════════════════════════════════════════════

def run_triage_assist(
    data: dict,
    calibration_cases: list[dict] | None = None,
    dry_run: bool = False,
    batch_size: int = 15,
) -> dict:
    """Run triage assist on all cases in the data.

    Modifies cases in-place, adding suggested_* fields.
    Returns the modified data dict.
    """
    cases = data["cases"]
    calibration = calibration_cases or []

    # Counters
    pattern_matched = 0
    llm_classified = 0
    already_reviewed = 0
    llm_queue = []

    print(f"\nStage 1: Deterministic pattern matching ({len(cases)} cases)")

    for case in cases:
        # Skip cases that have been human-confirmed (approved or revised).
        # Cases with review_status "pending" still need triage assist,
        # even if the auto-annotator pre-filled a machine prediction.
        if case.get("review_status") in ("approved", "revised"):
            already_reviewed += 1
            continue

        result = pattern_classify(case)
        if result:
            category, confidence, notes = result
            case["suggested_category"] = category
            case["suggested_confidence"] = confidence
            case["suggested_notes"] = notes
            pattern_matched += 1
        else:
            llm_queue.append(case)

    print(f"  Pattern matches: {pattern_matched}")
    print(f"  Already reviewed: {already_reviewed}")
    print(f"  Remaining for LLM: {len(llm_queue)}")

    if dry_run:
        print(f"\n  Dry run — skipping LLM classification.")
        for case in llm_queue:
            case["suggested_category"] = None
            case["suggested_confidence"] = "low"
            case["suggested_notes"] = "Needs LLM classification (skipped in dry run)."
        return data

    if not llm_queue:
        print(f"\n  All cases classified by patterns. No LLM calls needed.")
        return data

    # Stage 2: LLM classification in batches
    print(f"\nStage 2: LLM classification ({len(llm_queue)} cases in batches of {batch_size})")

    batches = [
        llm_queue[i:i + batch_size]
        for i in range(0, len(llm_queue), batch_size)
    ]

    for bi, batch in enumerate(batches):
        print(f"  Batch {bi + 1}/{len(batches)} ({len(batch)} cases)...", end=" ", flush=True)
        start = time.time()

        results = llm_classify_batch(batch, calibration)

        # Apply results to cases
        for case, result in zip(batch, results):
            case["suggested_category"] = result.get("suggested_category", "correct")
            case["suggested_confidence"] = result.get("suggested_confidence", "low")
            case["suggested_notes"] = result.get("suggested_notes", "")
            llm_classified += 1

        elapsed = time.time() - start
        print(f"done ({elapsed:.1f}s)")

    print(f"\n  LLM classified: {llm_classified}")

    # Summary
    from collections import Counter
    all_suggested = Counter(
        c.get("suggested_category", "none")
        for c in cases
        if c.get("suggested_category") and c.get("human_verdict") is None
    )
    print(f"\nSuggested category distribution:")
    for cat, n in all_suggested.most_common():
        print(f"  {cat}: {n}")

    return data


# ═══════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Pre-classify triage cases before human review.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 tools/triage_assist.py triage/ditto_cases.json\n"
            "  python3 tools/triage_assist.py triage/new_scan.json --calibration triage/reviewed_cases.json\n"
            "  python3 tools/triage_assist.py triage/new_scan.json --dry-run\n"
        ),
    )
    parser.add_argument(
        "file",
        type=Path,
        help="Path to the annotated JSON file (output of auto_annotate.py).",
    )
    parser.add_argument(
        "--calibration", "-c",
        type=Path,
        default=None,
        help="Path to a previously reviewed triage file for few-shot examples.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run pattern matching only, skip LLM classification.",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=None,
        help="Output path. Defaults to overwriting the input file.",
    )
    args = parser.parse_args()

    # Load the input file
    if not args.file.exists():
        print(f"Error: file not found: {args.file}")
        sys.exit(1)

    with open(args.file, "r", encoding="utf-8") as f:
        data = json.load(f)

    if "cases" not in data:
        print("Error: expected a JSON object with a 'cases' array.")
        sys.exit(1)

    # Load calibration data if provided
    calibration_cases = []
    if args.calibration:
        if not args.calibration.exists():
            print(f"Warning: calibration file not found: {args.calibration}. Proceeding without examples.")
        else:
            with open(args.calibration, "r", encoding="utf-8") as f:
                cal_data = json.load(f)
            calibration_cases = cal_data.get("cases", cal_data if isinstance(cal_data, list) else [])
            reviewed = [c for c in calibration_cases if c.get("human_verdict")]
            print(f"Loaded {len(reviewed)} reviewed cases for calibration.")

    # Run triage assist
    print(f"\nContentRX triage assist")
    print(f"File: {args.file}")
    print(f"Cases: {len(data['cases'])}")

    data = run_triage_assist(
        data,
        calibration_cases=calibration_cases,
        dry_run=args.dry_run,
    )

    # Save
    output_path = args.output or args.file
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\nSaved to {output_path}")
    print("Run the triage CLI to review suggestions:")
    print(f"  python3 tools/triage.py {output_path}")


if __name__ == "__main__":
    main()
