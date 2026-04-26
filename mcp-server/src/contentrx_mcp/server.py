"""ContentRX MCP server entry point.

Exposes four tools, three resources, and one prompt to any MCP client
(Claude Code, Cursor, Claude desktop, …):

Tools:
  - evaluate_copy(text, moment_hint?, context?) — full content-design
    review against the standards library
  - classify_moment(text) — what UI moment is this string? (cheap,
    no quota cost)
  - explain_violation(standard_id) — rationale + examples for a
    cited rule (public, no quota cost)
  - list_standards(moment?) — filterable catalog (public, no quota cost)

Resources:
  - contentrx://standards — markdown index of every standard
  - contentrx://standards/{id} — single standard rendered as markdown
  - contentrx://moments — full moments taxonomy + weights as markdown

Prompt:
  - review_ui_copy(focus?) — multi-step workflow that walks a file or
    diff calling the tools above and summarises violations by severity

Both LLM-cost tools (evaluate_copy, classify_moment) require
`CONTENTRX_API_KEY`. The catalog tools and resources work without one
so a developer browsing the spec doesn't need an account.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from .auth import AuthError
from .client import (
    AuthFailedError,
    ContentRXError,
    CustomExample,
    QuotaExhaustedError,
    RateLimitError,
    open_client,
    open_optional_client,
)
from .prompts import build_review_ui_copy_prompt
from .resources import (
    render_moments_index,
    render_standard,
    render_standards_index,
)

mcp = FastMCP("contentrx")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


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
        A dict with `verdict` (one of "pass" | "violation" |
        "review_recommended" | "error"), `review_reason` (typed
        subtype when verdict is "review_recommended"; null otherwise),
        `violations` (list of {issue, suggestion, severity, confidence}),
        and `warnings` (list of advisory strings, may be empty).

        Schema 2.0.0 (ADR 2026-04-25). Substrate fields (standard_id,
        rule_version, rationale_chain, moment, passes, summary,
        content_type) are not part of this response — the moat is
        operational (the engine's accuracy + calibration log), not in
        exposing the rule taxonomy.
    """
    _ = context
    try:
        async with open_client() as client:
            result = await client.check(text=text, moment=moment_hint)
    except (AuthError, AuthFailedError, QuotaExhaustedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {
        "verdict": result.verdict,
        "review_reason": result.review_reason,
        "violations": result.violations,
        "warnings": result.warnings,
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


@mcp.tool(
    description=(
        "Explain a content-design standard by ID. Returns rule, "
        "pass/fail examples, and notes. No quota cost."
    ),
)
async def explain_violation(standard_id: str) -> dict[str, Any]:
    """Look up a standard's rationale and examples.

    Args:
        standard_id: The ID of the standard to explain (e.g. "CLR-01",
            "GRM-06"). IDs come from `list_standards` or from the
            `violations[].standard_id` field of an evaluate_copy result.

    Returns:
        A dict with id, rule, correct (pass example), incorrect (fail
        example), rule_type, category, relevant_content_types, and
        content_type_notes.
    """
    try:
        async with open_optional_client() as client:
            std = await client.get_standard(standard_id=standard_id)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {
        "id": std.id,
        "rule": std.rule,
        "correct": std.correct,
        "incorrect": std.incorrect,
        "rule_type": std.rule_type,
        "category_id": std.category_id,
        "category_name": std.category_name,
        "relevant_content_types": std.relevant_content_types,
        "content_type_notes": std.content_type_notes,
    }


@mcp.tool(
    description=(
        "List all content-design standards. Optionally filter to those "
        "weighted for a given moment. No quota cost."
    ),
)
async def list_standards(moment: str | None = None) -> dict[str, Any]:
    """Browse the standards catalog.

    Args:
        moment: Optional moment ID to filter by. When provided, returns
            only the standards that the given moment emphasizes or
            relaxes (suppressed standards are excluded). Use the
            contentrx://moments resource to see valid moment IDs.

    Returns:
        A dict with `total` (int) and `standards` (list of summaries).
    """
    try:
        async with open_optional_client() as client:
            standards = await client.list_standards(moment=moment)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {
        "total": len(standards),
        "moment_filter": moment,
        "standards": [
            {
                "id": s.id,
                "rule": s.rule,
                "rule_type": s.rule_type,
                "relevant_content_types": s.relevant_content_types,
            }
            for s in standards
        ],
    }


# ---------------------------------------------------------------------------
# Custom examples — Team-plan feature (human-eval build plan Session 30)
#
# Four tools let the content designer (via Claude Code / Cursor / any
# MCP client) curate team-scoped short-circuit entries. The team's
# /api/check hits skip the LLM when a stored example matches, so the
# team's recurring voice calls don't get re-evaluated every time.
# ---------------------------------------------------------------------------


@mcp.tool(
    description=(
        "Mark a string as a team custom example so subsequent evaluations "
        "of it short-circuit to the stored verdict. Team admin only. "
        "Use when the content designer explicitly confirms a phrasing is "
        "deliberate (pass) or known-bad (violation) for the team's voice."
    ),
)
async def custom_example_add(
    text: str,
    verdict: str,
    moment: str | None = None,
    content_type: str | None = None,
    standard_id: str | None = None,
    notes: str | None = None,
    contribute_upstream: bool = False,
) -> dict[str, Any]:
    """Add a custom example.

    Args:
        text: The exact string the team wants short-circuited. Matching
            is case-insensitive + whitespace-normalised at scan time.
        verdict: "pass" — the string is correct for this team.
            "violation" — the string is known bad; pair with standard_id.
        moment: Optional — scope the match to this moment only
            (e.g., "confirmation", "error_recovery"). When omitted the
            entry matches in any moment context.
        content_type: Optional — scope the match to this content_type
            only (e.g., "button_cta").
        standard_id: Required for verdict="violation"; names the standard
            the team asserts fires on this string.
        notes: 1–3 sentences explaining why this entry exists. Surfaced
            to team members when the short-circuit fires.
        contribute_upstream: Default false. Set true to opt this example
            into anonymised contribution to the ContentRX content model
            when Robo reviews. Off means team-private; the example
            never leaves the team's scope.

    Returns:
        A dict with the created entry's id, text, verdict, moment,
        content_type, standard_id, notes, contribute_upstream, and
        timestamps. On failure, a typed error dict.
    """
    try:
        async with open_client() as client:
            entry = await client.add_custom_example(
                text=text,
                verdict=verdict,
                moment=moment,
                content_type=content_type,
                standard_id=standard_id,
                notes=notes,
                contribute_upstream=contribute_upstream,
            )
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return _example_as_dict(entry)


@mcp.tool(
    description=(
        "List the team's custom examples. Read-only; any authenticated "
        "team member sees the set. Helpful before proposing an add so "
        "duplicates are caught."
    ),
)
async def custom_example_list(limit: int | None = None) -> dict[str, Any]:
    """List entries.

    Args:
        limit: Optional max entries to return. Defaults to 50 (server
            side). Max is 500 — the per-team cap.

    Returns:
        A dict with `count`, `cap`, and `examples` (list of dicts with
        the same fields custom_example_add returns).
    """
    try:
        async with open_client() as client:
            result = await client.list_custom_examples(limit=limit)
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {
        "count": result.count,
        "cap": result.cap,
        "examples": [_example_as_dict(e) for e in result.examples],
    }


@mcp.tool(
    description=(
        "Check whether a string is already covered by a team custom "
        "example. Call this before custom_example_add to avoid "
        "duplicate-entry errors."
    ),
)
async def custom_example_search(text: str) -> dict[str, Any]:
    """Look up by text.

    Args:
        text: The string to check. Normalisation matches the server
            — case + whitespace insensitive.

    Returns:
        A dict with `examples` (0 or 1 match — the uniqueness
        constraint guarantees at most one per team per normalised
        string) and `covered` (bool convenience).
    """
    try:
        async with open_client() as client:
            result = await client.search_custom_examples(text=text)
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {
        "covered": result.count > 0,
        "examples": [_example_as_dict(e) for e in result.examples],
    }


@mcp.tool(
    description=(
        "Delete a team custom example by id. Team admin only. Use when "
        "a phrasing the team previously green-lit is retired or "
        "replaced."
    ),
)
async def custom_example_remove(example_id: str) -> dict[str, Any]:
    """Remove one entry.

    Args:
        example_id: The id from custom_example_list / _add / _search.

    Returns:
        A dict with `ok: true` and the removed `id`, or a typed error
        dict on 404 / auth failure.
    """
    try:
        async with open_client() as client:
            await client.remove_custom_example(example_id=example_id)
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {"ok": True, "id": example_id}


def _example_as_dict(entry: "CustomExample") -> dict[str, Any]:
    """Shape a CustomExample dataclass as the MCP tool return dict."""
    return {
        "id": entry.id,
        "text": entry.text,
        "verdict": entry.verdict,
        "moment": entry.moment,
        "content_type": entry.content_type,
        "standard_id": entry.standard_id,
        "notes": entry.notes,
        "contribute_upstream": entry.contribute_upstream,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------


@mcp.resource(
    "contentrx://standards",
    name="ContentRX standards",
    description="Index of every content-design standard in the library.",
    mime_type="text/markdown",
)
async def standards_index_resource() -> str:
    """Markdown directory listing all standards. No auth required."""
    async with open_optional_client() as client:
        standards = await client.list_standards()
    return render_standards_index(standards)


@mcp.resource(
    "contentrx://standards/{standard_id}",
    name="ContentRX standard",
    description="A single content-design standard rendered as markdown.",
    mime_type="text/markdown",
)
async def standard_resource(standard_id: str) -> str:
    """Markdown for one standard. No auth required."""
    async with open_optional_client() as client:
        std = await client.get_standard(standard_id=standard_id)
    return render_standard(std)


@mcp.resource(
    "contentrx://moments",
    name="ContentRX moments",
    description="The 13 UI moments + each one's standards-weight adjustments.",
    mime_type="text/markdown",
)
async def moments_resource() -> str:
    """Markdown of the moments taxonomy. No auth required."""
    async with open_optional_client() as client:
        moments = await client.list_moments()
    return render_moments_index(moments)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


@mcp.prompt(
    description=(
        "Review every UI copy string in a file or diff. Walks each "
        "string through classify_moment + evaluate_copy and summarises "
        "violations by severity, citing standards."
    ),
)
def review_ui_copy(focus: str | None = None) -> str:
    """Build the multi-step review workflow.

    Args:
        focus: Optional file path, diff snippet, or single string to
            scope the review. When omitted, the LLM is told to use the
            file/diff currently in context.
    """
    return build_review_ui_copy_prompt(focus)


# ---------------------------------------------------------------------------
# Error envelope + entry point
# ---------------------------------------------------------------------------


def _typed_error(exc: Exception) -> dict[str, Any]:
    """Turn API errors into structured tool results.

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
