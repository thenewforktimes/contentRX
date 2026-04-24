"""LSP code actions for ContentRX diagnostics.

BUILD_PLAN_v2 Session 17. For every ContentRX diagnostic, we expose
three actions:

1. **Replace with suggested rewrite** (Quick Fix). Calls
   `/api/suggest-fix` and applies the returned text as a
   `WorkspaceEdit` on the diagnostic's range. This is a *deferred*
   action — the suggest-fix call happens when the user invokes the
   action, not at diagnostic-emit time, so we don't burn LLM tokens
   on actions nobody clicks.

2. **Show standard rationale**. Opens the standard's `docs_url`
   (populated in `diagnostics.py`) in the user's browser via the
   standard LSP command `vscode.open` (VS Code / Cursor) or the
   editor's own open-external-URL equivalent.

3. **Mark as false positive**. Posts to `/api/violations/override`
   with `override_type: mark_false_positive`. Reuses the override
   capture infrastructure from BUILD_PLAN_v2 Session 11.

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
    """Derive the three ActionPlans for a given diagnostic.

    `diagnostic_data` is the `data` field on the LSP diagnostic the
    server emitted — same shape as `LspDiagnostic.data` in
    `diagnostics.py`. We read `standard_id`, `docs_url`, and
    `extracted_text` from it.

    Review-recommended diagnostics (`code == "REVIEW"`) don't get a
    rewrite action — there's no specific standard to target. They
    still get the "mark as false positive" action so a reviewer can
    dismiss noise.
    """
    standard_id = diagnostic_data.get("standard_id")
    docs_url = diagnostic_data.get("docs_url")
    extracted_text = diagnostic_data.get("extracted_text") or ""

    plans: list[ActionPlan] = []

    if standard_id:
        plans.append(
            ActionPlan(
                title=f"Rewrite to clear {standard_id}",
                kind=lsp.CodeActionKind.QuickFix.value,
                command=CMD_APPLY_SUGGESTION,
                arguments=[
                    {
                        "uri": document_uri,
                        "standard_id": standard_id,
                        "rule": diagnostic_data.get("rule") or "",
                        "issue": diagnostic_data.get("issue") or "",
                        "current_suggestion": diagnostic_data.get(
                            "suggestion"
                        )
                        or "",
                        "text": extracted_text,
                    }
                ],
            )
        )

    if docs_url:
        plans.append(
            ActionPlan(
                title="Show standard rationale",
                kind=lsp.CodeActionKind.QuickFix.value,
                # VS Code + Cursor both respond to `vscode.open` with a
                # URL argument. Other editors generally understand the
                # same command or ignore it gracefully.
                command="vscode.open",
                arguments=[docs_url],
            )
        )

    if standard_id:
        plans.append(
            ActionPlan(
                title=f"Mark as false positive ({standard_id})",
                kind=lsp.CodeActionKind.QuickFix.value,
                command=CMD_MARK_FALSE_POSITIVE,
                arguments=[
                    {
                        "uri": document_uri,
                        "standard_id": standard_id,
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
