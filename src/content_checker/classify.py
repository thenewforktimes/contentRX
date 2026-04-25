"""Content type classifier for the content standards checker.

LLM-based classifier that reads the content type taxonomy from the standards
library. Falls back to a heuristic when no API key is available.
"""

from __future__ import annotations

import time

from content_checker.models import TokenUsage


def classify_heuristic(text: str) -> str:
    """Fast, zero-cost heuristic classifier. Used as fallback."""
    text_lower = text.lower().strip()
    words = text_lower.split()
    length = len(words)

    if length <= 15 and any(w in text_lower for w in [
        "error", "fail", "couldn't", "can't", "unable", "went wrong",
        # "problem" and "issue" removed — Opendoor triage Cluster 6.
        # These words appear frequently in instructional/presentation
        # content ("care about the problem") where error_message
        # classification triggers false positives. Accepted tradeoff:
        # heuristic-only false negatives on rare error messages that use
        # only "problem" as their signal. The LLM classifier is the
        # primary path and still catches these correctly.
        "oops", "sorry", "unexpected",
    ]):
        return "error_message"

    if length <= 20 and ("?" not in text_lower) and any(w in text_lower for w in [
        "success", "done", "complete", "ready", "saved", "sent",
        "created", "updated", "deleted", "confirmed", "verified",
        "published", "applied", "removed", "added",
    ]):
        return "confirmation"

    if length <= 5 and any(w in text_lower for w in [
        "click", "tap", "save", "delete", "create", "submit", "cancel",
        "confirm", "sign", "log", "get started", "try", "upgrade",
        "download", "send", "export", "import", "connect", "start",
        "continue", "next", "back", "done", "apply", "remove", "add",
        "edit", "update", "share", "copy", "move", "open", "close",
    ]):
        return "button_cta"

    if length <= 30 and "?" in text_lower:
        return "tooltip_microcopy"
    if length <= 8:
        return "ui_label"
    if length <= 40:
        return "short_ui_copy"
    return "long_form_copy"


def _build_classifier_prompt(content_types: list[dict]) -> str:
    """Build the system prompt for the LLM classifier."""
    type_descriptions = ""
    type_ids = []
    for ct in content_types:
        type_descriptions += f"\n- **{ct['id']}**: {ct['description']}"
        type_ids.append(ct["id"])

    return (
        "You are a content type classifier for UI and UX copy. "
        "Your job is to identify what kind of content a piece of text is.\n\n"
        f"Here are the content types:{type_descriptions}\n\n"
        "Respond with ONLY the content type ID. No explanation, no punctuation, "
        "no quotes. Just the ID.\n\n"
        "If the text could fit multiple types, pick the most specific one. "
        'For example, "Your changes are saved" is a confirmation, not short_ui_copy, '
        "even though it's short.\n\n"
        f"Valid IDs: {', '.join(type_ids)}"
    )


def classify_llm(
    text: str,
    content_types: list[dict],
    model: str = "claude-sonnet-4-20250514",
) -> tuple[str, float, TokenUsage]:
    """Classify content type using an LLM call.

    Returns (content_type_id, latency_seconds, token_usage).
    """
    # Route through the shared Anthropic client in api_utils so retry
    # config and future telemetry apply uniformly across the pipeline.
    # Closes ENG-M-01 from the 2026-04-22 audit.
    from content_checker.api_utils import get_client, wrap_user_text

    system_prompt = _build_classifier_prompt(content_types)
    valid_ids = [ct["id"] for ct in content_types]

    client = get_client()

    # Sentinel-delimit user text — even classify is injectable
    # (a successful injection could steer content_type to alter
    # downstream pipeline routing).
    wrapped = wrap_user_text(text)

    start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=50,
        system=system_prompt,
        messages=[{"role": "user", "content": f"Classify this content:\n\n{wrapped}"}],
    )
    latency = time.time() - start

    tokens = TokenUsage(
        input=response.usage.input_tokens,
        output=response.usage.output_tokens,
    )

    raw = response.content[0].text.strip().lower()

    if raw in valid_ids:
        return raw, latency, tokens

    for type_id in valid_ids:
        if type_id in raw:
            return type_id, latency, tokens

    return classify_heuristic(text), latency, tokens


def classify(
    text: str,
    content_types: list[dict] | None = None,
    model: str = "claude-sonnet-4-20250514",
    use_llm: bool = True,
) -> tuple[str, float, TokenUsage]:
    """Classify content type. Main entry point.

    Returns (content_type_id, latency_seconds, token_usage).
    """
    if not use_llm or content_types is None:
        return classify_heuristic(text), 0.0, TokenUsage()

    return classify_llm(text, content_types, model=model)
