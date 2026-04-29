"""Customer-facing labels for ContentRX verdicts and severities.

Mirror of `src/lib/humanize.ts` (web app), `cli-client/contentrx/
humanize.py`, `github-action/src/humanize.py`, and
`lsp-server/src/contentrx_lsp/humanize.py`. Each surface keeps its
own copy because the MCP server is a thin HTTP client that doesn't
import from the engine. The vocabulary is locked by ADR 2026-04-29
§9 — keep all five surfaces in sync when that vocabulary updates.

The MCP server exposes BOTH the raw substrate enums (for LLM-side
flow control) AND the humanized labels (for LLM-rendered summaries
back to the user). LLM clients should prefer `verdict_label` and
`severity_label` when surfacing findings to the user.

See cli-client/contentrx/humanize.py for the locked label table.
"""


def humanize_verdict(
    verdict: str,
    finding_count: int = 0,
    has_ship_blocker: bool = False,
) -> tuple[str, str]:
    """Return (label, tone) for a substrate verdict."""
    if verdict == "pass":
        return ("All clear", "emerald")
    if verdict == "review_recommended":
        return ("Worth a look", "amber")
    if verdict == "violation":
        if has_ship_blocker:
            return ("Adjust before shipping", "red")
        if finding_count == 1:
            return ("1 finding to adjust", "amber")
        return (f"{finding_count} findings to adjust", "amber")
    spaced = verdict.replace("_", " ").strip()
    return (spaced[:1].upper() + spaced[1:] if spaced else verdict, "amber")


def humanize_severity(
    severity: str,
    is_ship_blocker: bool = False,
) -> tuple[str, str]:
    """Return (label, tone) for a substrate severity."""
    if is_ship_blocker and severity == "high":
        return ("Don't ship", "red")
    if severity in ("high", "medium"):
        return ("Worth adjusting", "amber")
    if severity == "low":
        return ("Quick polish", "stone")
    spaced = severity.replace("_", " ").strip()
    return (spaced[:1].upper() + spaced[1:] if spaced else severity, "stone")
