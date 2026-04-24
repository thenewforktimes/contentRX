"""Calibration prompt builder for the auto-annotator.

Reads existing human-annotated eval cases and selects diverse few-shot
examples to calibrate an LLM annotator. The goal: annotations that read
like a content designer wrote them on a busy day.

Usage:
    from annotator_prompt import build_calibration_prompt

    prompt = build_calibration_prompt(
        annotated_cases=cases_with_human_verdicts,
        max_examples=10,
    )
"""

from __future__ import annotations

import json
from pathlib import Path


# ---------------------------------------------------------------------------
# Example selection
# ---------------------------------------------------------------------------

def _score_diversity(
    case: dict,
    selected: list[dict],
) -> float:
    """Score a candidate case for how much diversity it adds to the selection.

    Prefers cases that cover standards, content types, verdict directions,
    and confidence levels not yet represented. Higher score = more diverse.
    """
    score = 0.0

    seen_standards = {c["standard_id"] for c in selected}
    seen_content_types = {c["content_type"] for c in selected}
    seen_verdicts = {(c["human_verdict"], c["expected"]) for c in selected}
    seen_confidence = {c["human_confidence"] for c in selected}

    # Novel standard is the strongest diversity signal
    if case["standard_id"] not in seen_standards:
        score += 4.0

    # Novel content type
    if case["content_type"] not in seen_content_types:
        score += 3.0

    # Novel verdict direction (especially disagreements)
    verdict_pair = (case["human_verdict"], case["expected"])
    if verdict_pair not in seen_verdicts:
        score += 2.0

    # Disagreement cases are the highest-value annotations
    if case["human_verdict"] != case["expected"]:
        score += 3.0

    # Novel confidence level
    if case["human_confidence"] not in seen_confidence:
        score += 1.0

    return score


def select_examples(
    annotated_cases: list[dict],
    max_examples: int = 10,
) -> list[dict]:
    """Select diverse few-shot examples from annotated cases.

    Uses a greedy diversity-maximizing strategy: start with disagreement
    cases (the most instructive), then fill remaining slots by selecting
    whichever candidate adds the most diversity to the set.

    Returns up to max_examples cases, or all annotated cases if fewer exist.
    """
    if len(annotated_cases) <= max_examples:
        return list(annotated_cases)

    # Separate disagreements (highest-value) from agreements
    disagreements = [
        c for c in annotated_cases
        if c.get("human_verdict") and c.get("expected")
        and c["human_verdict"] != c["expected"]
    ]
    agreements = [
        c for c in annotated_cases
        if c.get("human_verdict") and c.get("expected")
        and c["human_verdict"] == c["expected"]
    ]

    selected: list[dict] = []
    remaining = list(annotated_cases)

    # Seed with diverse disagreements (not just the first N)
    disagreement_budget = max_examples // 2
    disagreement_pool = list(disagreements)
    while len(selected) < disagreement_budget and disagreement_pool:
        if not selected:
            # First pick: take any disagreement
            pick = disagreement_pool.pop(0)
        else:
            # Subsequent picks: maximize diversity within disagreements
            pick = max(disagreement_pool, key=lambda c: _score_diversity(c, selected))
            disagreement_pool.remove(pick)
        selected.append(pick)
        remaining.remove(pick)

    # Fill the rest greedily by diversity score
    while len(selected) < max_examples and remaining:
        best_case = max(remaining, key=lambda c: _score_diversity(c, selected))
        selected.append(best_case)
        remaining.remove(best_case)

    return selected


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

def _format_example(case: dict, index: int) -> str:
    """Format a single annotated case as a few-shot example."""
    # Determine whether this is an agreement or disagreement
    is_disagreement = case.get("human_verdict") != case.get("expected")
    label = "DISAGREEMENT" if is_disagreement else "AGREEMENT"

    return (
        f"--- Example {index + 1} ({label}) ---\n"
        f"Input: \"{case['input']}\"\n"
        f"Content type: {case['content_type']}\n"
        f"Standard: {case['standard_id']}\n"
        f"Machine expected: {case['expected']}\n"
        f"Human verdict: {case['human_verdict']}\n"
        f"Human confidence: {case['human_confidence']}\n"
        f"Human notes: {case['human_notes']}\n"
    )


