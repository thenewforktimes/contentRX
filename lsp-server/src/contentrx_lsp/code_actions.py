"""LSP code actions for ContentRX diagnostics.

BUILD_PLAN_v2 Session 17; restructured for schema 2.0.0 (ADR
2026-04-25). The LSP exposes one quick fix per diagnostic:

**Replace with suggested rewrite** — calls `/api/suggest-fix` and
applies the returned text as a `WorkspaceEdit` on the diagnostic's
range. Deferred — suggest-fix runs when the user invokes the action,
not at diagnostic-emit time, so we don't burn LLM tokens on actions
nobody clicks.

The "Mark as false positive" action was dropped post-2.0.0:
`/api/violations/override` keys overrides on `standard_id` (substrate),
which schema 2.0.0 strips from public diagnostics. The override
surface lives in the dashboard, where the user's own action data
includes the standard_id naturally.

This module stays pure — no network I/O. The server wires the action
to actual HTTP calls + workspace edits. Lets us unit-test the shaping
without mocking pygls.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lsprotocol import types as lsp


CMD_APPLY_SUGGESTION = "contentrx.applySuggestion"


@dataclass(frozen=True)
class ActionPlan:
    """Plan for a single code action attached to a diagnostic.

    Kept as a plain dataclass (not an lsp.CodeAction yet) so tests
    can inspect it without the full lsprotocol types and the server
    can translate it into the protocol types at emit time.
    """

    title: str
    kind: str  # lsp.CodeActionKind value as string
    command: str | None
    arguments: list[Any]


def plan_actions_for_diagnostic(
    diagnostic_data: dict[str, Any], document_uri: str
) -> list[ActionPlan]:
    """Derive the ActionPlans for a given diagnostic.

    `diagnostic_data` is the `data` field on the LSP diagnostic the
    server emitted — same shape as `LspDiagnostic.data` in
    `diagnostics.py`. Schema 2.0.0 strips `standard_id` and `docs_url`
    from that dict; we operate on `issue`, `suggestion`, and
    `extracted_text` plus the byte offsets.

    Returns at most one rewrite action — review-recommended
    diagnostics with no issue or suggestion produce no actions.
    """
    issue = diagnostic_data.get("issue") or ""
    suggestion = diagnostic_data.get("suggestion") or ""
    extracted_text = diagnostic_data.get("extracted_text") or ""

    if not (issue or suggestion):
        return []

    return [
        ActionPlan(
            title="Rewrite with ContentRX suggestion",
            kind=lsp.CodeActionKind.QuickFix.value,
            command=CMD_APPLY_SUGGESTION,
            arguments=[
                {
                    "uri": document_uri,
                    "issue": issue,
                    "current_suggestion": suggestion,
                    "text": extracted_text,
                    # Forward the diagnostic's original byte offsets
                    # so apply_suggestion targets the exact JSX node
                    # that fired, not the first matching string in
                    # the document. Closes audit M-27.
                    "start_byte": diagnostic_data.get("start_byte"),
                    "end_byte": diagnostic_data.get("end_byte"),
                },
            ],
        ),
    ]


def plan_to_code_action(
    plan: ActionPlan, diagnostic: lsp.Diagnostic | None = None
) -> lsp.CodeAction:
    """Translate a pure ActionPlan into the protocol's CodeAction.

    When the diagnostic is supplied, we attach it to the action so
    the editor can group actions by their source diagnostic.
    """
    return lsp.CodeAction(
        title=plan.title,
        kind=lsp.CodeActionKind(plan.kind),
        command=lsp.Command(
            title=plan.title,
            command=plan.command,
            arguments=plan.arguments,
        )
        if plan.command
        else None,
        diagnostics=[diagnostic] if diagnostic else None,
    )
