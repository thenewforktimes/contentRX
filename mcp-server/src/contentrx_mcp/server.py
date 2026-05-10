"""ContentRX MCP server entry point.

Exposes the content-design review tools to any MCP client (Claude Code,
Cursor, Claude desktop, …):

Tools:
  - evaluate_copy(text, moment_hint?, context?) — full review against
    the standards library
  - evaluate_copy_batch(strings, …) — many strings in one call, with a
    dry_run gate for batches of 10+
  - classify_moment(text) — what UI moment is this string? (cheap, no
    quota cost)
  - team_rule_{add,list,update,remove} — Team-plan curation of
    disable / override / add rules that govern whole patterns of
    strings

Prompts:
  - review_ui_copy(focus?) — multi-step workflow that walks a file or
    diff calling the tools above and summarises violations by severity
  - review_team_communication(draft?) — single-call workflow for long-
    form team writing (announcements, security disclosures, all-hands
    pre-reads, policy notices). Calls evaluate_copy once on the whole
    draft and summarises flags by category

All tools require `CONTENTRX_API_KEY`. The taxonomy is private per ADR
2026-04-25 — no surface here renders standard IDs or rule text.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from .auth import AuthError
from .display_labels import display_label_for
from .humanize import humanize_severity, humanize_verdict
from .client import (
    AuthFailedError,
    ContentRXError,
    QuotaExhaustedError,
    RateLimitError,
    TeamRule,
    open_client,
)
from .prompts import (
    build_review_team_communication_prompt,
    build_review_ui_copy_prompt,
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
            result = await client.check(
                text=text,
                moment=moment_hint,
            )
    except (AuthError, AuthFailedError, QuotaExhaustedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    # Schema 2.0.0 wire format. The raw substrate enums (`verdict`,
    # `severity`) stay on the response so LLM clients can do flow
    # control (e.g. branch on verdict == "violation"), but per ADR
    # 2026-04-29 §9 we also ship `verdict_label` + per-violation
    # `severity_label` so the LLM can surface the calmer customer-
    # facing copy directly without re-rendering the substrate enum.
    #
    # The violation projection below is explicit-pick rather than
    # spread (`{**v, ...}`). Defense-in-depth: /api/check already
    # strips substrate, but if a future regression or PUBLIC_TAXONOMY
    # mode flip leaks substrate fields into `result.violations`, the
    # spread would have propagated them through the MCP boundary.
    # The explicit projection forecloses that.
    verdict_label, _ = humanize_verdict(
        result.verdict, finding_count=len(result.violations)
    )
    violations_with_labels: list[dict[str, Any]] = []
    for v in result.violations:
        sev_label, _tone = humanize_severity(v.get("severity", "medium"))
        violations_with_labels.append({
            "issue": v.get("issue", ""),
            "suggestion": v.get("suggestion", ""),
            "severity": v.get("severity", "medium"),
            "severity_label": sev_label,
            "confidence": v.get("confidence"),
            "category": v.get("category"),
        })

    return {
        "verdict": result.verdict,
        "verdict_label": verdict_label,
        "review_reason": result.review_reason,
        "violations": violations_with_labels,
        "warnings": result.warnings,
    }


@mcp.tool(
    description=(
        "Check multiple UI strings in one call. Set dry_run=true first "
        "when batch is >10 strings to preview the quota cost before "
        "running."
    ),
)
async def evaluate_copy_batch(
    strings: list[str],
    moment_hint: str | None = None,
    content_type_hint: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run content-design review across many strings in one tool call.

    PR-15 — the MCP-side dry-run gate. For batches of 10+ strings,
    call once with dry_run=true to confirm the quota cost, then call
    again with dry_run=false to actually run.

    Args:
        strings: List of UI strings to evaluate (button labels, error
            messages, paragraphs, etc.). Each string consumes one check
            from the monthly quota when dry_run=false.
        moment_hint: Optional moment override applied to every string
            in the batch (e.g. "error_recovery").
        content_type_hint: Optional content_type override applied to
            every string (e.g. "button_cta").
        dry_run: When true, no API calls go out and no quota is used.
            Returns the count + a "would consume N checks" message so
            the LLM can confirm with the user before committing.

    Returns:
        dry_run=true:
          { "dry_run": True, "string_count": N, "would_use_checks": N,
            "message": "..." }

        dry_run=false:
          { "results": [
              { "text": str, "verdict": str, "review_reason": str|None,
                "violations": [...], "warnings": [...] },
              { "text": str, "error": { "kind": str, "message": str } },
              ...
            ],
            "checks_used": N,            # successfully completed
            "terminated_early": bool,     # True if a fatal error stopped the batch
            "termination_reason": str|None }

        Schema 2.0.0 (ADR 2026-04-25): each result carries only the
        public envelope fields. Substrate (standard_id, rule_version,
        rationale_chain, moment) is stripped at the API boundary.
    """
    if not strings:
        return {
            "results": [],
            "checks_used": 0,
            "terminated_early": False,
            "termination_reason": None,
        }

    if dry_run:
        n = len(strings)
        word = "check" if n == 1 else "checks"
        return {
            "dry_run": True,
            "string_count": n,
            "would_use_checks": n,
            "message": (
                f"Would consume {n} {word}. Call again with "
                "dry_run=false to actually run the evaluation."
            ),
        }

    results: list[dict[str, Any]] = []
    checks_used = 0
    terminated_early = False
    termination_reason: str | None = None

    try:
        async with open_client() as client:
            for text in strings:
                try:
                    result = await client.check(
                        text=text,
                        moment=moment_hint,
                        content_type=content_type_hint,
                    )
                except (
                    AuthError,
                    AuthFailedError,
                    QuotaExhaustedError,
                ) as exc:
                    # Fatal — abort the rest of the batch. Authentication
                    # and quota errors will hit every subsequent request
                    # the same way; better to fail fast than to spam.
                    err = _typed_error(exc)
                    results.append({"text": text, "error": err})
                    terminated_early = True
                    termination_reason = err.get("kind")
                    break
                except (RateLimitError, ContentRXError) as exc:
                    # Per-string error, but the batch can keep going.
                    results.append({"text": text, "error": _typed_error(exc)})
                    continue

                # Same humanize + explicit-projection treatment as the
                # single-string path — see evaluate_copy() above for
                # the rationale (defense-in-depth substrate fence,
                # not just trusting /api/check to strip).
                v_label, _ = humanize_verdict(
                    result.verdict, finding_count=len(result.violations)
                )
                violations_with_labels: list[dict[str, Any]] = []
                for v in result.violations:
                    s_label, _t = humanize_severity(v.get("severity", "medium"))
                    violations_with_labels.append({
                        "issue": v.get("issue", ""),
                        "suggestion": v.get("suggestion", ""),
                        "severity": v.get("severity", "medium"),
                        "severity_label": s_label,
                        "confidence": v.get("confidence"),
                        "category": v.get("category"),
                    })
                results.append(
                    {
                        "text": text,
                        "verdict": result.verdict,
                        "verdict_label": v_label,
                        "review_reason": result.review_reason,
                        "violations": violations_with_labels,
                        "warnings": result.warnings,
                    }
                )
                checks_used += 1
    except (AuthError, AuthFailedError) as exc:
        # Couldn't even open the client — surface as a single error.
        return {
            "results": [],
            "checks_used": 0,
            "terminated_early": True,
            "termination_reason": "auth_failed",
            "error": _typed_error(exc),
        }

    return {
        "results": results,
        "checks_used": checks_used,
        "terminated_early": terminated_early,
        "termination_reason": termination_reason,
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


# ---------------------------------------------------------------------------
# Team rules — CRUD on /api/team-rules
# ---------------------------------------------------------------------------
# Team rules govern a whole pattern of strings — disable a stock
# standard, override its rule text/severity, or add a new regex-backed
# rule the team owns. Mirrors what an admin can do at /dashboard/rules;
# lets an agent author rules from inside Cursor / Claude Code without
# leaving the editor.
# ---------------------------------------------------------------------------


@mcp.tool(
    description=(
        "Add a custom team rule (disable, override, or add). Team "
        "admin only. Use when the team agrees a rule needs adjustment "
        "beyond a single string."
    ),
)
async def team_rule_add(
    action: str,
    standard_id: str | None = None,
    rule_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a team rule.

    Args:
        action: One of "disable", "override", "add".
            "disable" turns a stock standard off for this team.
            "override" replaces a stock standard's rule text, severity,
                or title (one or more of those three fields).
            "add" creates a new team-owned rule (TEAM-NN id is
                auto-generated server-side).
        standard_id: Required for "disable" and "override". Either a
            stock standard (e.g., "GRM-01") or an existing TEAM-NN id.
            Ignored for "add".
        rule_json: For "override", an object with at least one of
            {rule, severity, title}. For "add", an object with
            {title, rule, pattern} required and {severity,
            case_insensitive, content_types} optional. The pattern is
            a regex applied to incoming strings. Ignored for
            "disable".

    Returns:
        A dict with `id`, `standard_id`, `action`, `rule_json`,
        `created_at`, and `updated_at` for the created rule. On
        failure, a typed error dict.
    """
    try:
        async with open_client() as client:
            rule = await client.add_team_rule(
                action=action,
                standard_id=standard_id,
                rule_json=rule_json,
            )
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return _team_rule_as_dict(rule)


@mcp.tool(
    description=(
        "List the team's custom rules. Read-only; any authenticated "
        "team member sees the set. Helpful before proposing an add "
        "or update so duplicates surface."
    ),
)
async def team_rule_list() -> dict[str, Any]:
    """List the team's rules.

    Returns:
        A dict with `count` and `rules` (list of dicts with the same
        fields team_rule_add returns).
    """
    try:
        async with open_client() as client:
            rules = await client.list_team_rules()
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {
        "count": len(rules),
        "rules": [_team_rule_as_dict(r) for r in rules],
    }


@mcp.tool(
    description=(
        "Update an existing team rule's body by id. Team admin only. "
        "Use when sharpening a rule that already exists rather than "
        "adding a sibling."
    ),
)
async def team_rule_update(
    rule_id: str,
    rule_json: dict[str, Any],
) -> dict[str, Any]:
    """Update a team rule's body.

    Args:
        rule_id: The id from team_rule_list / team_rule_add.
        rule_json: The replacement body. Validated server-side
            against the same schema as team_rule_add for the rule's
            action ("override" or "add"). Disable rules have no
            editable fields and reject this call.

    Returns:
        The updated rule dict, or a typed error dict.
    """
    try:
        async with open_client() as client:
            rule = await client.update_team_rule(
                rule_id=rule_id,
                rule_json=rule_json,
            )
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return _team_rule_as_dict(rule)


@mcp.tool(
    description=(
        "Delete a team rule by id. Team admin only. Use when a rule "
        "is retired or replaced."
    ),
)
async def team_rule_remove(rule_id: str) -> dict[str, Any]:
    """Remove one team rule.

    Args:
        rule_id: The id from team_rule_list / team_rule_add.

    Returns:
        A dict with `ok: true` and the removed `id`, or a typed error
        dict on 404 / auth failure.
    """
    try:
        async with open_client() as client:
            await client.remove_team_rule(rule_id=rule_id)
    except (AuthError, AuthFailedError, RateLimitError) as exc:
        return _typed_error(exc)
    except ContentRXError as exc:
        return _typed_error(exc)

    return {"ok": True, "id": rule_id}


def _team_rule_as_dict(rule: "TeamRule") -> dict[str, Any]:
    """Shape a TeamRule dataclass as the MCP tool return dict.

    Per ADR 2026-04-25, the substrate `standard_id` doesn't appear in
    the response — agents identify rules by `id` (the team_rules row
    PK) for update / remove tool calls, and read `display_label`
    when surfacing the rule to the user.
    """
    return {
        "id": rule.id,
        "display_label": display_label_for(rule.standard_id),
        "action": rule.action,
        "rule_json": rule.rule_json,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


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


@mcp.prompt(
    # Roadmap (Phase F4) locks this description: verb-first, under
    # 120 chars. Length: 117 chars. Don't expand without confirming
    # the limit still holds — it's the surface that decides whether
    # an LLM client picks this prompt over a generic ask.
    description=(
        "Review a long-form team communication. Returns flags grouped "
        "by content-design category plus the highest-leverage edit."
    ),
)
def review_team_communication(draft: str | None = None) -> str:
    """Build the long-form review workflow (Phase F4).

    Different framing from review_ui_copy: same evaluate_copy tool
    underneath, single call instead of per-string iteration. The
    engine routes inputs over 200 chars to the document-tier review
    server-side, so the LLM hands the entire draft over and renders
    the structured response.

    Args:
        draft: Optional draft text or file pointer. When omitted, the
            LLM is told to use the file/message currently in context.
    """
    return build_review_team_communication_prompt(draft)


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
