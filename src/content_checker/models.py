"""Data models for the content standards checker.

Defines typed contracts for violations, check results, and pipeline metadata.
Every function in the package uses these instead of raw dicts.

Privacy boundary (post-pivot, schema 2.0.0). The Violation and CheckResult
dataclasses carry the full substrate set internally — `standard_id`, `rule`,
`rule_version`, `related_standards`, `rationale_chain`, etc. The PUBLIC
emission of these objects strips substrate fields down to the four-field
public envelope (issue, suggestion, severity, confidence) by default.
Substrate-mode emission is gated behind the `PUBLIC_TAXONOMY` env var
(see `src/content_checker/config.py`). The boundary is enforced via the
explicit `to_public_dict()` / `to_substrate_dict()` split — call sites
MUST choose. There is no ambiguous `to_dict()` that silently leaks.
See `decisions/2026-04-25-private-taxonomy-pivot.md`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from content_checker.config import is_public_taxonomy_enabled


# ---------------------------------------------------------------------------
# Public API envelope (BUILD_PLAN_v2 Session 9)
# ---------------------------------------------------------------------------

# Bumped whenever the response shape changes. Minor for additive fields,
# major for breaking changes. The TS-side constant in
# `src/lib/api-envelope.ts` mirrors this — keep them in lock-step.
#
# 1.0.0 — initial envelope (v2 Session 9)
# 1.1.0 — add `verdict` ("pass"|"violation"|"review_recommended"|"error"),
#         `confidence` per Violation, `review_reason` on CheckResult
#         (v2 Session 10). Additive — old clients keep working.
# 1.2.0 — add `related_standards`, `ambiguity_flag`, `rule_version` on
#         Violation; add `rationale_chain` on CheckResult
#         (human-eval build plan Session 1). Additive only.
# 1.3.0 — populate the remaining four typed `review_reason` subtypes:
#         `standards_conflict`, `situation_ambiguity`,
#         `out_of_distribution`, `novel_pattern`
#         (human-eval build plan Session 2). New enum variants — old
#         clients reading `review_reason` as a raw string keep working,
#         but clients that switch on the value should add the new arms.
# 1.4.0 — richer override signal on POST /api/violations/override:
#         override_stance, actor_role, rationale_expanded,
#         time_to_action_ms, suggested_text, applied_text
#         (human-eval build plan Session 3). Web-side only — the
#         Python engine does not expose the override endpoint. Mirrored
#         here so the Python envelope doesn't drift.
# 1.5.0 — structured override-reason vocabulary + session grouping on
#         POST /api/violations/override: override_reason_code,
#         session_id (human-eval build plan Session 4). Web-side only.
# 1.6.0 — ensemble_disagreement review_reason subtype +
#         `validate_rejection_reason` on Violation (human-eval build
#         plan Session 13). Scan/validate disagreement is now its own
#         subtype (previously conflated with standards_conflict);
#         rejected scan candidates carry validate's reasoning for the
#         review-queue surface. Additive — old clients keep working.
# 1.7.0 — every Violation carries a `docs_url` pointing at the
#         standard's page on docs.contentrx.io (BUILD_PLAN_v2
#         Appendix A non-negotiable). Derived at serialization time
#         from `standard_id`.
# 2.0.0 — **Breaking.** Private-taxonomy pivot (ADR 2026-04-25).
#         Public Violation envelope is reduced to four fields: `issue`,
#         `suggestion`, `severity`, `confidence`. Removed entirely from
#         the public envelope: `docs_url`, `related_standards`,
#         `rationale_chain`. Stripped from user-visible surfaces but
#         retained in substrate API responses (founder-auth only):
#         `standard_id`, `rule`, `rule_version`, `source`,
#         `ambiguity_flag`, `validate_rejection_reason`. New top-level
#         shape: `{schema_version, verdict, review_reason, warnings,
#         violations: [public]}`. Substrate emission gated behind the
#         `PUBLIC_TAXONOMY` env var (default `false`).
#         New: `severity` field on Violation, derived from `confidence`
#         (>=0.85 → "high", >=0.65 → "medium", else "low"). Override
#         points: team-rules per-standard severity (TS-side).
SCHEMA_VERSION = "2.0.0"


# Ambiguity-flag vocabulary (human-eval build plan Session 1).
#
# An ambiguity_flag attaches to a specific Violation (or a specific hop,
# via rationale_chain) when the pipeline was uncertain in a typed way.
# This is distinct from CheckResult.review_reason — that field is
# one-per-evaluation; this one can attach per-hop.
AMBIGUITY_VOICE_MISMATCH_WITH_MOMENT = "voice_mismatch_with_moment"
AMBIGUITY_STANDARDS_CONFLICT = "standards_conflict"
AMBIGUITY_INSUFFICIENT_CONTEXT = "insufficient_context"
AMBIGUITY_SITUATION_UNCERTAIN = "situation_uncertain"

VALID_AMBIGUITY_FLAGS = frozenset({
    AMBIGUITY_VOICE_MISMATCH_WITH_MOMENT,
    AMBIGUITY_STANDARDS_CONFLICT,
    AMBIGUITY_INSUFFICIENT_CONTEXT,
    AMBIGUITY_SITUATION_UNCERTAIN,
})


# Review-reason vocabulary (human-eval build plan Session 2).
#
# When CheckResult.verdict == "review_recommended", review_reason carries
# a specific typed subtype so the review queue (Session 8) becomes
# sliceable by uncertainty type. Every review_recommended event carries
# exactly one of these values — no generic fallback.
#
# Precedence when multiple signals fire (highest-priority wins):
#   1. standards_conflict — architectural signal, highest taxonomic value
#   2. situation_ambiguity — upstream moment-classifier issue
#   3. out_of_distribution — novel input, routes to new-moment backlog
#   4. novel_pattern — drift signal, override-rate climbing
#   5. low_confidence — LLM self-rated confidence below threshold
#
# standards_conflict beats the others because fixing the taxonomy
# clears the downstream disagreement entirely; the other signals often
# resolve themselves once the taxonomic question is settled.
REVIEW_LOW_CONFIDENCE = "low_confidence"
REVIEW_STANDARDS_CONFLICT = "standards_conflict"
REVIEW_ENSEMBLE_DISAGREEMENT = "ensemble_disagreement"
REVIEW_SITUATION_AMBIGUITY = "situation_ambiguity"
REVIEW_OUT_OF_DISTRIBUTION = "out_of_distribution"
REVIEW_NOVEL_PATTERN = "novel_pattern"

VALID_REVIEW_REASONS = frozenset({
    REVIEW_LOW_CONFIDENCE,
    REVIEW_STANDARDS_CONFLICT,
    REVIEW_ENSEMBLE_DISAGREEMENT,
    REVIEW_SITUATION_AMBIGUITY,
    REVIEW_OUT_OF_DISTRIBUTION,
    REVIEW_NOVEL_PATTERN,
})

# Precedence list — index 0 wins over index 1, etc. `derive_verdict`
# consults this ordering when multiple signals fire simultaneously.
#
# Human-eval build plan Session 13: ensemble_disagreement slots between
# standards_conflict (multi-standard taxonomy drift) and
# situation_ambiguity (upstream moment routing). The two LLM passes —
# scan and validate — are the first-pass ensemble; disagreement between
# them signals either a prompt-layer issue or a content_type_notes gap,
# both worth Robert's attention before lower-signal review reasons fire.
REVIEW_REASON_PRECEDENCE: tuple[str, ...] = (
    REVIEW_STANDARDS_CONFLICT,
    REVIEW_ENSEMBLE_DISAGREEMENT,
    REVIEW_SITUATION_AMBIGUITY,
    REVIEW_OUT_OF_DISTRIBUTION,
    REVIEW_NOVEL_PATTERN,
    REVIEW_LOW_CONFIDENCE,
)


# Three-state verdict (BUILD_PLAN_v2 Session 10).
#
# The product's wedge differentiator: every other linter ships a binary
# pass/fail. Calibrated three-state output is honest about uncertainty —
# "this looks wrong but I'm not sure" gets a different treatment than
# "this is definitely wrong."
#
# CI integrations default to "fail-on: violation" (REVIEW does NOT fail
# the build) so REVIEW shows up as warnings, not blockers.
Verdict = str  # one of: "pass" | "violation" | "review_recommended" | "error"

VERDICT_PASS: Verdict = "pass"
VERDICT_VIOLATION: Verdict = "violation"
VERDICT_REVIEW_RECOMMENDED: Verdict = "review_recommended"
VERDICT_ERROR: Verdict = "error"

VALID_VERDICTS = frozenset({
    VERDICT_PASS,
    VERDICT_VIOLATION,
    VERDICT_REVIEW_RECOMMENDED,
    VERDICT_ERROR,
})


# Confidence threshold below which a violation flips the overall verdict
# to REVIEW_RECOMMENDED. Tuned to match the BUILD_PLAN_v2 spec
# (LLM confidence < 0.7 → REVIEW).
CONFIDENCE_THRESHOLD = 0.7

# Default confidence per source. Preprocessor checks are deterministic
# regex/AST work — absolute confidence. LLM checks are calibrated softer
# (still above the threshold; the threshold catches the long tail when a
# real confidence source feeds in lower values).
DEFAULT_CONFIDENCE_PREPROCESSOR = 1.0
DEFAULT_CONFIDENCE_LLM = 0.85


# Severity vocabulary (schema 2.0.0 — ADR 2026-04-25).
#
# Public field on every Violation. Three-state, ordered: high > medium >
# low. Default derivation from confidence:
#   confidence >= 0.85 → "high"   (the LLM default — most violations land here)
#   confidence >= 0.65 → "medium" (between threshold and default)
#   else                 "low"    (already triggers low_confidence review)
# Team-rules can override severity per standard at the API boundary
# (`src/lib/team-rules.ts`).
SEVERITY_HIGH = "high"
SEVERITY_MEDIUM = "medium"
SEVERITY_LOW = "low"

VALID_SEVERITIES = frozenset({SEVERITY_HIGH, SEVERITY_MEDIUM, SEVERITY_LOW})

SEVERITY_HIGH_THRESHOLD = 0.85
SEVERITY_MEDIUM_THRESHOLD = 0.65


def derive_severity(confidence: float) -> str:
    """Map a confidence score to the three-state severity band."""
    if confidence >= SEVERITY_HIGH_THRESHOLD:
        return SEVERITY_HIGH
    if confidence >= SEVERITY_MEDIUM_THRESHOLD:
        return SEVERITY_MEDIUM
    return SEVERITY_LOW


@dataclass
class EvaluationEnvelope:
    """Wrapping shape for any public API response.

    The TS layer is the primary source of truth (every public Next.js
    route calls `envelope()` from `src/lib/api-envelope.ts`); this
    dataclass mirrors the contract on the Python side so engine-level
    tools that emit JSON directly (the eval pipeline harness, future
    Python evaluators) can produce the same shape without re-deriving
    the field set.

    See docs/API_VERSIONING.md for the semver policy.
    """

    result: Any
    schema_version: str = SCHEMA_VERSION
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Substrate envelope — full result + schema_version + warnings.

        Preserved for internal substrate API responses (founder-auth)
        and for engine-level tools (eval pipeline harness). Public API
        callers should construct the envelope from the new top-level
        public shape (see `CheckResult.to_public_envelope`) rather than
        wrapping a CheckResult in this envelope.
        """
        result = self.result
        if hasattr(result, "to_substrate_dict"):
            result = result.to_substrate_dict()
        elif hasattr(result, "to_dict"):
            result = result.to_dict()
        return {
            "schema_version": self.schema_version,
            "result": result,
            "warnings": list(self.warnings),
        }


