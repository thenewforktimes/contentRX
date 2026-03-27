"""Pipeline orchestrator for the content standards checker.

Composes the 5 stages: classify, filter, preprocess, scan, validate.
Each stage is a separate function call — no boolean flags to toggle behavior.
Use check() for the full pipeline, or call individual stages directly.
"""

from __future__ import annotations

import json
import time

from content_checker.classify import classify, classify_heuristic
from content_checker.filter import filter_standards, get_content_type_descriptions
from content_checker.models import (
    CheckResult,
    PassedStandard,
    PipelineMeta,
    TokenUsage,
    Violation,
)
from content_checker.preprocess import run_preprocess
from content_checker.standards.loader import load_standards
from content_checker.validate import validate_candidates


def build_system_prompt(standards_data: dict, content_type: str | None = None) -> str:
    """Build the system prompt with embedded standards.

    Accepts either the full or filtered standards library.
    """
    standards_text = ""
    for cat in standards_data["categories"]:
        standards_text += f"\n## {cat['name']}\n"
        for std in cat["standards"]:
            standards_text += f"\n### {std['id']}: {std['rule']}\n"
            standards_text += f"- Correct: {std['correct']}\n"
            standards_text += f"- Incorrect: {std['incorrect']}\n"

    content_type_line = ""
    if content_type:
        content_type_line = (
            f"\nThis content has been classified as: **{content_type}**. "
            "Evaluate it with this content type in mind.\n"
        )

    return (
        "You are a content standards checker for UX and UI copy. "
        "You evaluate whether a piece of copy meets established content standards.\n"
        f"{content_type_line}\n"
        f"Here are the standards you check against:\n{standards_text}\n\n"
        "## How to evaluate\n\n"
        "1. Check the content against the standards listed above, applying these rules:\n"
        "   - **Only flag clear, unambiguous violations.** If you are less than 90% "
        "confident something is a violation, it is not a violation. When in doubt, "
        "the content passes.\n"
        "   - **Read the literal text exactly as written.** Do not assume or hallucinate "
        "characters. If you are checking capitalization, verify each word character by "
        'character. "Account settings" has a lowercase "s" — do not flag it as title case.\n'
        "   - **Do not flag content for standards that are only marginally relevant.** "
        "A standard must clearly apply to the content type and context.\n"
        "   - **Do not flag stylistic preferences as violations.** If the content "
        "communicates clearly and follows the spirit of the standards, minor stylistic "
        "variations are acceptable.\n"
        "   - **Default verdict is pass.** Content should only fail when there are clear "
        "violations that would meaningfully hurt the user experience.\n\n"
        "2. For each genuine violation, cite the standard ID, explain what is wrong, "
        "and suggest a fix.\n\n"
        "3. Give an overall pass/fail verdict. A single minor issue does not automatically "
        "mean fail — use judgment about whether the content is good enough to ship.\n\n"
        "Respond in this exact JSON format (no markdown, no backticks):\n"
        "{\n"
        f'  "content_type": "{content_type or "detected type"}",\n'
        '  "overall_verdict": "pass" or "fail",\n'
        '  "violations": [\n'
        "    {\n"
        '      "standard_id": "the standard ID",\n'
        '      "rule": "the rule text",\n'
        '      "issue": "what\'s wrong with the content",\n'
        '      "suggestion": "how to fix it"\n'
        "    }\n"
        "  ],\n"
        '  "passes": [\n'
        "    {\n"
        '      "standard_id": "the standard ID",\n'
        '      "rule": "brief rule description"\n'
        "    }\n"
        "  ],\n"
        '  "summary": "1-2 sentence plain language summary of the assessment"\n'
        "}"
    )


