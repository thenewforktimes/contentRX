"""Prebuilt prompt definitions exposed to MCP clients.

A prompt in MCP is a reusable workflow the user can invoke from their
client (e.g. `/review_ui_copy` in Claude desktop or Cursor). FastMCP
turns each function decorated with `@mcp.prompt()` into one of these.

The text returned here is what the LLM receives — written so that any
LLM client can execute the workflow without further coaching, by
chaining the contentrx-mcp tools.

Two prompts ship today:

  * review_ui_copy           — per-string review for UI surfaces.
                               Walks each string through
                               classify_moment + evaluate_copy and
                               surfaces violations grouped by severity.
  * review_team_communication — single-call review for long-form
                               team writing (product updates, security
                               disclosures, all-hands pre-reads,
                               policy notices). Calls evaluate_copy
                               once on the entire draft; the engine
                               routes inputs over 200 chars to the
                               document-tier review automatically.
"""

from __future__ import annotations


def build_review_team_communication_prompt(draft: str | None = None) -> str:
    """Build the review_team_communication prompt text (Phase F4).

    Long-form team comms — product update emails, security disclosures,
    all-hands pre-reads, internal announcements, policy notices — are
    the workstream Phase F is positioning ContentRX for. The engine
    routes inputs over 200 chars to the document-tier review
    server-side; this prompt instructs the LLM client to call
    evaluate_copy once on the entire draft and surface the structured
    review, instead of per-string iteration.

    `draft` is an optional override — the literal text of the draft,
    or a path/file the LLM should pull the draft from. When omitted,
    the prompt asks the LLM to use whatever the user has open or has
    most recently shared.
    """
    if draft and draft.strip():
        target_clause = (
            "Review this draft team communication:\n\n"
            f"{draft.strip()}\n"
        )
    else:
        target_clause = (
            "Review the team communication the user is drafting. Use the "
            "file or recent message in context. If neither is available, "
            "ask the user to paste the draft.\n"
        )
    return (
        target_clause
        + "\n"
        + (
            "Call `evaluate_copy(text)` once with the entire draft as "
            "`text`. Don't split the draft into sentences and don't loop "
            "per-paragraph: the engine routes inputs over 200 characters "
            "to a document-tier review server-side and returns a single "
            "structured response with categorized flags.\n"
            "\n"
            "When you receive the response, summarize in this exact "
            "shape:\n"
            "\n"
            "## Verdict\n"
            "_Render the `verdict_label` and the count of flags. "
            "Example: `Worth a look. 4 flags across 3 categories.`_\n"
            "\n"
            "## Flags by category\n"
            "_Group `violations` by `category` and render each group "
            "as a heading. Under each heading, list the flags as bullets: "
            "quote the issue, then the suggested rewrite. Categories "
            "you'll commonly see: Plain language, Voice & tone, Active "
            "voice, Inclusive language, Accessibility, Big picture._\n"
            "\n"
            "## What to do\n"
            "_One short paragraph naming the highest-leverage edit. "
            "Specific. No 'consider whether'._\n"
            "\n"
            "Calibration note: the engine is calibrated for product "
            "and internal writing. For persuasive marketing copy, "
            "expect more 'worth a look' flags than usual; treat them "
            "as register signal, not error."
        )
    )


def build_review_ui_copy_prompt(focus: str | None = None) -> str:
    """Build the review_ui_copy prompt text.

    `focus` is an optional override the user supplies via the prompt
    arguments — e.g., a file path, a diff, or a single string they want
    reviewed. When omitted, the prompt asks the LLM to find UI copy in
    the current context (open file, recent diff, etc.).
    """
    if focus and focus.strip():
        target_clause = (
            f"Review the UI copy in this material:\n\n{focus.strip()}\n"
        )
    else:
        target_clause = (
            "Review the UI copy in the file or diff currently in context. "
            "If neither is available, ask the user which file or strings "
            "to review.\n"
        )
    return (
        target_clause
        + "\n"
        + (
            "For every distinct user-facing string (button labels, error "
            "messages, headings, body copy, microcopy, etc.):\n"
            "\n"
            "1. Call `classify_moment(text)` to understand what UI moment "
            "the string lives in.\n"
            "2. Call `evaluate_copy(text, moment_hint=<moment from step 1>)` "
            "to get the verdict + violations.\n"
            "\n"
            "When you've reviewed every string, summarize the results in "
            "this exact shape:\n"
            "\n"
            "## Summary\n"
            "- N strings reviewed\n"
            "- N violations found\n"
            "- N strings recommend manual review\n"
            "\n"
            "## Violations by severity\n"
            "_Group violations by severity (high → medium → low). For "
            "each violation, quote the offending string, state the issue "
            "in plain language, and propose a rewrite._\n"
            "\n"
            "Stay specific. No generic advice."
        )
    )
