"""Validation pass for the content standards checker.

Second LLM call. Takes candidate violations from the scan phase and makes
focused yes/no judgments on each one. Injects content_type_notes for
context-specific evaluation guidance.
"""

from __future__ import annotations

import time

from content_checker.api_utils import (
    create_message,
    parse_llm_json,
    wrap_user_text,
    ParseError,
    DEFAULT_MODEL,
)
from content_checker.models import TokenUsage, Violation


def _build_validation_prompt(content_type: str, active_notes: list[dict]) -> str:
    """Build the system prompt for the validation pass."""
    notes_text = ""
    if active_notes:
        notes_text = (
            "\n\n## Content type notes\n\n"
            "These notes provide additional context for evaluating specific "
            "standards against this content type:\n"
        )
        for note in active_notes:
            notes_text += f"\n- **{note['standard_id']}**: {note['note']}"

    return (
        "You are a content standards validator. Your job is to review candidate "
        "violations and decide whether each one is a genuine violation in context.\n\n"
        f"The content being checked was classified as: **{content_type}**\n"
        f"{notes_text}\n\n"
        "For each candidate, respond with ONLY \"confirm\" or \"reject\":\n"
        "- **confirm**: This is a genuine violation that should be reported.\n"
        "- **reject**: This is a false positive. The content is acceptable.\n\n"
        "Apply these principles:\n"
        "- If a content type note provides specific guidance, follow it.\n"
        "- If the content is borderline, reject. The bar for confirming should be high.\n"
        "- Consider whether the issue actually hurts the user experience for this content type.\n\n"
        "Respond in this exact JSON format (no markdown, no backticks):\n"
        "{\n"
        '  "validations": [\n'
        "    {\n"
        '      "standard_id": "the standard ID",\n'
        '      "verdict": "confirm" or "reject",\n'
        '      "reason": "1 sentence explaining why"\n'
        "    }\n"
        "  ]\n"
        "}"
    )


def validate_candidates(
    text: str,
    content_type: str,
    candidates: list[Violation],
    active_notes: list[dict] | None = None,
    model: str = DEFAULT_MODEL,
) -> tuple[list[Violation], list[Violation], float, TokenUsage]:
    """Validate candidate violations with a focused LLM call.

    Fail-closed contract: if the LLM response is unparseable, ALL
    candidates are returned as confirmed. This is the safe default —
    a parse failure should never silently drop violations.

    Returns (confirmed, rejected, latency, token_usage).
    """
    if not candidates:
        return [], [], 0.0, TokenUsage()

    active_notes = active_notes or []
    system_prompt = _build_validation_prompt(content_type, active_notes)

    # Sentinel-delimit the user `text`. Candidate fields (issue,
    # suggestion) are LLM-generated within the sentinel-defended scan
    # stage and don't need re-wrapping here.
    wrapped = wrap_user_text(text)
    candidate_text = f"Original content ({content_type}):\n{wrapped}\n\nCandidate violations to validate:\n"
    for i, v in enumerate(candidates, 1):
        candidate_text += f"\n{i}. [{v.standard_id}] {v.rule}\n"
        candidate_text += f"   Issue: {v.issue}\n"
        if v.suggestion:
            candidate_text += f"   Suggested fix: {v.suggestion}\n"

    start = time.time()
    llm_response = create_message(
        system=system_prompt,
        user=candidate_text,
        model=model,
        max_tokens=1000,
    )
    latency = time.time() - start

    tokens = TokenUsage(
        input=llm_response.input_tokens,
        output=llm_response.output_tokens,
    )

    try:
        result = parse_llm_json(llm_response.text, context="validate")
    except ParseError:
        # Fail-closed: treat all candidates as confirmed when we can't parse
        return candidates, [], latency, tokens

    # Map by standard_id → (verdict, reason). Validate's `reason` is
    # preserved so rejected candidates can carry it to the review
    # queue as `Violation.validate_rejection_reason` (Session 13).
    validation_map: dict[str, tuple[str, str]] = {}
    for v in result.get("validations", []):
        sid = v.get("standard_id")
        if not sid:
            continue
        validation_map[sid] = (
            v.get("verdict", "confirm"),
            v.get("reason", ""),
        )

    confirmed = []
    rejected = []

    for candidate in candidates:
        verdict, reason = validation_map.get(
            candidate.standard_id, ("confirm", ""),
        )
        if verdict == "reject":
            # Attach validate's rejection reasoning so scan's + validate's
            # sides of the ensemble disagreement are both visible when the
            # review queue surfaces this event.
            candidate.validate_rejection_reason = reason or None
            rejected.append(candidate)
        else:
            confirmed.append(candidate)

    return confirmed, rejected, latency, tokens
