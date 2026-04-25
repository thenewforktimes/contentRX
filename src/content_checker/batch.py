"""Batch handler for the content standards checker.

Checks multiple content items through the pipeline, then runs cross-snippet
consistency standards (CON-01, CON-04, TRN-07) across the full set.

This is the module that makes Figma multi-select and code scanning work.
Single-string mode can't detect terminology inconsistency — batch mode can.
"""

from __future__ import annotations

import logging
import time

from content_checker.api_utils import (
    create_message,
    parse_llm_json,
    sanitize_label,
    wrap_user_text,
    ParseError,
    DEFAULT_MODEL,
)
from content_checker.filter import get_multi_snippet_standards
from content_checker.models import (
    BatchResult,
    ConsistencyViolation,
    ContentItem,
    ItemResult,
    TokenUsage,
)
from content_checker.pipeline import check
from content_checker.standards.loader import load_standards

logger = logging.getLogger("content_checker.batch")


def _build_consistency_prompt(multi_standards: list[dict]) -> str:
    """Build the system prompt for cross-snippet consistency checking."""
    standards_text = ""
    for std in multi_standards:
        standards_text += f"\n### {std['id']}: {std['rule']}\n"
        standards_text += f"- Correct: {std['correct']}\n"
        standards_text += f"- Incorrect: {std['incorrect']}\n"

    return (
        "You are a content consistency checker. You review a set of UI copy strings "
        "that appear in the same product or flow, and check whether they use terminology "
        "consistently.\n\n"
        f"Check against these standards:\n{standards_text}\n\n"
        "Review all the strings as a set. Look for:\n"
        "- Different words used for the same concept (e.g., 'settings' in one place "
        "and 'preferences' in another)\n"
        "- Different verbs for the same action (e.g., 'delete' and 'remove' for the "
        "same operation)\n"
        "- Synonyms that could confuse translators or users\n\n"
        "Only flag genuine inconsistencies where the same concept is referred to with "
        "different terms. Different terms for genuinely different concepts are acceptable.\n\n"
        "If no consistency issues are found, return an empty violations list.\n\n"
        "Respond in this exact JSON format (no markdown, no backticks):\n"
        "{\n"
        '  "violations": [\n'
        "    {\n"
        '      "standard_id": "the standard ID",\n'
        '      "issue": "describe the inconsistency",\n'
        '      "suggestion": "which term to standardize on and why",\n'
        '      "items_involved": ["the specific strings that conflict"]\n'
        "    }\n"
        "  ]\n"
        "}"
    )


def _check_consistency(
    items: list[ContentItem],
    model: str = DEFAULT_MODEL,
) -> tuple[list[ConsistencyViolation] | None, float, TokenUsage]:
    """Run cross-snippet consistency checks across all items.

    Only runs if there are 2+ items. Checks CON-01, CON-04, and TRN-07.

    Returns (violations, latency, tokens).

    On parse failure, returns (None, latency, tokens) instead of silently
    returning an empty list. The caller must distinguish "checked and clean"
    (empty list) from "check failed" (None).
    """
    if len(items) < 2:
        return [], 0.0, TokenUsage()

    standards_data = load_standards()

    # Get the multi-snippet standard IDs
    multi_ids = set(get_multi_snippet_standards(standards_data))
    if not multi_ids:
        return [], 0.0, TokenUsage()

    # Collect the full standard objects
    multi_standards = []
    for cat in standards_data["categories"]:
        for std in cat["standards"]:
            if std["id"] in multi_ids:
                multi_standards.append(std)

    system_prompt = _build_consistency_prompt(multi_standards)

    # Build the user message with all strings. Sentinel-delimit each
    # item.text so a prompt-injected snippet can't break out and
    # rewrite the consistency-check prompt. label is sanitized — it's
    # often a Figma layer name, which is user-controlled and could
    # contain newlines / control chars that break prompt formatting.
    items_text = "Here are the content strings to check for consistency:\n\n"
    for i, item in enumerate(items, 1):
        raw_label = item.label or f"String {i}"
        label = sanitize_label(raw_label)
        wrapped = wrap_user_text(item.text)
        items_text += f"{i}. [{label}]\n{wrapped}\n"

    start = time.time()
    llm_response = create_message(
        system=system_prompt,
        user=items_text,
        model=model,
        max_tokens=1000,
    )
    latency = time.time() - start

    tokens = TokenUsage(
        input=llm_response.input_tokens,
        output=llm_response.output_tokens,
    )

    try:
        result = parse_llm_json(llm_response.text, context="consistency")
    except ParseError as e:
        # Fail-closed: return None so the caller knows the check failed.
        # Previous behavior silently returned [] which is indistinguishable
        # from "checked and found no issues" — a dangerous false negative.
        logger.warning("Consistency check parse failure: %s", e)
        return None, latency, tokens

    violations = []
    # Look up rule text for each violation
    rule_lookup = {std["id"]: std["rule"] for std in multi_standards}

    for v in result.get("violations", []):
        std_id = v.get("standard_id", "")
        violations.append(
            ConsistencyViolation(
                standard_id=std_id,
                rule=rule_lookup.get(std_id, ""),
                issue=v.get("issue", ""),
                suggestion=v.get("suggestion", ""),
                items_involved=v.get("items_involved", []),
            )
        )

    return violations, latency, tokens


def check_batch(
    items: list[ContentItem],
    model: str = DEFAULT_MODEL,
    use_llm_classifier: bool = True,
    skip_consistency: bool = False,
) -> BatchResult:
    """Check a batch of content items through the full pipeline.

    Runs each item through check() individually, then runs cross-snippet
    consistency standards across the full set.

    Args:
        items: Content items to check.
        model: Claude model for all LLM calls.
        use_llm_classifier: Use LLM for classification.
        skip_consistency: Skip the cross-snippet consistency check.

    Returns:
        BatchResult with per-item results and consistency violations.
    """
    batch = BatchResult()

    # Phase 1: Check each item individually
    for item in items:
        content_type = item.content_type or None

        result, latency, tokens = check(
            item.text,
            content_type=content_type,
            model=model,
            use_llm_classifier=use_llm_classifier,
        )

        batch.item_results.append(
            ItemResult(item=item, result=result, latency=latency, tokens=tokens)
        )
        batch.total_latency += latency
        batch.total_tokens += tokens

    # Phase 2: Cross-snippet consistency check
    if not skip_consistency and len(items) >= 2:
        consistency_violations, con_latency, con_tokens = _check_consistency(
            items, model=model,
        )
        # None means the consistency check failed to parse — surface this
        # rather than treating it as "no issues found"
        if consistency_violations is None:
            logger.warning(
                "Consistency check failed for batch of %d items. "
                "Results may be incomplete.",
                len(items),
            )
            batch.consistency_violations = []
        else:
            batch.consistency_violations = consistency_violations
        batch.total_latency += con_latency
        batch.total_tokens += con_tokens

    # Determine overall verdict
    any_item_failed = any(
        r.result.overall_verdict == "fail" for r in batch.item_results
    )
    has_consistency_issues = len(batch.consistency_violations) > 0

    if any_item_failed or has_consistency_issues:
        batch.overall_verdict = "fail"
    else:
        batch.overall_verdict = "pass"

    return batch
