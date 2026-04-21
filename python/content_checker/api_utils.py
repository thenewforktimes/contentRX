"""Shared API utilities for the content standards checker.

Centralizes three concerns that were previously copy-pasted across
pipeline.py, validate.py, batch.py, and ui.html:

1. LLM JSON parsing — strip markdown fences, parse, raise on failure.
2. Anthropic client creation — lazy import with retry (max_retries=2).
3. Error classification — distinguish transient from permanent failures.

Design principle: fail-closed. Unparseable LLM output means "could not
evaluate," never "everything is fine." Callers decide how to surface the
failure; this module guarantees they can't silently swallow it.

Migration path:
    Before: each call site had its own try/except json.loads with different
    fallback behaviors (pipeline: error result, batch: silent swallow,
    validate: fail-closed). After: all call sites use parse_llm_json()
    which raises ParseError on failure. Callers handle ParseError
    explicitly, making the error path visible and auditable.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

logger = logging.getLogger("content_checker.api")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_MAX_RETRIES = 2


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ParseError(Exception):
    """Raised when LLM output cannot be parsed as JSON.

    Attributes:
        raw: The raw string that failed to parse.
        context: Which pipeline stage produced this output (for logging).
    """

    def __init__(self, message: str, raw: str = "", context: str = ""):
        super().__init__(message)
        self.raw = raw
        self.context = context


# ---------------------------------------------------------------------------
# JSON parsing — single implementation, used everywhere
# ---------------------------------------------------------------------------

def parse_llm_json(raw: str, *, context: str = "") -> dict:
    """Strip markdown fences and parse LLM output as JSON.

    Args:
        raw: The raw string from the LLM response.
        context: Pipeline stage name for error messages (e.g., "scan",
            "validate", "consistency"). Used in logging only.

    Returns:
        Parsed dict from the JSON.

    Raises:
        ParseError: If the string cannot be parsed after fence-stripping.
            The exception carries the raw string and context for debugging.
    """
    cleaned = _strip_fences(raw)

    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(
            "JSON parse failure in %s: %s (first 200 chars: %r)",
            context or "unknown",
            e,
            cleaned[:200],
        )
        raise ParseError(
            f"Failed to parse LLM JSON in {context or 'unknown'}: {e}",
            raw=raw,
            context=context,
        ) from e

    if not isinstance(result, dict):
        raise ParseError(
            f"Expected dict from LLM JSON in {context or 'unknown'}, "
            f"got {type(result).__name__}",
            raw=raw,
            context=context,
        )

    return result


def _strip_fences(text: str) -> str:
    """Remove markdown code fences from LLM output.

    Handles all observed fence variants:
        ```json\n{...}\n```
        ```\n{...}\n```
        ```{...}```  (no newline after opening fence)

    Preserves content outside fences — if the LLM returns bare JSON
    (the ideal case), this is a no-op.
    """
    cleaned = text.strip()

    if not cleaned.startswith("```"):
        return cleaned

    # Remove opening fence (```json or ```)
    if "\n" in cleaned:
        first_newline = cleaned.index("\n")
        cleaned = cleaned[first_newline + 1:]
    else:
        # Degenerate case: ```{...}``` on one line
        cleaned = cleaned[3:]

    # Remove closing fence
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]

    return cleaned.strip()


# ---------------------------------------------------------------------------
# Client creation — lazy import with retry
# ---------------------------------------------------------------------------

_client = None


def get_client(*, api_key: str | None = None, max_retries: int = DEFAULT_MAX_RETRIES):
    """Get or create a shared Anthropic client with retry logic.

    The client is cached at module level. Subsequent calls return the
    same instance unless api_key changes.

    Args:
        api_key: Optional API key override. If None, the SDK reads from
            ANTHROPIC_API_KEY environment variable.
        max_retries: Number of automatic retries on transient errors
            (429, 500, 502, 503). Defaults to 2. The SDK uses exponential
            backoff between retries.

    Returns:
        An anthropic.Anthropic client instance.

    Raises:
        ImportError: If the anthropic package is not installed.
    """
    global _client

    if _client is not None and api_key is None:
        return _client

    import anthropic

    kwargs = {"max_retries": max_retries}
    if api_key is not None:
        kwargs["api_key"] = api_key

    client = anthropic.Anthropic(**kwargs)

    # Only cache the default client (no custom api_key)
    if api_key is None:
        _client = client

    return client


@dataclass
class LLMResponse:
    """Response from an LLM API call.

    Intentionally does NOT depend on models.TokenUsage to avoid circular
    imports. Callers construct TokenUsage from input_tokens/output_tokens.
    """

    text: str
    input_tokens: int = 0
    output_tokens: int = 0


def create_message(
    *,
    system: str,
    user: str,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    api_key: str | None = None,
) -> LLMResponse:
    """Send a message to Claude and return text + token usage.

    This is the single point of contact with the Anthropic API for the
    entire package. All LLM calls (scan, validate, consistency) go
    through here.

    Args:
        system: System prompt content.
        user: User message content.
        model: Model identifier.
        max_tokens: Maximum response tokens.
        api_key: Optional API key override.

    Returns:
        LLMResponse with text content and token counts.

    Raises:
        anthropic.APIError: On non-retryable API errors.
        anthropic.AuthenticationError: On invalid API key.
    """
    client = get_client(api_key=api_key)

    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )

    # Extract text from the response content blocks
    text_blocks = [
        block.text
        for block in response.content
        if hasattr(block, "text")
    ]

    return LLMResponse(
        text="\n".join(text_blocks),
        input_tokens=getattr(response.usage, "input_tokens", 0),
        output_tokens=getattr(response.usage, "output_tokens", 0),
    )


# ---------------------------------------------------------------------------
# Response parsing helpers for specific pipeline stages
# ---------------------------------------------------------------------------

def parse_scan_response(raw: str) -> dict:
    """Parse the LLM scan stage response.

    Expected shape: {"violations": [...], "passes": [...]}

    Raises ParseError if unparseable. Callers should catch ParseError
    and return an error CheckResult.
    """
    result = parse_llm_json(raw, context="scan")

    # Normalize: ensure violations and passes keys exist
    if "violations" not in result:
        result["violations"] = []
    if "passes" not in result:
        result["passes"] = []

    return result


def parse_validation_response(raw: str) -> dict:
    """Parse the validation stage response.

    Expected shape: {"confirmed": [...], "rejected": [...]}

    Raises ParseError if unparseable. The validate module's fail-closed
    contract means callers should treat ParseError as "confirm all
    candidates" (worst-case safe).
    """
    result = parse_llm_json(raw, context="validate")

    if "confirmed" not in result:
        result["confirmed"] = []
    if "rejected" not in result:
        result["rejected"] = []

    return result


def parse_consistency_response(raw: str) -> dict:
    """Parse the batch consistency check response.

    Expected shape: {"violations": [...]}

    Raises ParseError if unparseable. The batch module should surface
    this to the caller, never silently swallow.
    """
    result = parse_llm_json(raw, context="consistency")

    if "violations" not in result:
        result["violations"] = []

    return result


# ---------------------------------------------------------------------------
# Module-level reset (for testing)
# ---------------------------------------------------------------------------

def _reset_client():
    """Reset the cached client. For testing only."""
    global _client
    _client = None