@dataclass
class Violation:
    """A single content standards violation.

    `confidence` (v1.1.0+) is the engine's self-rated certainty in this
    finding, on [0, 1]. Preprocessor (deterministic) violations default
    to 1.0; LLM violations default to 0.85. When the LLM scan response
    includes its own confidence per violation, that value overrides the
    default. Violations with confidence < CONFIDENCE_THRESHOLD flip the
    overall CheckResult.verdict to "review_recommended".

    `severity` (schema 2.0.0+) is the public-surface severity band
    (`high` / `medium` / `low`) derived from `confidence` at construction
    time when not explicitly set. Team-rules can override per-standard
    at the API boundary.

    Substrate-only fields — present on the dataclass for internal
    pipelines and the founder `/admin` substrate API, but NEVER rendered
    on user-facing surfaces and NEVER serialized into the schema 2.0.0
    public envelope:

    `standard_id` — the rule's identifier (e.g., CLR-01). Substrate.

    `rule` — the literal rule text from the standard. Substrate.

    `source` — "deterministic" or "llm". Substrate (debug-only).

    `related_standards` — standard IDs the LLM considered as adjacent
    candidates and either rejected or applied. Substrate.

    `ambiguity_flag` — typed reason for uncertainty on this specific
    violation. Substrate.

    `rule_version` — the per-standard version of the standard that was
    in effect when this violation was emitted. Substrate (reproducibility).

    `validate_rejection_reason` — when scan proposed this violation but
    validate rejected it, validate's reasoning. Substrate (review queue).
    """

    standard_id: str
    rule: str
    issue: str
    suggestion: str
    source: str = "llm"  # "deterministic" or "llm"
    confidence: float = DEFAULT_CONFIDENCE_LLM

    # v1.2.0 additions. See class docstring above.
    related_standards: list[str] = field(default_factory=list)
    ambiguity_flag: str | None = None
    rule_version: str | None = None

    # v1.6.0 addition (human-eval build plan Session 13): when this
    # Violation was proposed by scan but REJECTED by validate, the
    # rejection reasoning from validate lands here. Survives to the
    # review queue so Robert can see scan's + validate's reasoning
    # side-by-side. None on confirmed violations (validate agreed,
    # there's nothing to disagree about) and on preprocessor-source
    # violations (no LLM second pass).
    validate_rejection_reason: str | None = None

    # schema 2.0.0 addition (ADR 2026-04-25): public severity band.
    # Defaulted from confidence at __post_init__ time when None.
    severity: str | None = None

    def __post_init__(self) -> None:
        if self.severity is None:
            self.severity = derive_severity(self.confidence)

    def to_public_dict(self) -> dict:
        """Public-facing serialization — schema 2.0.0 four-field shape.

        Returns the user-visible Violation: `issue`, `suggestion`,
        `severity`, `confidence`. Substrate fields (standard_id, rule,
        rule_version, related_standards, ambiguity_flag, source,
        validate_rejection_reason) are stripped — they never reach the
        web dashboard, MCP, CLI, Figma plugin, GitHub Action, LSP, or
        editor extensions.

        When `PUBLIC_TAXONOMY=true` (reversibility insurance, default
        false), substrate fields are included alongside the public ones
        for downstream rendering. The flag is read at call time, so
        tests and request-scoped contexts can flip it without re-import.
        """
        public: dict[str, Any] = {
            "issue": self.issue,
            "suggestion": self.suggestion,
            "severity": self.severity,
            "confidence": self.confidence,
        }
        if is_public_taxonomy_enabled():
            public.update({
                "standard_id": self.standard_id,
                "rule": self.rule,
                "source": self.source,
                "related_standards": list(self.related_standards),
                "ambiguity_flag": self.ambiguity_flag,
                "rule_version": self.rule_version,
                "validate_rejection_reason": self.validate_rejection_reason,
            })
        return public

    def to_substrate_dict(self) -> dict:
        """Substrate serialization — the full Violation including all
        substrate-only fields. For founder-authenticated `/admin` API
        responses and for internal-only pipelines (logging, override
        review queue, eval harness). Never returned by `/api/check`.

        Note: `docs_url` is removed entirely in schema 2.0.0; the
        public taxonomy that page would have linked to is private now.
        """
        return {
            "standard_id": self.standard_id,
            "rule": self.rule,
            "issue": self.issue,
            "suggestion": self.suggestion,
            "source": self.source,
            "confidence": self.confidence,
            "severity": self.severity,
            "related_standards": list(self.related_standards),
            "ambiguity_flag": self.ambiguity_flag,
            "rule_version": self.rule_version,
            "validate_rejection_reason": self.validate_rejection_reason,
        }

    def to_dict(self) -> dict:
        """Backwards-compatible alias for `to_substrate_dict`.

        Internal callers (eval harness, engine CLI, tools/) continue to
        work unchanged — they receive the substrate dict (minus the
        removed `docs_url` field). New callers SHOULD use the explicit
        `to_substrate_dict` or `to_public_dict` to make the privacy
        intent visible at the call site.
        """
        return self.to_substrate_dict()


