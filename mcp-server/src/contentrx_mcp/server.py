"""ContentRX MCP server entry point.

Exposes two tools to any MCP client (Claude Code, Cursor, Claude
desktop, …):

  - evaluate_copy(text, moment_hint?, context?) — full content-design
    review against the standards library
  - classify_moment(text) — what UI moment is this string? (cheap,
    no quota cost)

Both are thin wrappers over the public ContentRX API. Auth is the
`CONTENTRX_API_KEY` env var the MCP client passes through (see README).

Tool descriptions are deliberately verb-first and under 120 chars per
BUILD_PLAN_v2 Session 4 acceptance criteria — this is what the MCP
client surfaces to the LLM so it knows when to call which tool.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from .auth import AuthError
from .client import (
    AuthFailedError,
    ContentRXError,
    QuotaExhaustedError,
    RateLimitError,
    open_client,
)

mcp = FastMCP("contentrx")


@mcp.tool(
    description=(
        "Check UI copy against content-design standards. Returns "
        "violations with rule citations and severity."
    ),
)
async def evaluate_copy(
    text: str,
    moment_hint: str | None = None,
    context: str | None = None,
) -> dict[str, Any]:
    """Run a full content-design review on a string.

    Args:
        text: The string to evaluate (button label, error message, paragraph, etc.).
        moment_hint: Optional moment override — e.g., "error_recovery", "onboarding".
            If omitted, the engine classifies it from the text itself.
        context: Optional free-text context for the LLM — e.g., "this is in
            an emergency-shutdown dialog". Currently ignored at the API
            boundary; reserved for the v2 Session 9 envelope.

    Returns:
        A dict with overall_verdict ("pass" | "fail" | "error"),
        content_type, moment, violations (list with standard_id + issue +
        suggestion + severity), passes, and summary.
    """
    _ = context  # reserved for future schema; included so the tool surface
                 # already shapes the call site once Session 9 wires it.
    try:
        async with open_client() as client:
            result = await client.check(text=text, moment=moment_hint)
    except (AuthError, AuthFailedError, QuotaExhaustedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {
        "overall_verdict": result.overall_verdict,
        "content_type": result.content_type,
        "moment": result.moment,
        "violations": result.violations,
        "passes": result.passes,
        "summary": result.summary,
    }


@mcp.tool(
    description=(
        "Classify the UI moment a string represents — error, empty "
        "state, CTA, confirmation, etc. No quota cost."
    ),
)
async def classify_moment(text: str) -> dict[str, Any]:
    """Decide what kind of UI moment a string is, without running a full review.

    Useful before writing copy: pick the moment first, then write to it.
    Cheaper than evaluate_copy — does not count against monthly quota.

    Args:
        text: The string to classify.

    Returns:
        A dict with content_type and moment.
    """
    try:
        async with open_client() as client:
            result = await client.classify(text=text)
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {"content_type": result.content_type, "moment": result.moment}


def _typed_error(exc: Exception) -> dict[str, Any]:
    """Turn auth / quota / rate-limit / generic API errors into structured tool results.

    Returning a dict with `error` lets the MCP client render a clean
    inline message instead of surfacing a stack trace, which is the v2
    Session 4 acceptance criterion: "Rate limit responses (429) surface
    as retryable MCP errors, not as stack traces."
    """
    out: dict[str, Any] = {"error": str(exc), "kind": type(exc).__name__}
    if isinstance(exc, RateLimitError):
        out["retry_after_seconds"] = exc.retry_after_seconds
    return out


def main() -> None:
    """Console-script entry point. `uvx contentrx-mcp` lands here."""
    mcp.run()


if __name__ == "__main__":
    main()