def _build_precedent_index(
    annotated_cases: list[dict],
    preference_signals: list[dict] | None = None,
) -> dict:
    """Build a lookup of annotation precedents by (standard_id, content_type, verdict).

    Used by the auto-annotator to determine confidence thresholds:
    - 3+ precedents for the same key → high confidence
    - 1-2 precedents or partial match → medium confidence
    - 0 precedents → low confidence

    Human-eval build plan Session 31 adds `preference_signals` as a
    second precedent source. Each signal is a dict with keys
    `standard_id`, `content_type`, `aligned`, `conflicting`. Aligned
    responses add to the precedent count for
    `standard_id|content_type|pass` (the pair asks "which passes the
    standard"). Conflicting responses don't add — they're surfaced
    separately via `_build_preference_conflict_index` so the prompt
    can explicitly mention contested tuples.
    """
    index: dict[str, int] = {}
    for case in annotated_cases:
        if case.get("human_verdict") is None:
            continue
        key = f"{case['standard_id']}|{case['content_type']}|{case['human_verdict']}"
        index[key] = index.get(key, 0) + 1

    if preference_signals:
        for signal in preference_signals:
            aligned = int(signal.get("aligned", 0))
            if aligned <= 0:
                continue
            key = f"{signal['standard_id']}|{signal['content_type']}|pass"
            index[key] = index.get(key, 0) + aligned

    return index


def _build_preference_conflict_index(
    preference_signals: list[dict] | None,
) -> dict:
    """Return `key → conflicting_count` for (standard, content_type) tuples
    where the pairwise preference signal conflicts with the encoded
    standard. Shape matches `_build_precedent_index` for easy rendering.

    Human-eval build plan Session 31. A high conflicting count is a
    signal the annotator should *lower* confidence, not raise it — the
    auto-annotator prompt surfaces it as a "contested" list.
    """
    out: dict[str, int] = {}
    if not preference_signals:
        return out
    for signal in preference_signals:
        conflicting = int(signal.get("conflicting", 0))
        if conflicting <= 0:
            continue
        key = f"{signal['standard_id']}|{signal['content_type']}"
        out[key] = out.get(key, 0) + conflicting
    return out


def aggregate_preference_signals(export: dict) -> list[dict]:
    """Aggregate a `/api/preferences/export` dump into per-
    (standard_id, content_type) signals.

    Input shape (from `src/app/api/preferences/export/route.ts`):
        {
          "items": [
            {
              "pair": {"standard_id": ..., "content_type": ..., "expected_preferred": "left" | "right" | null},
              "responses": [{"preferred": "left" | "right" | "neither"}, ...]
            }
          ]
        }

    Output shape (consumed by `_build_precedent_index`):
        [
          {
            "standard_id": ...,
            "content_type": ...,
            "aligned": int,       # responses aligning with expected_preferred
            "conflicting": int,   # responses picking the weaker side
            "neither": int,       # responses that chose "neither" or probes
          }
        ]
    """
    by_key: dict[tuple[str, str], dict] = {}
    for item in export.get("items", []):
        pair = item.get("pair", {})
        std = pair.get("standard_id")
        ctype = pair.get("content_type")
        if not std or not ctype:
            continue
        expected = pair.get("expected_preferred")
        key = (std, ctype)
        bucket = by_key.setdefault(
            key,
            {
                "standard_id": std,
                "content_type": ctype,
                "aligned": 0,
                "conflicting": 0,
                "neither": 0,
            },
        )
        for r in item.get("responses", []):
            preferred = r.get("preferred")
            if preferred == "neither":
                bucket["neither"] += 1
            elif not expected:
                # judgment probe — record as neither for alignment purposes
                bucket["neither"] += 1
            elif preferred == expected:
                bucket["aligned"] += 1
            else:
                bucket["conflicting"] += 1
    return sorted(
        by_key.values(),
        key=lambda s: (s["standard_id"], s["content_type"]),
    )


