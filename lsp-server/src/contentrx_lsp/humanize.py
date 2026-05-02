"""Customer-facing labels for ContentRX verdicts and severities.

Mirror of `src/lib/humanize.ts` (web app), `cli-client/contentrx/
humanize.py`, `github-action/src/humanize.py`, and `mcp-server/src/
contentrx_mcp/humanize.py`. Each surface keeps its own copy because
the LSP server is a thin HTTP client that doesn't import from the
engine. The vocabulary is locked by ADR 2026-04-29 §9 — keep all
five surfaces in sync when that vocabulary updates.

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


# Mirror of REVIEW_REASON_LABELS in src/lib/humanize.ts. Keep in sync.
_REVIEW_REASON_LABELS: dict[str, str] = {
    "low_confidence": "We weren't fully sure about this one",
    "standards_conflict": "Two rules pointed different directions",
    "ensemble_disagreement": "Worth a closer look. We're not certain",
    "situation_ambiguity": "Hard to tell what kind of copy this is",
    "out_of_distribution": "Unfamiliar shape. Your eyes will help",
    "novel_pattern": "This rule is shifting. Double-check",
    "low_confidence_mixed_signals": "Mixed signals. Worth a second pass",
    "high_confidence_mixed_signals": "Confident, but signals are mixed",
}


def humanize_review_reason(value: str | None) -> str:
    """Return a customer-facing label for a substrate review_reason
    enum, or empty string for falsy input.

    Used to enrich `review_recommended` LSP diagnostics with a plain-
    language reason. The substrate enums leak engine-pipeline
    vocabulary that doesn't belong in an editor hover tooltip.

    Defensive fallback for unknown values returns the raw string
    sentence-cased.
    """
    if not value:
        return ""
    if value in _REVIEW_REASON_LABELS:
        return _REVIEW_REASON_LABELS[value]
    spaced = value.replace("_", " ").strip()
    return spaced[:1].upper() + spaced[1:] if spaced else value
