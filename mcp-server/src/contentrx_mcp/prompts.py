"""Prebuilt prompt definitions exposed to MCP clients.

A prompt in MCP is a reusable workflow the user can invoke from their
client (e.g. `/review_ui_copy` in Claude desktop or Cursor). FastMCP
turns each function decorated with `@mcp.prompt()` into one of these.

The text returned here is what the LLM receives — written so that any
LLM client can execute the workflow without further coaching, by
chaining the contentrx-mcp tools.
"""

from __future__ import annotations


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