@dataclass
class PassedStandard:
    """A standard the content passed."""

    standard_id: str
    rule: str

    def to_dict(self) -> dict:
        return {"standard_id": self.standard_id, "rule": self.rule}


@dataclass
class PipelineMeta:
    """Metadata about the pipeline run.

    Moment fields (v4.4.0+):
        moment_weights_applied: count of MomentWeight entries active for
            the detected moment (how many standards had evaluation adjusted).
        moment_suppressed: count of violations filtered out by moment
            weights in the merge stage (the moment equivalent of
            audience-gated violations).
    """

    standards_checked: int | str = 0
    standards_total: int | str = 0
    preprocess_violations: int = 0
    llm_candidates: int = 0
    validated_confirmed: int = 0
    validated_rejected: int = 0
    moment_weights_applied: int = 0
    moment_suppressed: int = 0

    def to_dict(self) -> dict:
        return {
            "standards_checked": self.standards_checked,
            "standards_total": self.standards_total,
            "preprocess_violations": self.preprocess_violations,
            "llm_candidates": self.llm_candidates,
            "validated_confirmed": self.validated_confirmed,
            "validated_rejected": self.validated_rejected,
            "moment_weights_applied": self.moment_weights_applied,
            "moment_suppressed": self.moment_suppressed,
        }


