"""Customer-facing labels for ContentRX verdicts and severities.

Mirror of `src/lib/humanize.ts` in the web app. Each surface keeps its
own copy because the CLI is a thin client that doesn't import from the
engine or the web app (per cli-client/CLAUDE.md). The vocabulary is
locked by ADR 2026-04-29 §9 — keep all five surfaces in sync when
that vocabulary updates.

The substrate enums (`pass` / `review_recommended` / `violation`,
`high` / `medium` / `low`) are render-internal. Customers see the
calmer labels here:

  pass                    → All clear
  review_recommended      → Worth a look
  violation (default)     → "N findings to adjust"
  violation + ship_blocker → Adjust before shipping

  high (default)          → Worth adjusting
  medium                  → Worth adjusting (collapses with high)
  low                     → Quick polish
  high + ship_blocker     → Don't ship

Color rule: red is reserved for ship-blockers only. Default-path
findings never emit red regardless of severity. The `ship_blocker`
flag is plumbed but not yet sourced from the public envelope; pass
False until schema 2.x adds the hard-rule signal.
"""


def humanize_verdict(
    verdict: str,
    finding_count: int = 0,
    has_ship_blocker: bool = False,
) -> tuple[str, str]:
    """Return (label, tone) for a substrate verdict.

    `tone` is one of `emerald` / `amber` / `red` and mirrors the web
    app's PillTone vocabulary; CLI callers translate that to ANSI
    colors at the render site.
    """
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
    # Defensive fallback: unknown verdict keyword.
    spaced = verdict.replace("_", " ").strip()
    return (spaced[:1].upper() + spaced[1:] if spaced else verdict, "amber")


def humanize_severity(
    severity: str,
    is_ship_blocker: bool = False,
) -> tuple[str, str]:
    """Return (label, tone) for a substrate severity.

    Three substrate tiers (`high` / `medium` / `low`) collapse to two
    visible tiers in the default case. `high + is_ship_blocker`
    promotes to the red `Don't ship` tier reserved for genuine
    ship-blockers.
    """
    if is_ship_blocker and severity == "high":
        return ("Don't ship", "red")
    if severity in ("high", "medium"):
        return ("Worth adjusting", "amber")
    if severity == "low":
        return ("Quick polish", "stone")
    spaced = severity.replace("_", " ").strip()
    return (spaced[:1].upper() + spaced[1:] if spaced else severity, "stone")


# Customer-facing review-reason copy. Each label answers the question
# the customer is asking — "what should I do with this?" — instead of
# describing which engine subroutine produced the verdict. Mirrors the
# REVIEW_REASON_LABELS map in src/lib/humanize.ts. Keep in sync.
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

    The substrate enums leak engine-pipeline vocabulary
    (`ensemble_disagreement` = "scan and validate disagreed"); customer
    surfaces should never render those raw. This helper is the
    rendering boundary that keeps the language plain.

    Defensive fallback for unknown values returns the raw string
    sentence-cased so the gap is visible without crashing.
    """
    if not value:
        return ""
    if value in _REVIEW_REASON_LABELS:
        return _REVIEW_REASON_LABELS[value]
    spaced = value.replace("_", " ").strip()
    return spaced[:1].upper() + spaced[1:] if spaced else value
