"""Moment detection and standards weighting for the content standards checker.

A Moment encodes WHERE THE PERSON IS in the experience and what they
need from the content at that point. Content type tells you WHAT a
string is (heading, button, error). Moment tells you WHY it exists
(confirming success, recovering from error, making a decision).

The same string evaluates differently depending on the moment:
    "Are you sure?" in a destructive_action → VT-05 empathy matters,
        friction is acceptable, STR-02 density rules relax.
    "Are you sure?" in task_execution → different evaluation entirely.

Architecture:
    Tier 1: Text-pattern inference (this module). Zero cost, <1ms.
    Tier 2: Frame-level inference from grouped strings (future).
    Tier 3: User-declared via plugin dropdown (future).

The weighting system adjusts how strictly each standard is enforced
based on the detected moment. Weights are expressed as modifiers:
    "emphasize"  — the LLM should pay extra attention to this standard
    "relax"      — minor deviations are acceptable in this moment
    "suppress"   — this standard rarely applies in this moment

Initial weights are derived from content design best practices
articulated in public style guides. Session 16 expanded the citation
base; the categories of source the weighting philosophy draws from
(per ADR 2026-05-06-source-name-anonymization, brand names removed
from the public corpus + standards library):

    - consumer-marketing platform style guide
        (voice + tone + empathy in errors)
    - UK national-government style guide
        (plain language, active voice, link text)
    - US federal content guide
        (public-facing plain-language standards)
    - enterprise platform writing style guide
        (broad UI + technical copy)
    - consumer-OS interface guidelines
        (alerts, button labels, permission-request framing)
    - consumer-tech design system
        (button-label specificity, confirmation cadence)
    - commerce platform design system
        (empty-state principles, destructive-action copy)
    - productivity platform design system
        (voice — human, direct; one-idea-per-sentence)
    - developer platform design system
        (accessibility, sentence-case, link patterns)
    - enterprise software design system
        (technical-audience writing, plain language in legal)
    - US federal design system
        (federal plain language)
    - developer documentation style guide
        (sentence case, UI text)

The per-weight `rationale` strings state WHY the weight exists for
that moment + standard. Where a rationale leans on a single source's
guidance, the source category is named inline. Where the weight
reflects a shared principle across many sources, the rationale
describes the principle without repeatedly citing every source.
See `evals/examples_corpus/` for "this, not that" pairs that
illustrate these positions.

Human eval annotations continue to calibrate these weights — the
sources above are the STARTING position, not the final one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from content_checker.standards.loader import load_moments_taxonomy


# ---------------------------------------------------------------------------
# Taxonomy: the 13 canonical moments
# ---------------------------------------------------------------------------
#
# The moment IDs, descriptions, situation_property mappings, and weight
# adjustments all live in the private substrate at
# standards/private/moments_taxonomy.json (ADR 2026-04-25, substrate-
# extraction follow-up 2026-04-30). Loaded at module-import time and
# cached by the loader.
#
# The dataclasses, helper functions, and detection logic in this file
# stay public — they're the engine code that operates on the
# (privately loaded) editorial values.


def _load_moment_taxonomy() -> dict[str, str]:
    data = load_moments_taxonomy()
    return {m["id"]: m["description"] for m in data["moments"]}


def _load_situation_properties() -> dict[str, str]:
    data = load_moments_taxonomy()
    return {
        m["id"]: m["situation_property"]
        for m in data["moments"]
        if m.get("situation_property")
    }


MOMENT_TAXONOMY: dict[str, str] = _load_moment_taxonomy()

VALID_MOMENTS = frozenset(MOMENT_TAXONOMY.keys())

# Moments that represent situation-like properties — flag for UI
# filtering on /admin/model and the moment banner. The TS mirror in
# src/lib/moment-metadata.ts is pinned to this via
# tests/test_moment_metadata_ts_mirror.py.
SITUATION_PROPERTY_BY_MOMENT: dict[str, str] = _load_situation_properties()

# The default moment when no pattern matches. Not shown in UI.
DEFAULT_MOMENT = "browsing_discovery"

# Moment-classifier confidence threshold. Below this, the pipeline
# emits `situation_ambiguity` on review_reason (human-eval build plan
# Session 2). The heuristic detector only reports two levels today —
# a pattern matched (high) or a fallback (low) — but the threshold is
# expressed as a float so a future LLM-based moment classifier can
# produce a real confidence without changing the integration.
MOMENT_CONFIDENCE_THRESHOLD = 0.6
MOMENT_CONFIDENCE_MATCHED = 0.9   # specific pattern or content_type heuristic fired
MOMENT_CONFIDENCE_FALLBACK = 0.5  # no specific signal — DEFAULT_MOMENT only


# ---------------------------------------------------------------------------
# Tier 1: text-pattern heuristic detector
# ---------------------------------------------------------------------------

def detect_moment(text: str, content_type: str) -> str:
    """Detect the experiential moment from text patterns and content type.

    Returns one of the 13 canonical moment IDs. Falls back to
    'browsing_discovery' when no pattern matches.

    Thin wrapper over `detect_moment_with_confidence` that drops the
    confidence signal — preserves the pre-Session-2 public contract for
    callers that only care about the moment string.
    """
    moment, _ = detect_moment_with_confidence(text, content_type)
    return moment


def detect_moment_with_confidence(
    text: str, content_type: str,
) -> tuple[str, float]:
    """Detect the moment and return an accompanying confidence signal.

    Returns (moment_id, confidence) where confidence is in [0, 1]:
      - `MOMENT_CONFIDENCE_MATCHED` (0.9) when a specific pattern or
        content_type heuristic fired.
      - `MOMENT_CONFIDENCE_FALLBACK` (0.5) when no specific signal
        matched and the detector returned DEFAULT_MOMENT as the fallback.

    The pipeline reads this as a typed review signal: confidence below
    `MOMENT_CONFIDENCE_THRESHOLD` (0.6) trips `situation_ambiguity` on
    any review_recommended verdict that would otherwise fire.

    Priority order matters — destructive_action is checked before
    confirmation because "Are you sure you want to delete?" contains
    confirmation-like words but the moment is destructive. Celebration
    is checked before confirmation because "Congratulations! Account
    created" is celebration, not generic confirmation. Trust_permission
    is checked before decision_point because "Allow access" is consent,
    not a pricing decision. Compliance_disclosure is checked after
    task_execution but before the default fallback — regulatory content
    should be detected before browsing_discovery absorbs it.
    """
    lower = text.lower().strip()
    words = lower.split()
    length = len(words)

    matched = MOMENT_CONFIDENCE_MATCHED

    # --- Destructive action (highest specificity, check first) ---
    if re.search(
        r"\b(permanently\s+delete|cannot be undone|can't be undone|"
        r"irreversible|delete\s+(this|your|all)|remove\s+(this|your|all)|"
        r"are you sure\s+you\s+want\s+to\s+(delete|remove|cancel))\b",
        lower,
    ):
        return "destructive_action", matched
    if content_type == "button_cta" and re.search(
        r"\b(delete|remove|deactivate|"
        r"close\s+account|cancel\s+(plan|account|subscription))\b",
        lower,
    ):
        return "destructive_action", matched

    # --- Error recovery ---
    if content_type == "error_message":
        return "error_recovery", matched
    if length <= 30 and re.search(
        r"\b(went wrong|try again|couldn't|unable to|failed to|"
        r"not found|something.{0,10}wrong|oops|we('re| are) sorry)\b",
        lower,
    ):
        return "error_recovery", matched

    # --- Celebration (before confirmation — "Congrats!" is more specific) ---
    if re.search(
        r"\b(congrats|congratulations|great job|well done|you did it|"
        r"way to go|nice work|awesome job|achievement|streak|milestone|"
        r"leveled?\s+up|unlocked|earned|badge|new (record|high score|personal best)|"
        r"keep it up|on a roll)\b",
        lower,
    ):
        return "celebration", matched
    if length <= 25 and re.search(
        r"\bcompleted\s+\d+\b",
        lower,
    ):
        return "celebration", matched

    # --- Confirmation ---
    if content_type == "confirmation":
        return "confirmation", matched
    if length <= 25 and re.search(
        r"\b(successfully|has been "
        r"(saved|created|updated|deleted|sent|removed|confirmed|published)|"
        r"you're all set|all done|changes saved)\b",
        lower,
    ):
        return "confirmation", matched

    # --- Empty state ---
    if re.search(
        r"\b(no\s+\w+\s+yet|nothing (here|to show)|get started by|"
        r"no results|no items|looks empty|"
        r"you (haven't|don't have any))\b",
        lower,
    ):
        return "empty_state", matched

    # --- First encounter / onboarding ---
    if re.search(
        r"\b(welcome( to|,| back)|let's get|set up your|"
        r"first,?\s+(let's|you|we)|getting started|new to|"
        r"walkthrough|step\s+\d\s+of\s+\d)\b",
        lower,
    ):
        return "first_encounter", matched

    # --- Trust/permission (before decision_point — "allow" is consent, not choice) ---
    if re.search(
        r"\b(allow\s+access|grant\s+(access|permission)|"
        r"agree\s+to|consent\s+to|accept\s+(the\s+)?terms|"
        r"verify\s+your\s+(identity|email|phone)|"
        r"confirm\s+your\s+identity|"
        r"enable\s+(notifications?|location|cookies)|"
        r"turn\s+on\s+(notifications?|location)|"
        r"we\s+(use|collect|share|store)\s+(your\s+)?(data|cookies|information)|"
        r"privacy\s+policy|data\s+sharing|"
        r"would\s+like\s+to\s+access|"
        r"this\s+(app|site|service)\s+(would\s+like|wants|needs)\s+to|"
        r"permission\s+to\s+access)\b",
        lower,
    ):
        return "trust_permission", matched

    # --- Decision point ---
    if re.search(
        r"\b(compare\s+plans?|choose\s+(a\s+)?plan|"
        r"select\s+(a\s+)?plan|upgrade|downgrade|pricing|"
        r"per\s+month|\/mo\b|free\s+trial|"
        r"which\s+(plan|option|tier)|"
        # E-commerce decision patterns (from Apple eval)
        r"trade[\s-]in|interest[\s-]free|"
        r"save\s+up\s+to|monthly\s+installments?|"
        r"education\s+pricing|financing|"
        r"credit\s+toward)\b",
        lower,
    ):
        return "decision_point", matched

    # --- Interruption ---
    if re.search(
        r"\b(dismiss|got it|remind\s+me\s+later|not now|"
        r"maybe later|snooze|don't show\s+(this\s+)?again)\b",
        lower,
    ):
        return "interruption", matched

    # --- Wayfinding ---
    if content_type == "ui_label" and length <= 4:
        return "wayfinding", matched
    if content_type == "heading" and length <= 3:
        return "wayfinding", matched

    # --- Task execution ---
    if content_type != "button_cta" and re.search(
        r"\b(enter\s+(your|a|the)|type\s+(your|a|the)|"
        r"fill\s+(in|out)|upload\s+(your|a)|"
        r"select\s+(your|a|the)|choose\s+(your|a))\b",
        lower,
    ):
        return "task_execution", matched
    if content_type == "tooltip_microcopy" and length <= 20:
        return "task_execution", matched

    # --- Compliance disclosure (regulatory/legal mandated language) ---
    if re.search(
        r"\b(fdic|finra|(?<!\w)sec(?!\w)|"
        r"not\s+insured|investment\s+risks?|"
        r"investment\s+(and\s+insurance\s+)?products?|"
        r"qualification\s+period|offer\s+requirements?|"
        r"terms\s+and\s+conditions|"
        r"subject\s+to\s+\w+\s+risks?|"
        r"member\s+fdic|"
        r"deposit\s+products?\s+offered\s+by|"
        r"guaranteed\s+by\s+\w+\s+bank|"
        r"federal\s+government\s+agency|"
        r"may\s+lose\s+value|"
        r"not\s+a\s+deposit|"
        r"not\s+guaranteed)\b",
        lower,
    ):
        return "compliance_disclosure", matched

    # --- Default ---
    return DEFAULT_MOMENT, MOMENT_CONFIDENCE_FALLBACK


# ---------------------------------------------------------------------------
# Standards weighting: how moments adjust evaluation strictness
#
# Each moment maps to a dict of standard_id → weight modifier.
# Only standards that CHANGE behavior for a given moment are listed.
# Unlisted standards use default evaluation (no adjustment).
#
# Modifiers:
#   "emphasize"  — flag this standard more aggressively
#   "relax"      — minor deviations are acceptable
#   "suppress"   — almost never relevant in this moment
#
# These initial weights come from content design best practices.
# The human eval retrofit will validate and tune them.
# ---------------------------------------------------------------------------

@dataclass
class MomentWeight:
    """A single standard's weight adjustment for a moment."""

    standard_id: str
    modifier: str          # "emphasize", "relax", or "suppress"
    rationale: str         # why — used in system prompt and eval annotations

    def to_prompt_line(self) -> str:
        """Format as a system prompt instruction."""
        if self.modifier == "emphasize":
            return f"- **{self.standard_id}**: Pay extra attention. {self.rationale}"
        elif self.modifier == "relax":
            return f"- **{self.standard_id}**: Minor deviations acceptable. {self.rationale}"
        elif self.modifier == "suppress":
            return f"- **{self.standard_id}**: Rarely applies here. {self.rationale}"
        return ""