@dataclass
class TokenUsage:
    """API token usage tracking.

    `cache_creation_input` and `cache_read_input` (audit M-24, PR 9)
    expose Anthropic prompt-caching activity so /api/check can store
    cache-aware cost telemetry per customer. Both default to 0 when
    caching wasn't used or the SDK didn't report them.

    Note: `input` is the UNCACHED input tokens. The full input billed
    on a request is `input + cache_creation_input + cache_read_input`,
    where cache_read pays ~10% of normal input cost.
    """

    input: int = 0
    output: int = 0
    cache_creation_input: int = 0
    cache_read_input: int = 0

    def __iadd__(self, other: TokenUsage) -> TokenUsage:
        self.input += other.input
        self.output += other.output
        self.cache_creation_input += other.cache_creation_input
        self.cache_read_input += other.cache_read_input
        return self

    def to_dict(self) -> dict:
        return {
            "input": self.input,
            "output": self.output,
            "cache_creation_input": self.cache_creation_input,
            "cache_read_input": self.cache_read_input,
        }


# ---------------------------------------------------------------------------
# Rationale chain (v1.2.0 — human-eval build plan Session 1)
# ---------------------------------------------------------------------------


# Canonical pipeline hop names. Kept as string constants so test and tool
# code can compare against them without depending on an Enum import.
HOP_CLASSIFY = "classify"
HOP_DETECT_MOMENT = "detect_moment"
HOP_FILTER = "filter"
HOP_PREPROCESS = "preprocess"
HOP_SCAN = "scan"
HOP_VALIDATE = "validate"
HOP_MERGE = "merge"

