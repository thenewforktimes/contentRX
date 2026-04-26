"""LSP code actions for ContentRX diagnostics.

BUILD_PLAN_v2 Session 17; restructured for schema 2.0.0 (ADR
2026-04-25). For every ContentRX diagnostic, we expose two actions:

1. **Replace with suggested rewrite** (Quick Fix). Calls
   `/api/suggest-fix` and applies the returned text as a
   `WorkspaceEdit` on the diagnostic's range. Deferred — the
   suggest-fix call happens when the user invokes the action, not at
   diagnostic-emit time, so we don't burn LLM tokens on actions
   nobody clicks.

2. **Mark as false positive**. Posts to `/api/violations/override`
   with `override_type: mark_false_positive`. Reuses the override
   capture infrastructure from BUILD_PLAN_v2 Session 11.

The pre-pivot "Show standard rationale" action was removed in 2.0.0
because the public `docs.contentrx.io/model/standards/<id>` pages no
longer exist — the taxonomy is private. False-positive overrides
still work without a `standard_id`; the override is keyed on the
rendered text + extracted byte range.

This module stays pure — no network I/O. The server wires the
actions to actual HTTP calls + workspace edits. Lets us unit-test
the action shaping without mocking pygls.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lsprotocol import types as lsp


# Command identifiers — the LSP client (VS Code extension, etc.)
# registers matching handlers. Namespaced under `contentrx.` so we
# don't collide with anything the editor or another extension ships.
CMD_APPLY_SUGGESTION = "contentrx.applySuggestion"
CMD_MARK_FALSE_POSITIVE = "contentrx.markFalsePositive"


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

    Both the "rewrite" and "mark as false positive" actions key on the
    rendered issue+text rather than a substrate `standard_id`. Review-
    recommended diagnostics emit only the false-positive action.
    """
    issue = diagnostic_data.get("issue") or ""
    suggestion = diagnostic_data.get("suggestion") or ""
    extracted_text = diagnostic_data.get("extracted_text") or ""

    plans: list[ActionPlan] = []

    has_actionable_violation = bool(issue or suggestion)

    if has_actionable_violation:
        plans.append(
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
                    }
                ],
            )
        )

    plans.append(
        ActionPlan(
            title="Mark as false positive",
            kind=lsp.CodeActionKind.QuickFix.value,
            command=CMD_MARK_FALSE_POSITIVE,
            arguments=[
                {
                    "uri": document_uri,
                    "issue": issue,
                    "text": extracted_text,
                }
            ],
        )
    )

    return plans


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
