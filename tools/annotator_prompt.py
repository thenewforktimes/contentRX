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


def _build_precedent_index(annotated_cases: list[dict]) -> dict:
    """Build a lookup of annotation precedents by (standard_id, content_type, verdict).

    Used by the auto-annotator to determine confidence thresholds:
    - 3+ precedents for the same key → high confidence
    - 1-2 precedents or partial match → medium confidence
    - 0 precedents → low confidence
    """
    index: dict[str, int] = {}
    for case in annotated_cases:
        if case.get("human_verdict") is None:
            continue
        key = f"{case['standard_id']}|{case['content_type']}|{case['human_verdict']}"
        index[key] = index.get(key, 0) + 1
    return index


def build_calibration_prompt(
    annotated_cases: list[dict],
    max_examples: int = 10,
) -> str:
    """Build the full calibration system prompt for the LLM annotator.

    Args:
        annotated_cases: Cases with non-null human_verdict, human_confidence,
            and human_notes fields. These are the gold-standard annotations
            the LLM will learn from.
        max_examples: Maximum number of few-shot examples to include.

    Returns:
        A system prompt string ready to pass to the Anthropic API.
    """
    examples = select_examples(annotated_cases, max_examples)
    precedent_index = _build_precedent_index(annotated_cases)

    examples_text = "\n".join(
        _format_example(case, i) for i, case in enumerate(examples)
    )

    precedent_summary = json.dumps(precedent_index, indent=2)

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

This index shows how many existing annotations match each (standard, content_type, verdict) combination. Use it to calibrate your confidence level.

{precedent_summary}

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
