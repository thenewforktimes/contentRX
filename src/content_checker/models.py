"""Data models for the content standards checker.

Defines typed contracts for violations, check results, and pipeline metadata.
Every function in the package uses these instead of raw dicts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


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
SCHEMA_VERSION = "1.1.0"


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
        result = self.result
        if hasattr(result, "to_dict"):
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
    """

    standard_id: str
    rule: str
    issue: str
    suggestion: str
    source: str = "llm"  # "deterministic" or "llm"
    confidence: float = DEFAULT_CONFIDENCE_LLM

    def to_dict(self) -> dict:
        return {
            "standard_id": self.standard_id,
            "rule": self.rule,
            "issue": self.issue,
            "suggestion": self.suggestion,
            "source": self.source,
            "confidence": self.confidence,
        }


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
    """API token usage tracking."""

    input: int = 0
    output: int = 0

    def __iadd__(self, other: TokenUsage) -> TokenUsage:
        self.input += other.input
        self.output += other.output
        return self

    def to_dict(self) -> dict:
        return {"input": self.input, "output": self.output}


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

    def to_dict(self) -> dict:
        return {
            "content_type": self.content_type,
            "overall_verdict": self.overall_verdict,
            "verdict": self.verdict,
            "violations": [v.to_dict() for v in self.violations],
            "passes": [p.to_dict() for p in self.passes],
            "summary": self.summary,
            "audience": self.audience,
            "moment": self.moment,
            "review_reason": self.review_reason,
            "pipeline": self.pipeline.to_dict(),
        }


def derive_verdict(
    *,
    overall_verdict: str,
    violations: list[Violation],
) -> tuple[Verdict, str | None]:
    """Compute the three-state Verdict + a `review_reason` from raw outputs.

    Returns (verdict, review_reason). review_reason is non-None only when
    verdict == "review_recommended", and explains which signal flipped it.

    Logic:
      - overall_verdict == "error"            → ("error", None)
      - no violations                         → ("pass", None)
      - any violation.confidence < THRESHOLD  → ("review_recommended",
                                                 "low_confidence")
      - else                                   → ("violation", None)

    Future signal sources (BUILD_PLAN_v2 Session 10 spec, deferred):
      - moment classifier confidence < 0.6
      - historical override rate > 30%
    """
    if overall_verdict == "error":
        return VERDICT_ERROR, None
    if not violations:
        return VERDICT_PASS, None
    low = [v for v in violations if v.confidence < CONFIDENCE_THRESHOLD]
    if low:
        return VERDICT_REVIEW_RECOMMENDED, "low_confidence"
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