def _load_moment_weights() -> dict[str, list[MomentWeight]]:
    """Build the per-moment weight map from the private substrate.

    Each moment in moments_taxonomy.json carries a `weights` array of
    {standard_id, modifier, rationale} entries; this turns each into a
    `MomentWeight` instance and groups by moment id.

    Empty `weights` arrays are kept (so unknown moments and the default
    `browsing_discovery` moment fall through to an empty list as before).
    """
    data = load_moments_taxonomy()
    out: dict[str, list[MomentWeight]] = {}
    for moment in data["moments"]:
        out[moment["id"]] = [
            MomentWeight(
                standard_id=w["standard_id"],
                modifier=w["modifier"],
                rationale=w["rationale"],
            )
            for w in moment.get("weights", [])
        ]
    return out


MOMENT_WEIGHTS: dict[str, list[MomentWeight]] = _load_moment_weights()


def get_moment_weights(moment: str) -> list[MomentWeight]:
    """Get the standards weight adjustments for a moment.

    Returns an empty list for unknown moments or browsing_discovery
    (the default moment has no adjustments).
    """
    return MOMENT_WEIGHTS.get(moment, [])


def build_moment_prompt_section(moment: str) -> str:
    """Build the system prompt section for moment-aware evaluation.

    Returns an empty string for the default moment (no adjustments).
    This gets injected into the system prompt alongside the standards.
    """
    if moment == DEFAULT_MOMENT or moment not in MOMENT_TAXONOMY:
        return ""

    weights = get_moment_weights(moment)
    description = MOMENT_TAXONOMY[moment]
    moment_label = moment.replace("_", " ")

    lines = [
        f"\n## Moment context: {moment_label}\n",
        f"This content appears in a **{moment_label}** moment — {description}\n",
    ]

    if weights:
        lines.append("Adjust your evaluation for this moment:\n")
        for w in weights:
            lines.append(w.to_prompt_line())
        lines.append("")
    else:
        lines.append(
            "Evaluate with this context in mind, but apply standard thresholds.\n"
        )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Pipeline-facing functions (v4.4.0+)
# ---------------------------------------------------------------------------


def get_moment_weights_applied(moment: str) -> list[str]:
    """Return formatted weight strings for triage metadata.

    Each entry looks like "VT-05(emphasize)" for display in triage exports.
    Returns an empty list for the default moment or unknown moments.
    """
    weights = get_moment_weights(moment)
    return [f"{w.standard_id}({w.modifier})" for w in weights]


def is_standard_suppressed_by_moment(standard_id: str, moment: str) -> bool:
    """Check whether a moment's weight suppresses a specific standard.

    Used in the pipeline merge stage to filter out violations for
    standards that are suppressed in the detected moment. This is
    the moment equivalent of audience-based suppression.
    """
    weights = get_moment_weights(moment)
    return any(
        w.standard_id == standard_id and w.modifier == "suppress"
        for w in weights
    )


def get_suppressed_standards_for_moment(moment: str) -> frozenset[str]:
    """Return the set of standard IDs suppressed in this moment.

    Used by the pipeline to batch-filter violations rather than
    checking one at a time. Returns an empty frozenset for the
    default moment or moments with no suppressions.
    """
    weights = get_moment_weights(moment)
    return frozenset(
        w.standard_id for w in weights if w.modifier == "suppress"
    )