VALID_HOPS = frozenset({
    HOP_CLASSIFY,
    HOP_DETECT_MOMENT,
    HOP_FILTER,
    HOP_PREPROCESS,
    HOP_SCAN,
    HOP_VALIDATE,
    HOP_MERGE,
})


@dataclass
class RationaleHop:
    """One hop in the pipeline's reasoning chain.

    When Robert (or any reviewer) sees a wrong verdict, the rationale chain
    lets them pinpoint which hop went sideways without re-running the
    pipeline. Every hop captures a compact summary of its inputs, output,
    and the rule versions it consulted.

    `confidence` is populated when the hop has a meaningful confidence
    signal (LLM classifier, LLM scan, LLM validate) and left None for
    deterministic hops (heuristic classify, filter, preprocess, merge).

    `rule_versions` maps standard_id → version for the per-standard
    versions (from standards_library.json) that this hop consulted.
    Empty for hops that don't touch standards (classify, detect_moment).

    `ambiguity_flag` is set when this hop was specifically uncertain in
    a typed way — see VALID_AMBIGUITY_FLAGS. Null when the hop was
    confident or uncertainty is captured elsewhere.
    """

    step: str
    inputs: dict = field(default_factory=dict)
    output: dict = field(default_factory=dict)
    confidence: float | None = None
    rule_versions: dict[str, str] = field(default_factory=dict)
    ambiguity_flag: str | None = None

    def to_dict(self) -> dict:
        return {
            "step": self.step,
            "inputs": dict(self.inputs),
            "output": dict(self.output),
            "confidence": self.confidence,
            "rule_versions": dict(self.rule_versions),
            "ambiguity_flag": self.ambiguity_flag,
        }