def build_calibration_prompt(
    annotated_cases: list[dict],
    max_examples: int = 10,
    preference_signals: list[dict] | None = None,
) -> str:
    """Build the full calibration system prompt for the LLM annotator.

    Args:
        annotated_cases: Cases with non-null human_verdict, human_confidence,
            and human_notes fields. These are the gold-standard annotations
            the LLM will learn from.
        max_examples: Maximum number of few-shot examples to include.
        preference_signals: Optional list of per-(standard, content_type)
            preference aggregates from pairwise elicitation (Session 31).
            Each dict: `{standard_id, content_type, aligned, conflicting}`.
            Aligned responses raise the precedent count; conflicting
            responses surface a contested-tuples list in the prompt.

    Returns:
        A system prompt string ready to pass to the Anthropic API.
    """
    examples = select_examples(annotated_cases, max_examples)
    precedent_index = _build_precedent_index(annotated_cases, preference_signals)
    conflict_index = _build_preference_conflict_index(preference_signals)

    examples_text = "\n".join(
        _format_example(case, i) for i, case in enumerate(examples)
    )

    precedent_summary = json.dumps(precedent_index, indent=2)
    conflict_summary = (
        json.dumps(conflict_index, indent=2) if conflict_index else None
    )

    conflict_section = (
        f"""

## Contested tuples (pairwise preference disagreement)

These (standard, content_type) tuples have pairwise-preference
responses that disagree with the encoded standard preference. A high
count is a signal that the rule is genuinely contested — lower your
confidence even when annotation precedent would otherwise be high.

{conflict_summary}
"""
        if conflict_summary
        else ""
    )

    return f"""You are a calibrated human annotator for a content standards checker. Your job is to review extracted UI copy and the checker's machine verdict, then provide a human expert judgment.

## Your role

You are not the checker. The checker already ran. You are the human reviewer who looks at the checker's output and decides whether it got the call right. Your annotations will be used to calibrate the checker's accuracy over time.

## Annotation fields you produce

For each case, you output exactly three fields:

1. **human_verdict**: "pass" or "fail" — your expert judgment on whether this copy violates the cited standard. This MAY disagree with the machine's `expected` verdict. Disagreements are valuable data, not errors.

2. **human_confidence**: "high", "medium", or "low"
   - **high**: The exact combination of standard + content type + verdict direction has 3 or more precedents in the existing dataset. You are confident this is the right call.
   - **medium**: Partial precedent exists (same standard but different content type, or same content type but different standard). The pattern is familiar but not identical.
   - **low**: No precedent. This is a novel combination, or the case is genuinely ambiguous. Default to low when uncertain.

3. **human_notes**: Your reasoning in 1-2 sentences. Follow these patterns:
   - Lead with the verdict rationale, not a restatement of the rule
   - Cite evidence from the source when it exists ("the same page uses sentence case in the breadcrumb")
   - Frame standard disagreements as revision signals ("GRM-04 should have an exception for headings")
   - Don't hedge your reasoning even when confidence is medium
   - Write like a content designer on a busy day — clear, concise, direct

## Precedent index

This index shows how many existing annotations match each (standard, content_type, verdict) combination. Use it to calibrate your confidence level. Counts include both human-approved annotations and aligned pairwise-preference responses (Session 31).

{precedent_summary}
{conflict_section}
## Calibration examples

These are real human annotations from the existing dataset. Match this voice and judgment pattern.

{examples_text}

## Critical rules

- A false "high" confidence that requires correction is worse than a "low" that turns out fine. When in doubt, go low.
- Disagreements between `expected` and your `human_verdict` are the most valuable data points. Do not avoid them. If the standard says fail but the copy is fine in context, say pass and explain why.
- Do not restate the standard rule in your notes. The reader already knows the rule. Explain why the verdict applies or doesn't in this specific case.
- Your notes must be scoped to the standard being tested. Don't comment on other issues you notice in the copy.

## Output format

Respond with ONLY valid JSON, no markdown, no backticks:

{{
  "human_verdict": "pass" or "fail",
  "human_confidence": "high" or "medium" or "low",
  "human_notes": "your reasoning"
}}"""


# ---------------------------------------------------------------------------
# File I/O helpers
# ---------------------------------------------------------------------------

def load_annotated_cases(*file_paths: str | Path) -> list[dict]:
    """Load and merge annotated cases from one or more eval case files.

    Only returns cases where human_verdict is not null — these are the
    gold-standard annotations used for calibration.
    """
    annotated: list[dict] = []
    for path in file_paths:
        path = Path(path)
        if not path.exists():
            continue
        with open(path) as f:
            data = json.load(f)
        for case in data.get("cases", []):
            if case.get("human_verdict") is not None:
                annotated.append(case)
    return annotated


def load_preference_signals(path: str | Path) -> list[dict]:
    """Load a `/api/preferences/export` dump from disk and aggregate it
    into per-(standard, content_type) signals.

    Returns an empty list when the file is missing — this keeps
    preference signal optional for auto-annotator runs that don't
    need it.
    """
    p = Path(path)
    if not p.exists():
        return []
    with open(p) as f:
        export = json.load(f)
    return aggregate_preference_signals(export)
