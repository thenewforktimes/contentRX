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
        # "problem" and "issue" removed (decision 2026-04-27, audit
        # follow-up) — Opendoor triage Cluster 6 surfaced false
        # positives where instructional/presentation content ("care
        # about the problem") was classifying as error_message.
        # Accepted tradeoff: heuristic-only false negatives on rare
        # error messages that use ONLY "problem" as their signal. The
        # LLM classifier is the primary path and still catches these
        # correctly. If a customer reports the false-negative case,
        # add the keywords back AND tighten by requiring 2+ signal
        # words; don't just re-add and hope.
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


def _build_classifier_prompt(content_types: dict[str, str]) -> str:
    """Build the system prompt for the LLM classifier.

    `content_types` is the {id: description} mapping that
    `filter.get_content_type_descriptions` returns; iterating gives
    (id, description) pairs directly. The previous list[dict] shape
    was the engine's pre-pivot wire format and never matched what
    pipeline.check() has been passing — TypeError #200427.
    """
    type_descriptions = ""
    type_ids: list[str] = []
    for ct_id, ct_desc in content_types.items():
        type_descriptions += f"\n- **{ct_id}**: {ct_desc}"
        type_ids.append(ct_id)

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
    content_types: dict[str, str],
    model: str | None = None,
) -> tuple[str, float, TokenUsage]:
    """Classify content type using an LLM call.

    Returns (content_type_id, latency_seconds, token_usage).
    """
    # Route through create_message so retry config + per-stage timeout +
    # typed RateLimitedError/RequestTimeoutError handling apply uniformly.
    # Previously called client.messages.create directly, which closed
    # ENG-M-01 from the 2026-04-22 audit but still bypassed the
    # centralized boundary. Now fully aligned with H-10.
    from content_checker.api_utils import (
        MODEL_CLASSIFY,
        TIMEOUT_CLASSIFY,
        create_message,
        wrap_user_text,
    )

    system_prompt = _build_classifier_prompt(content_types)
    valid_ids = list(content_types.keys())

    # Sentinel-delimit user text — even classify is injectable
    # (a successful injection could steer content_type to alter
    # downstream pipeline routing).
    wrapped = wrap_user_text(text)

    start = time.time()
    llm_response = create_message(
        system=system_prompt,
        user=f"Classify this content:\n\n{wrapped}",
        model=model or MODEL_CLASSIFY,
        max_tokens=50,
        timeout=TIMEOUT_CLASSIFY,
    )
    latency = time.time() - start

    tokens = TokenUsage(
        input=llm_response.input_tokens,
        output=llm_response.output_tokens,
        cache_creation_input=llm_response.cache_creation_input_tokens,
        cache_read_input=llm_response.cache_read_input_tokens,
    )

    raw = llm_response.text.strip().lower()

    if raw in valid_ids:
        return raw, latency, tokens

    for type_id in valid_ids:
        if type_id in raw:
            return type_id, latency, tokens

    return classify_heuristic(text), latency, tokens


def classify(
    text: str,
    content_types: dict[str, str] | None = None,
    model: str = "claude-sonnet-4-20250514",
    use_llm: bool = True,
) -> tuple[str, float, TokenUsage]:
    """Classify content type. Main entry point.

    Returns (content_type_id, latency_seconds, token_usage).
    """
    if not use_llm or content_types is None:
        return classify_heuristic(text), 0.0, TokenUsage()

    return classify_llm(text, content_types, model=model)