@dataclass
class CheckResult:
    """The complete result of checking a piece of content.

    Moment field (v4.4.0+):
        moment: the detected experiential moment (e.g., "error_recovery",
            "decision_point"). Empty string when moment detection was not
            run (e.g., check_unfiltered). Set by check() in pipeline.py.
    """

    content_type: str
    overall_verdict: str  # "pass", "fail", or "error" — legacy 1.0.0 field
    violations: list[Violation] = field(default_factory=list)
    passes: list[PassedStandard] = field(default_factory=list)
    summary: str = ""
    audience: str = "product_ui"  # "product_ui" or "general"
    moment: str = ""  # detected moment ID, empty if not detected
    pipeline: PipelineMeta = field(default_factory=PipelineMeta)

    # v1.1.0 additions — three-state verdict + review reason.
    # `verdict` is the calibrated three-state version of `overall_verdict`:
    #   pass | violation | review_recommended | error
    # Old clients keep using overall_verdict; new ones SHOULD use verdict.
    verdict: Verdict = VERDICT_PASS
    review_reason: str | None = None

    # v1.2.0 addition — rationale chain.
    # Ordered list of hops the pipeline executed, each with inputs,
    # outputs, confidence, and consulted rule versions. Empty when the
    # caller bypasses the pipeline (direct CheckResult construction).
    rationale_chain: list[RationaleHop] = field(default_factory=list)

    def to_substrate_dict(self) -> dict:
        """Substrate serialization — full CheckResult including substrate
        fields like `moment`, `passes`, `pipeline`, `rationale_chain`.
        For founder-authenticated `/admin` API responses and engine-
        internal callers (eval harness, engine CLI). Never returned by
        the public `/api/check`.
        """
        return {
            "content_type": self.content_type,
            "overall_verdict": self.overall_verdict,
            "verdict": self.verdict,
            "violations": [v.to_substrate_dict() for v in self.violations],
            "passes": [p.to_dict() for p in self.passes],
            "summary": self.summary,
            "audience": self.audience,
            "moment": self.moment,
            "review_reason": self.review_reason,
            "pipeline": self.pipeline.to_dict(),
            "rationale_chain": [h.to_dict() for h in self.rationale_chain],
        }

    def to_dict(self) -> dict:
        """Backwards-compatible alias for `to_substrate_dict`.

        Internal callers (eval harness, engine CLI, tools/) keep working
        unchanged. New callers SHOULD use the explicit
        `to_substrate_dict` or `to_public_envelope` to make the privacy
        intent visible.
        """
        return self.to_substrate_dict()

    def to_public_envelope(self, *, warnings: list[str] | None = None) -> dict:
        """Public-facing schema 2.0.0 envelope.

        Top-level shape per ADR 2026-04-25:

            {
                "schema_version": "2.0.0",
                "violations": [...public violations...],
                "verdict": "...",
                "review_reason": "..." | None,
                "warnings": [...]
            }

        Substrate-only fields are stripped. The customer web dashboard,
        MCP, CLI, Figma plugin, GitHub Action, LSP, and editor
        extensions all consume this shape directly. The TS layer at
        `/api/check` may add API-usage siblings (`latency_ms`, `tokens`,
        `usage`) at the top level — those are about request metadata,
        not taxonomy, so they live alongside this envelope rather than
        inside it.

        Note that `passes`, `pipeline`, `rationale_chain`, `moment`,
        `audience`, `content_type`, `summary`, and the legacy
        `overall_verdict` are all OMITTED. Engine-internal consumers
        that need them call `to_substrate_dict()` instead.
        """
        return {
            "schema_version": SCHEMA_VERSION,
            "violations": [v.to_public_dict() for v in self.violations],
            "verdict": self.verdict,
            "review_reason": self.review_reason,
            "warnings": list(warnings) if warnings else [],
        }


