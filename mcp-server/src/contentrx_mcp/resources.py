"""Markdown formatters for the contentrx:// resources.

Resources in MCP are read-only data the LLM can pull into its context.
We render them as markdown rather than raw JSON so the LLM gets prose +
structure instead of a brittle schema it has to parse — same reason the
docs site renders standards as MDX rather than JSON tables.
"""

from __future__ import annotations

from .client import (
    MomentEntry,
    StandardDetail,
    StandardSummary,
)


def render_standards_index(standards: list[StandardSummary]) -> str:
    """Render the contentrx://standards directory as markdown."""
    lines = [
        "# ContentRX standards",
        "",
        f"{len(standards)} standards in the library. ",
        "Use the `list_standards` tool to filter by moment, ",
        "or `explain_violation(standard_id)` for any rule below.",
        "",
        "| ID | Rule | Type |",
        "| --- | --- | --- |",
    ]
    for s in standards:
        rule = (s.rule or "").replace("|", r"\|").replace("\n", " ")
        rule_type = s.rule_type or "—"
        lines.append(f"| `{s.id}` | {rule} | {rule_type} |")
    return "\n".join(lines)


def render_standard(standard: StandardDetail) -> str:
    """Render a single standard as markdown."""
    parts: list[str] = [
        f"# {standard.id}",
        "",
        f"**Category:** {standard.category_name or standard.category_id or '—'}  ",
        f"**Rule type:** {standard.rule_type or '—'}",
        "",
        "## Rule",
        "",
        standard.rule or "_(no rule text)_",
    ]

    if standard.correct:
        parts += ["", "## Pass example", "", f"> {standard.correct}"]
    if standard.incorrect:
        parts += ["", "## Fail example", "", f"> {standard.incorrect}"]

    if standard.relevant_content_types:
        parts += [
            "",
            "## Relevant content types",
            "",
            *[f"- `{ct}`" for ct in standard.relevant_content_types],
        ]

    if standard.content_type_notes:
        parts += ["", "## Notes by content type", ""]
        for ct, note in standard.content_type_notes.items():
            label = "_All_" if ct == "_global" else f"`{ct}`"
            parts += [f"### {label}", "", note, ""]

    return "\n".join(parts)


def render_moments_index(moments: list[MomentEntry]) -> str:
    """Render the contentrx://moments resource as markdown."""
    lines = [
        "# ContentRX moments",
        "",
        f"{len(moments)} moments in the taxonomy. The moment a string ",
        "lives in shapes which standards apply, and how strictly. ",
        "Use the `list_standards(moment=...)` tool to see which rules ",
        "matter for a given moment.",
        "",
    ]
    for m in moments:
        lines += [
            f"## `{m.id}`",
            "",
            m.description or "_(no description)_",
            "",
        ]
        if not m.weighted_standards:
            lines += ["_No standards-weight adjustments — uses the defaults._", ""]
            continue
        lines += ["**Standards weights:**", ""]
        for w in m.weighted_standards:
            lines += [f"- `{w.standard_id}` ({w.modifier}): {w.rationale}"]
        lines += [""]
    return "\n".join(lines)
