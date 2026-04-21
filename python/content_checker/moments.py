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

Initial weights are derived from content design best practices across
GOV.UK, Mailchimp, Stripe, Apple HIG, and Microsoft Writing Guide.
Human eval annotations will calibrate these over time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Taxonomy: the 13 canonical moments
# ---------------------------------------------------------------------------

MOMENT_TAXONOMY: dict[str, str] = {
    "first_encounter":        "Onboarding, setup, first-run. Clarity above all.",
    "browsing_discovery":     "Homepages, landing pages, feature tours. Scannability matters.",
    "decision_point":         "Pricing, plan selection, upgrade prompts. No dark patterns.",
    "task_execution":         "Form filling, configuration, multi-step flows. Actionable labels.",
    "confirmation":           "Success, saved, completed. Brevity, passive voice is fine.",
    "celebration":            "Achievement, milestone, streak. Enthusiasm is earned, not excessive.",
    "error_recovery":         "Validation, system errors, failed states. No blame, clear next step.",
    "destructive_action":     "Delete, cancel, irreversible. Explicit consequences, friction OK.",
    "empty_state":            "Zero data, no results. Helpful, suggest next action.",
    "interruption":           "Modals, toasts, notifications. Brevity critical, clear dismiss.",
    "trust_permission":       "Consent, verification, permissions. Precision over warmth, hedging OK.",
    "wayfinding":             "Navigation, breadcrumbs, section labels. Consistency, space-constrained OK.",
    "compliance_disclosure":  "Regulatory disclaimers, legal mandates, FDIC notices. Mandated language takes precedence.",
}

VALID_MOMENTS = frozenset(MOMENT_TAXONOMY.keys())

# The default moment when no pattern matches. Not shown in UI.
DEFAULT_MOMENT = "browsing_discovery"


# ---------------------------------------------------------------------------
# Tier 1: text-pattern heuristic detector
# ---------------------------------------------------------------------------