def derive_verdict(
    *,
    overall_verdict: str,
    violations: list[Violation],
    scan_validate_disagreement: bool = False,
    standards_conflict: bool = False,
    moment_ambiguous: bool = False,
    out_of_distribution: bool = False,
    novel_pattern: bool = False,
) -> tuple[Verdict, str | None]:
    """Compute the three-state Verdict + a typed `review_reason` from raw outputs.

    Returns (verdict, review_reason). review_reason is non-None only when
    verdict == "review_recommended", and carries a specific subtype from
    VALID_REVIEW_REASONS — never a generic fallback.

    Logic (in order):
      - overall_verdict == "error"      → ("error", None)
      - situation_ambiguity ALONE +
        no violations                   → ("pass", None)  [v4.7.1]
      - any review-signal fires         → ("review_recommended",
                                           typed subtype per precedence)
      - no violations                   → ("pass", None)
      - else                            → ("violation", None)

    Note: review signals can flip the verdict to `review_recommended`
    even when `violations` is empty. Session 13 specifically: a
    validate-rejection with nothing surviving is still the ensemble
    disagreeing with itself — Robert reviews regardless.

    Carve-out (v4.7.1): `situation_ambiguity` is uniquely weak among
    review signals — it just means "moment classifier confidence < 0.6,"
    which fires for any text that doesn't trip a specific moment
    pattern (most generic UI copy). Surfacing it for empty-violations
    inputs floods the queue with non-actionable rows. When it's the
    SOLE fired signal AND there are no violations, return pass.

    When multiple review signals fire, the subtype with the highest
    precedence (REVIEW_REASON_PRECEDENCE[0]) wins. Precedence order is
    documented on the constants above.

    Signal sources:
      - `scan_validate_disagreement` (Session 13) — validate rejected
        ≥1 scan candidate. First-pass ensemble disagreeing with
        itself. Fires `ensemble_disagreement`.
      - `standards_conflict` (Session 13, future) — two or more
        standards applied to the same moment returned conflicting
        verdicts. Reserved kwarg; today's pipeline doesn't emit
        multi-standard conflict signals yet. Fires `standards_conflict`.
      - `moment_ambiguous` (Session 2) — moment classifier confidence
        < MOMENT_CONFIDENCE_THRESHOLD (0.6). Fires
        `situation_ambiguity`.
      - `out_of_distribution` — reserved; pending classifier
        confidence plumbing.
      - `novel_pattern` — reserved; pending override-rate history.
      - any Violation.confidence < CONFIDENCE_THRESHOLD — fires
        `low_confidence` (baseline from v1.1.0).
    """
    if overall_verdict == "error":
        return VERDICT_ERROR, None

    low_confidence = any(v.confidence < CONFIDENCE_THRESHOLD for v in violations)

    fired: set[str] = set()
    if standards_conflict:
        fired.add(REVIEW_STANDARDS_CONFLICT)
    if scan_validate_disagreement:
        fired.add(REVIEW_ENSEMBLE_DISAGREEMENT)
    if moment_ambiguous:
        fired.add(REVIEW_SITUATION_AMBIGUITY)
    if out_of_distribution:
        fired.add(REVIEW_OUT_OF_DISTRIBUTION)
    if novel_pattern:
        fired.add(REVIEW_NOVEL_PATTERN)
    if low_confidence:
        fired.add(REVIEW_LOW_CONFIDENCE)

    # `situation_ambiguity` alone is the weakest review signal — it just
    # means the moment heuristic shrugged. Without anything to actually
    # adjudicate (no violations, no other signals), surfacing it as
    # `review_recommended` asks the human to review nothing. Suppress.
    #
    # Other empty-violations review signals (notably ensemble_disagreement
    # per Session 13's "validate rejected the scan" case) still flip to
    # review_recommended — those represent real disagreement worth reading.
    if fired == {REVIEW_SITUATION_AMBIGUITY} and not violations:
        return VERDICT_PASS, None

    if fired:
        for reason in REVIEW_REASON_PRECEDENCE:
            if reason in fired:
                return VERDICT_REVIEW_RECOMMENDED, reason
        # Unreachable — `fired` is always a subset of REVIEW_REASON_PRECEDENCE.
        return VERDICT_REVIEW_RECOMMENDED, REVIEW_LOW_CONFIDENCE

    if not violations:
        return VERDICT_PASS, None
    return VERDICT_VIOLATION, None


# ---------------------------------------------------------------------------
# Batch models
# ---------------------------------------------------------------------------


