"""Rewrite a flagged string to clear a specific standard's violation.

BUILD_PLAN_v2 Session 17. The LSP server (and eventually the web
dashboard + Figma plugin) call through this function when a user
asks for a one-click "apply suggested rewrite" action.

Scope decision: the rewriter is *targeted* — it takes a single
(standard_id, issue) pointer and rewrites only to clear that
specific call-out. We deliberately don't try to "improve the copy
generally." A broad rewrite is harder to trust and often makes
multiple standards' violations worse.

Output contract: plain rewritten string, nothing else. No JSON, no
preface, no explanation. The LSP code action pipes it straight into
a WorkspaceEdit. Whitespace at the ends gets trimmed to prevent
stray newlines from landing in the document.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from content_checker.api_utils import DEFAULT_MODEL, LLMResponse, create_message


# Keep max_tokens modest — rewrites of microcopy are short. Large
# values here would just burn tokens without improving output.
_MAX_TOKENS = 400


@dataclass(frozen=True)
class SuggestFixResult:
    rewritten: str
    latency_ms: int
    input_tokens: int
    output_tokens: int


def suggest_fix(
    *,
    text: str,
    standard_id: str,
    rule: str | None = None,
    issue: str | None = None,
    current_suggestion: str | None = None,
    model: str = DEFAULT_MODEL,
) -> SuggestFixResult:
    """Rewrite `text` to clear the violation described by `standard_id`.

    Args:
        text: The flagged UI copy. Required.
        standard_id: The standard that fired (e.g. "ACT-01"). Required.
        rule: The standard's prescription from the library. Optional —
            helps the rewriter understand what "pass" looks like.
        issue: The specific violation call-out from the engine
            (e.g. "uses a generic CTA verb"). Optional — a rewrite
            without the issue text usually works but is less targeted.
        current_suggestion: The hint the engine already emitted
            alongside the violation (e.g. "Use a more specific
            verb"). Optional — the rewriter treats this as a seed.
        model: Claude model. Defaults to the package default.

    Returns:
        `SuggestFixResult` with the rewritten text and token usage.
    """
    system = _build_system_prompt(
        standard_id=standard_id,
        rule=rule,
        issue=issue,
    )
    user = _build_user_prompt(
        text=text,
        current_suggestion=current_suggestion,
    )

    started = time.perf_counter()
    response: LLMResponse = create_message(
        system=system,
        user=user,
        model=model,
        max_tokens=_MAX_TOKENS,
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    rewritten = response.text.strip()
    # Claude occasionally wraps the rewrite in quotes. Strip one layer
    # of balanced wrapping so `"Save changes"` → `Save changes`.
    rewritten = _strip_wrapping_quotes(rewritten)

    return SuggestFixResult(
        rewritten=rewritten,
        latency_ms=elapsed_ms,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
    )


def _build_system_prompt(
    *,
    standard_id: str,
    rule: str | None,
    issue: str | None,
) -> str:
    rule_line = (
        f"Standard: {standard_id} — {rule.strip()}\n"
        if rule
        else f"Standard: {standard_id}\n"
    )
    issue_line = f"Specific issue: {issue.strip()}\n" if issue else ""

    return (
        "You are ContentRX, a content-design assistant. Your job right now "
        "is ONE thing: rewrite a short piece of UI copy so it no longer "
        "violates a specific standard. Nothing else.\n\n"
        f"{rule_line}"
        f"{issue_line}"
        "\nRules for your output:\n"
        "- Return ONLY the rewritten text. No explanation, no preface, no "
        'JSON, no markdown, no surrounding quotes.\n'
        "- Keep the rewrite approximately the same length. UI copy has "
        "tight space constraints.\n"
        "- Preserve the original's tone and voice. Don't make it breezy if "
        "the original is neutral.\n"
        "- Make only the changes needed to clear the standard. Do not "
        "'improve' the copy in other ways.\n"
        "- If the original is already fine and the violation is wrong, "
        "return the original text unchanged."
    )


def _build_user_prompt(
    *,
    text: str,
    current_suggestion: str | None,
) -> str:
    # Sentinel-delimit the input text via the centralized helper. This
    # also rejects (raises PromptInjectionError) inputs containing the
    # sentinel itself — closing audit H-11 (sentinels were used here
    # but escape wasn't validated, so a copy literally containing
    # `TEXT>>>` could break out).
    from content_checker.api_utils import wrap_user_text

    parts = [
        "Original copy to rewrite:",
        wrap_user_text(text),
    ]
    if current_suggestion:
        parts.append("")
        parts.append(f"Previous hint from the engine: {current_suggestion}")
    return "\n".join(parts)


def _strip_wrapping_quotes(text: str) -> str:
    """Remove one balanced pair of `"` or `'` wrapping the text."""
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ('"', "'"):
        return text[1:-1]
    return text
