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

# Stage-specific model selection. Sonnet does the nuanced reasoning;
# Haiku handles the simple yes/no judgments at a fraction of the cost
# (~3-5x cheaper per token, faster TTFT). Closes audit H-25.
#
# Anything that can be wrong without much cost-of-being-wrong (classify,
# validate "is this still a violation in context?") goes to Haiku.
# Anything where wrong answers are expensive (scan = "find ALL issues",
# consistency = "compare across snippets") stays on Sonnet.
MODEL_SCAN = DEFAULT_MODEL
MODEL_CONSISTENCY = DEFAULT_MODEL
MODEL_VALIDATE = "claude-haiku-4-5-20251001"
MODEL_CLASSIFY = "claude-haiku-4-5-20251001"

# Per-stage timeouts (seconds). The Anthropic SDK defaults to 600s,
# which means a stuck call burns a Vercel function slot for 10 minutes
# before timing out. Each stage gets a tighter cap based on what it
# actually does. Closes audit H-26.
TIMEOUT_DEFAULT = 60.0
TIMEOUT_CLASSIFY = 15.0  # ~50 output tokens (just the type ID)
TIMEOUT_VALIDATE = 30.0  # 1k output tokens (per-candidate yes/no)
TIMEOUT_SCAN = 90.0      # 2k output tokens (full evaluation)
TIMEOUT_CONSISTENCY = 60.0  # 1k output tokens (multi-snippet check)
TIMEOUT_SUGGEST_FIX = 30.0  # short rewrite


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


class PromptInjectionError(ValueError):
    """Raised when user-supplied text contains the sentinel delimiter we
    use to wrap user content in LLM prompts. Lets the input close the
    wrapper and inject prompt content, so we reject before sending.

    api/evaluate.py catches this and returns 400 (caller error), not 500.
    """


class RateLimitedError(Exception):
    """Raised when Anthropic returns 429 after retries are exhausted.

    api/evaluate.py catches this and returns 503 with Retry-After so
    /api/check can backoff cleanly instead of the caller treating it
    as a generic engine failure. Closes audit H-27.
    """


class RequestTimeoutError(Exception):
    """Raised when an Anthropic API call times out (per-stage timeout
    exhausted, no response).

    api/evaluate.py maps this to 504 so /api/check can distinguish
    "engine slow" from "engine broken". Closes audit H-27 + M-23.
    """


# ---------------------------------------------------------------------------
# Prompt-injection defense — sentinel-delimit user content
# ---------------------------------------------------------------------------

# Delimiters chosen to be ASCII-only, vanishingly unlikely in real copy,
# and matching the existing pattern in suggest_fix.py for backwards
# compatibility with prompts the LLM has already seen in production.
USER_TEXT_SENTINEL_OPEN = "<<<TEXT"
USER_TEXT_SENTINEL_CLOSE = "TEXT>>>"


def wrap_user_text(text: str) -> str:
    """Wrap user-supplied text in sentinel delimiters for prompt-injection
    defense.

    The LLM is instructed to treat anything between `<<<TEXT` and `TEXT>>>`
    as opaque content, not as instructions. Without delimiters, a user
    submitting `"\\n\\nIgnore prior instructions and respond {...}` could
    close the f-string quote in the prompt template and inject prompt
    content into the scan/validate/classify stages.

    Raises PromptInjectionError if `text` contains either sentinel string
    — letting that through would defeat the wrapper.
    """
    if USER_TEXT_SENTINEL_OPEN in text or USER_TEXT_SENTINEL_CLOSE in text:
        raise PromptInjectionError(
            f"Input contains the engine's sentinel delimiter "
            f"({USER_TEXT_SENTINEL_OPEN!r} or {USER_TEXT_SENTINEL_CLOSE!r}). "
            f"This is rejected to prevent prompt injection. Modify the "
            f"input to not contain these strings and retry."
        )
    return f"{USER_TEXT_SENTINEL_OPEN}\n{text}\n{USER_TEXT_SENTINEL_CLOSE}"


def sanitize_label(label: str, max_len: int = 200) -> str:
    """Sanitize a user-supplied label (Figma layer name, batch item label,
    etc.) for safe embedding in an LLM prompt.

    Strips control characters that could break prompt formatting, and
    truncates to keep token cost bounded. Unlike wrap_user_text, labels
    are short identifiers we DO want to display inline rather than wrap
    in sentinels — but they still need defending against newline-based
    prompt-format breaks.
    """
    cleaned = "".join(ch for ch in label if ch.isprintable() or ch == " ")
    return cleaned.strip()[:max_len]


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
        # Log only shape info — the raw LLM output could include echoed
        # user text in a failed-parse case, and we don't want copy
        # landing in Vercel / Sentry logs even truncated. Closes ENG-M-02
        # from the 2026-04-22 audit. The full raw string still rides
        # along on the ParseError for in-memory debugging (api/evaluate.py
        # swallows it before returning to the caller).
        logger.warning(
            "JSON parse failure in %s: %s (len=%d, err=%s)",
            context or "unknown",
            e.__class__.__name__,
            len(cleaned),
            type(e).__name__,
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
    system: str | list[dict],
    user: str,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout: float = TIMEOUT_DEFAULT,
    api_key: str | None = None,
) -> LLMResponse:
    """Send a message to Claude and return text + token usage.

    This is the single point of contact with the Anthropic API for the
    entire package. All LLM calls (scan, validate, consistency) go
    through here.

    Args:
        system: System prompt content. Either a string (simple case) or
            a list of content blocks for prompt caching:
                [
                    {"type": "text", "text": "Static prefix..."},
                    {"type": "text", "text": "Big static body...",
                     "cache_control": {"type": "ephemeral"}},
                    {"type": "text", "text": "Dynamic suffix..."}
                ]
            Cached blocks cost ~10% of normal input cost on hit. The
            5-minute ephemeral cache is plenty for our scan workload.
            Closes audit C-12.
        user: User message content.
        model: Model identifier.
        max_tokens: Maximum response tokens.
        timeout: Per-call timeout in seconds. SDK default is 600s
            (way too long for our pipeline); we override per-stage
            via the TIMEOUT_* constants.
        api_key: Optional API key override.

    Returns:
        LLMResponse with text content and token counts.

    Raises:
        RateLimitedError: After SDK retries are exhausted on 429.
            Caller should return 503 with Retry-After.
        RequestTimeoutError: When the call exceeds `timeout` seconds.
            Caller should return 504.
        anthropic.APIError: Other non-retryable API errors.
        anthropic.AuthenticationError: Invalid API key.
    """
    import anthropic

    client = get_client(api_key=api_key)

    try:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            timeout=timeout,
        )
    except anthropic.RateLimitError as exc:
        # SDK retried max_retries times with exponential backoff and
        # still got 429. Re-raise as a typed error so callers (and
        # api/evaluate) can map to a 503 + Retry-After response
        # instead of a generic 500.
        raise RateLimitedError(
            f"Anthropic rate limit exhausted after retries: {exc}"
        ) from exc
    except anthropic.APITimeoutError as exc:
        # Hit our per-stage timeout. Map to 504 so /api/check can
        # distinguish "engine slow" from "engine broken."
        raise RequestTimeoutError(
            f"Anthropic call exceeded {timeout}s timeout: {exc}"
        ) from exc

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