@dataclass
class ContentItem:
    """A piece of content to check, with optional source metadata.

    Used by the batch handler to track where each string came from
    (Figma layer, file path + line number, or manual input).
    """

    text: str
    label: str = ""          # human-readable name ("Header text", "CTA button")
    file_path: str = ""      # source file (for code scanner)
    line_number: int = 0     # line in source file
    content_type: str = ""   # if known, skips classification

    def to_dict(self) -> dict:
        d: dict = {"text": self.text}
        if self.label:
            d["label"] = self.label
        if self.file_path:
            d["file_path"] = self.file_path
        if self.line_number:
            d["line_number"] = self.line_number
        if self.content_type:
            d["content_type"] = self.content_type
        return d


@dataclass
class ItemResult:
    """Result of checking a single item in a batch."""

    item: ContentItem
    result: CheckResult
    latency: float = 0.0
    tokens: TokenUsage = field(default_factory=TokenUsage)

    def to_dict(self) -> dict:
        return {
            "item": self.item.to_dict(),
            "result": self.result.to_dict(),
            "latency": self.latency,
            "tokens": self.tokens.to_dict(),
        }

    def to_public_envelope(self) -> dict:
        """Public-facing form — wraps the result through `to_public_envelope`."""
        return {
            "item": self.item.to_dict(),
            "result": self.result.to_public_envelope(),
            "latency": self.latency,
            "tokens": self.tokens.to_dict(),
        }


@dataclass
class ConsistencyViolation:
    """A cross-snippet consistency issue found across multiple items."""

    standard_id: str
    rule: str
    issue: str
    suggestion: str
    items_involved: list[str] = field(default_factory=list)  # labels or text snippets

    def to_dict(self) -> dict:
        return {
            "standard_id": self.standard_id,
            "rule": self.rule,
            "issue": self.issue,
            "suggestion": self.suggestion,
            "items_involved": self.items_involved,
        }

    def to_public_dict(self) -> dict:
        """Public-facing schema 2.0.0 shape — strips substrate fields.

        Drops `standard_id` and `rule` (substrate) — only `issue`,
        `suggestion`, and `items_involved` reach user-facing surfaces.
        When `PUBLIC_TAXONOMY=true` the substrate fields are echoed back.
        """
        public: dict[str, Any] = {
            "issue": self.issue,
            "suggestion": self.suggestion,
            "items_involved": self.items_involved,
        }
        if is_public_taxonomy_enabled():
            public.update({
                "standard_id": self.standard_id,
                "rule": self.rule,
            })
        return public


@dataclass
class BatchResult:
    """The complete result of checking a batch of content items."""

    item_results: list[ItemResult] = field(default_factory=list)
    consistency_violations: list[ConsistencyViolation] = field(default_factory=list)
    overall_verdict: str = "pass"  # "pass" if all items pass AND no consistency violations
    total_latency: float = 0.0
    total_tokens: TokenUsage = field(default_factory=TokenUsage)

    @property
    def total_items(self) -> int:
        return len(self.item_results)

    @property
    def items_passed(self) -> int:
        return sum(1 for r in self.item_results if r.result.overall_verdict == "pass")

    @property
    def items_failed(self) -> int:
        return sum(1 for r in self.item_results if r.result.overall_verdict == "fail")

    def to_dict(self) -> dict:
        return {
            "overall_verdict": self.overall_verdict,
            "total_items": self.total_items,
            "items_passed": self.items_passed,
            "items_failed": self.items_failed,
            "consistency_violations": [v.to_dict() for v in self.consistency_violations],
            "item_results": [r.to_dict() for r in self.item_results],
            "total_latency": self.total_latency,
            "total_tokens": self.total_tokens.to_dict(),
        }

    def to_public_envelope(self) -> dict:
        """Public-facing schema 2.0.0 shape for batch results.

        Each item result is rendered through `to_public_envelope`;
        consistency violations are stripped of substrate. Top-level
        metadata (counts, latency, tokens) is non-substrate and stays.
        """
        return {
            "schema_version": SCHEMA_VERSION,
            "overall_verdict": self.overall_verdict,
            "total_items": self.total_items,
            "items_passed": self.items_passed,
            "items_failed": self.items_failed,
            "consistency_violations": [
                v.to_public_dict() for v in self.consistency_violations
            ],
            "item_results": [r.to_public_envelope() for r in self.item_results],
            "total_latency": self.total_latency,
            "total_tokens": self.total_tokens.to_dict(),
        }