def detect_moment(text: str, content_type: str) -> str:
    """Detect the experiential moment from text patterns and content type.

    Returns one of the 13 canonical moment IDs. Falls back to
    'browsing_discovery' when no pattern matches.

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

    # --- Destructive action (highest specificity, check first) ---
    if re.search(
        r"\b(permanently\s+delete|cannot be undone|can't be undone|"
        r"irreversible|delete\s+(this|your|all)|remove\s+(this|your|all)|"
        r"are you sure\s+you\s+want\s+to\s+(delete|remove|cancel))\b",
        lower,
    ):
        return "destructive_action"
    if content_type == "button_cta" and re.search(
        r"\b(delete|remove|deactivate|"
        r"close\s+account|cancel\s+(plan|account|subscription))\b",
        lower,
    ):
        return "destructive_action"

    # --- Error recovery ---
    if content_type == "error_message":
        return "error_recovery"
    if length <= 30 and re.search(
        r"\b(went wrong|try again|couldn't|unable to|failed to|"
        r"not found|something.{0,10}wrong|oops|we('re| are) sorry)\b",
        lower,
    ):
        return "error_recovery"

    # --- Celebration (before confirmation — "Congrats!" is more specific) ---
    if re.search(
        r"\b(congrats|congratulations|great job|well done|you did it|"
        r"way to go|nice work|awesome job|achievement|streak|milestone|"
        r"leveled?\s+up|unlocked|earned|badge|new (record|high score|personal best)|"
        r"keep it up|on a roll)\b",
        lower,
    ):
        return "celebration"
    if length <= 25 and re.search(
        r"\bcompleted\s+\d+\b",
        lower,
    ):
        return "celebration"

    # --- Confirmation ---
    if content_type == "confirmation":
        return "confirmation"
    if length <= 25 and re.search(
        r"\b(successfully|has been "
        r"(saved|created|updated|deleted|sent|removed|confirmed|published)|"
        r"you're all set|all done|changes saved)\b",
        lower,
    ):
        return "confirmation"

    # --- Empty state ---
    if re.search(
        r"\b(no\s+\w+\s+yet|nothing (here|to show)|get started by|"
        r"no results|no items|looks empty|"
        r"you (haven't|don't have any))\b",
        lower,
    ):
        return "empty_state"

    # --- First encounter / onboarding ---
    if re.search(
        r"\b(welcome( to|,| back)|let's get|set up your|"
        r"first,?\s+(let's|you|we)|getting started|new to|"
        r"walkthrough|step\s+\d\s+of\s+\d)\b",
        lower,
    ):
        return "first_encounter"

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
        return "trust_permission"

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
        return "decision_point"

    # --- Interruption ---
    if re.search(
        r"\b(dismiss|got it|remind\s+me\s+later|not now|"
        r"maybe later|snooze|don't show\s+(this\s+)?again)\b",
        lower,
    ):
        return "interruption"

    # --- Wayfinding ---
    if content_type == "ui_label" and length <= 4:
        return "wayfinding"
    if content_type == "heading" and length <= 3:
        return "wayfinding"

    # --- Task execution ---
    if content_type != "button_cta" and re.search(
        r"\b(enter\s+(your|a|the)|type\s+(your|a|the)|"
        r"fill\s+(in|out)|upload\s+(your|a)|"
        r"select\s+(your|a|the)|choose\s+(your|a))\b",
        lower,
    ):
        return "task_execution"
    if content_type == "tooltip_microcopy" and length <= 20:
        return "task_execution"

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
        return "compliance_disclosure"

    # --- Default ---
    return DEFAULT_MOMENT


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


MOMENT_WEIGHTS: dict[str, list[MomentWeight]] = {
    "first_encounter": [
        MomentWeight("CLR-01", "emphasize",
                     "First-time users have zero context. Plain language is critical."),
        MomentWeight("CLR-03", "emphasize",
                     "Keep sentences short — cognitive load is highest on first use."),
        MomentWeight("ACC-01", "emphasize",
                     "New users rely on clear link text to orient themselves."),
        MomentWeight("GRM-03", "relax",
                     "An exclamation in a welcome message is warmer, not louder."),
        MomentWeight("PRF-11", "emphasize",
                     "Dismissive language is most harmful during onboarding — users have no context yet."),
    ],

    "browsing_discovery": [
        # Default evaluation — minimal adjustments.
        MomentWeight("PRF-11", "suppress",
                     "Marketing pages legitimately use 'easy' and 'simple' as value propositions."),
        MomentWeight("PRF-03", "relax",
                     "Trailing periods on marketing headings are rhetorical devices for cadence and emphasis."),
    ],

    "decision_point": [
        MomentWeight("CLR-01", "emphasize",
                     "Users making decisions need precise, jargon-free language."),
        MomentWeight("VT-01", "emphasize",
                     "Active voice keeps decision copy direct and scannable."),
        MomentWeight("GRM-05", "emphasize",
                     "Use numerals in pricing and comparisons for quick scanning."),
        MomentWeight("CON-02", "emphasize",
                     "Inconsistent casing undermines trust at the point of purchase."),
        MomentWeight("PRF-11", "suppress",
                     "Decision pages legitimately describe features as 'easy' to influence choice."),
    ],

    "task_execution": [
        MomentWeight("ACT-01", "emphasize",
                     "Labels and instructions must start with clear action verbs."),
        MomentWeight("CLR-03", "emphasize",
                     "Keep helper text short — users are mid-task, not reading."),
        MomentWeight("ACC-07", "emphasize",
                     "Form fields need accessible labels and helper text."),
        MomentWeight("PRF-11", "emphasize",
                     "Telling users to 'simply enter' dismisses the friction they may be experiencing."),
    ],

    "confirmation": [
        MomentWeight("VT-01", "relax",
                     "Passive voice is natural in confirmations: 'Your changes are saved.'"),
        MomentWeight("ACT-01", "relax",
                     "Confirmations describe what happened, not what to do next."),
        MomentWeight("CLR-03", "relax",
                     "Brevity trumps sentence structure rules in success states."),
    ],

    "celebration": [
        MomentWeight("GRM-03", "relax",
                     "Exclamation marks are earned in achievement moments."),
        MomentWeight("CON-02", "relax",
                     "Achievement copy uses branded/stylized casing as intentional emphasis."),
        MomentWeight("PRF-11", "suppress",
                     "Enthusiasm is legitimate in celebrations, not dismissive."),
        MomentWeight("VT-05", "emphasize",
                     "Celebration copy should feel genuinely warm."),
        MomentWeight("VT-02", "emphasize",
                     "Use 'you/your' — this is the user's achievement, not the product's."),
        MomentWeight("VT-03", "emphasize",
                     "Robotic tone undermines the earned emotional beat."),
    ],

    "error_recovery": [
        MomentWeight("VT-05", "emphasize",
                     "Empathetic tone is critical. Never blame the user."),
        MomentWeight("CLR-01", "emphasize",
                     "Error messages must be jargon-free — the user is already stressed."),
        MomentWeight("ACT-01", "emphasize",
                     "Every error must suggest a clear next action."),
        MomentWeight("GRM-03", "suppress",
                     "Exclamation marks in errors feel like shouting at a struggling user."),
        MomentWeight("PRF-11", "emphasize",
                     "'Simply re-enter your password' is the worst thing to say to a struggling user."),
        MomentWeight("VT-03", "emphasize",
                     "Robotic error copy alienates users when they need empathy most."),
        MomentWeight("ACT-03", "emphasize",
                     "Negative framing compounds anxiety in error states."),
        MomentWeight("ACT-04", "emphasize",
                     "Errors need actionable next steps, not just a description of what went wrong."),
    ],

    "destructive_action": [
        MomentWeight("CLR-01", "emphasize",
                     "Consequences must be stated in plain, unambiguous language."),
        MomentWeight("VT-05", "emphasize",
                     "Acknowledge the weight of the action. Don't be flippant."),
        MomentWeight("STR-02", "relax",
                     "Extra content density is acceptable — friction prevents mistakes."),
        MomentWeight("CLR-03", "relax",
                     "Longer sentences are fine when explaining irreversible consequences."),
    ],

    "empty_state": [
        MomentWeight("ACT-01", "emphasize",
                     "Empty states should guide the user to a first action."),
        MomentWeight("VT-02", "emphasize",
                     "Use 'you/your' to make the empty state feel personal, not broken."),
        MomentWeight("GRM-03", "relax",
                     "A friendly exclamation in an empty state is encouraging, not excessive."),
        MomentWeight("ACT-04", "emphasize",
                     "Empty states need concrete next steps — don't leave the user stranded."),
    ],

    "interruption": [
        MomentWeight("CLR-03", "emphasize",
                     "Interruptions must justify themselves in as few words as possible."),
        MomentWeight("STR-02", "emphasize",
                     "Dense modals and toasts overwhelm. One message, one action."),
        MomentWeight("ACT-01", "emphasize",
                     "Dismiss and action buttons must be unambiguous."),
    ],

    "trust_permission": [
        MomentWeight("CLR-01", "emphasize",
                     "Users can't consent to what they don't understand."),
        MomentWeight("VT-04", "relax",
                     "Hedging is precision in consent contexts, not weakness."),
        MomentWeight("ACT-01", "emphasize",
                     "Permission actions must be unambiguous ('Allow' vs 'Deny')."),
        MomentWeight("TRN-01", "emphasize",
                     "Trust copy must be transparent about what happens next."),
    ],

    "wayfinding": [
        MomentWeight("CON-02", "emphasize",
                     "Navigation labels must use consistent casing across the product."),
        MomentWeight("GRM-04", "relax",
                     "Ampersands are conventional in navigation: 'Docs & Guides.'"),
        MomentWeight("CLR-03", "suppress",
                     "Navigation labels are fragments, not sentences. Length rules don't apply."),
        MomentWeight("ACT-01", "suppress",
                     "Nav labels are nouns, not verbs: 'Settings', not 'Go to settings.'"),
    ],

    "compliance_disclosure": [
        MomentWeight("CON-02", "suppress",
                     "Regulatory disclaimers use Title Case by convention or legal mandate."),
        MomentWeight("CLR-01", "relax",
                     "Legal and financial terms may be mandated precision, not jargon."),
    ],
}


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