def _llm_scan(
    text: str,
    standards_data: dict,
    content_type: str | None,
    model: str,
) -> tuple[dict, float, TokenUsage]:
    """Run the LLM scan stage. Returns (parsed_result, latency, tokens)."""
    import anthropic

    prompt_ct = None if content_type == "unfiltered" else content_type
    system_prompt = build_system_prompt(standards_data, content_type=prompt_ct)

    if prompt_ct:
        user_message = f'Check this {content_type} content against the standards:\n\n"{text}"'
    else:
        user_message = f'Check this content against the standards:\n\n"{text}"'

    client = anthropic.Anthropic()

    start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=2000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    latency = time.time() - start

    tokens = TokenUsage(
        input=response.usage.input_tokens,
        output=response.usage.output_tokens,
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {
            "content_type": content_type or "unknown",
            "overall_verdict": "error",
            "violations": [],
            "passes": [],
            "summary": f"Failed to parse response: {raw[:200]}",
        }

    return result, latency, tokens


def _parse_llm_violations(raw_violations: list[dict]) -> list[Violation]:
    """Convert raw LLM violation dicts to Violation objects."""
    return [
        Violation(
            standard_id=v.get("standard_id", ""),
            rule=v.get("rule", ""),
            issue=v.get("issue", ""),
            suggestion=v.get("suggestion", ""),
            source="llm",
        )
        for v in raw_violations
    ]


def _parse_llm_passes(raw_passes: list[dict]) -> list[PassedStandard]:
    """Convert raw LLM pass dicts to PassedStandard objects."""
    return [
        PassedStandard(
            standard_id=p.get("standard_id", ""),
            rule=p.get("rule", ""),
        )
        for p in raw_passes
    ]


# ---------------------------------------------------------------------------
# Public API: three entry points for three use cases
# ---------------------------------------------------------------------------


def check(
    text: str,
    content_type: str | None = None,
    model: str = "claude-sonnet-4-20250514",
    use_llm_classifier: bool = True,
) -> tuple[CheckResult, float, TokenUsage]:
    """Full pipeline: classify → filter → preprocess → scan → validate.

    This is the primary entry point for real-world usage.

    Args:
        text: The content to check.
        content_type: If provided, skips classification.
        model: Claude model for all LLM calls.
        use_llm_classifier: Use LLM for classification (True) or heuristic (False).

    Returns:
        (CheckResult, total_latency, total_tokens)
    """
    standards_data = load_standards()
    total_latency = 0.0
    total_tokens = TokenUsage()

    # Stage 1: Classify
    if content_type:
        detected_type = content_type
    else:
        ct_descriptions = get_content_type_descriptions(standards_data)
        detected_type, cls_latency, cls_tokens = classify(
            text, content_types=ct_descriptions, model=model, use_llm=use_llm_classifier,
        )
        total_latency += cls_latency
        total_tokens += cls_tokens

    # Stage 2: Filter
    filtered = filter_standards(standards_data, detected_type)
    active_notes = filtered.get("active_notes", [])

    # Stage 3a: Deterministic preprocess (content-type-aware)
    preprocess_violations = run_preprocess(text, detected_type)
    preprocess_ids = {v.standard_id for v in preprocess_violations}
    suppressed_ids = getattr(preprocess_violations, 'suppressed_ids', set())

    # Stage 3b: LLM scan
    scan_result, scan_latency, scan_tokens = _llm_scan(
        text, filtered, detected_type, model,
    )
    total_latency += scan_latency
    total_tokens += scan_tokens

    llm_violations = _parse_llm_violations(scan_result.get("violations", []))
    llm_passes = _parse_llm_passes(scan_result.get("passes", []))

    # Deduplicate: preprocess wins on conflicts
    # Also suppress LLM violations for standards the preprocessor definitively passed
    excluded_ids = preprocess_ids | suppressed_ids
    llm_candidates = [v for v in llm_violations if v.standard_id not in excluded_ids]

    # Stage 4: Validate
    if llm_candidates:
        confirmed, rejected, val_latency, val_tokens = validate_candidates(
            text, detected_type, llm_candidates,
            active_notes=active_notes, model=model,
        )
        total_latency += val_latency
        total_tokens += val_tokens
    else:
        confirmed, rejected = [], []

    # Stage 5: Merge
    final_violations = list(preprocess_violations) + confirmed
    flagged_ids = {v.standard_id for v in final_violations}
    final_passes = [p for p in llm_passes if p.standard_id not in flagged_ids]

    result = CheckResult(
        content_type=detected_type,
        overall_verdict="fail" if final_violations else "pass",
        violations=final_violations,
        passes=final_passes,
        summary=scan_result.get("summary", ""),
        pipeline=PipelineMeta(
            standards_checked=filtered.get("filtered_count", 0),
            standards_total=filtered.get("total_count", 0),
            preprocess_violations=len(preprocess_violations),
            llm_candidates=len(llm_candidates),
            validated_confirmed=len(confirmed),
            validated_rejected=len(rejected),
        ),
    )

    return result, total_latency, total_tokens


def check_unfiltered(
    text: str,
    model: str = "claude-sonnet-4-20250514",
) -> tuple[CheckResult, float, TokenUsage]:
    """Preprocess + single LLM call with all standards. No filtering, no validation.

    Used for library evals where synthetic test strings need the full rulebook
    without content type context.
    """
    standards_data = load_standards()

    # Deterministic preprocess
    preprocess_violations = run_preprocess(text)
    preprocess_ids = {v.standard_id for v in preprocess_violations}
    suppressed_ids = getattr(preprocess_violations, 'suppressed_ids', set())

    # LLM scan with full standards, no content type
    scan_result, latency, tokens = _llm_scan(
        text, standards_data, "unfiltered", model,
    )

    llm_violations = _parse_llm_violations(scan_result.get("violations", []))
    llm_passes = _parse_llm_passes(scan_result.get("passes", []))

    # Merge (no validation)
    # Post-processing suppression: exclude both preprocess violation IDs
    # and standards the preprocessor definitively passed
    excluded_ids = preprocess_ids | suppressed_ids
    llm_only = [v for v in llm_violations if v.standard_id not in excluded_ids]
    final_violations = list(preprocess_violations) + llm_only
    flagged_ids = {v.standard_id for v in final_violations}
    final_passes = [p for p in llm_passes if p.standard_id not in flagged_ids]

    result = CheckResult(
        content_type="unfiltered",
        overall_verdict="fail" if final_violations else "pass",
        violations=final_violations,
        passes=final_passes,
        summary=scan_result.get("summary", ""),
        pipeline=PipelineMeta(
            standards_checked=standards_data.get("total_standards", 46),
            standards_total=standards_data.get("total_standards", 46),
            preprocess_violations=len(preprocess_violations),
            llm_candidates=len(llm_only),
        ),
    )

    return result, latency, tokens
