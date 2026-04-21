"""Data models for the content standards checker.

Defines typed contracts for violations, check results, and pipeline metadata.
Every function in the package uses these instead of raw dicts.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Violation:
    """A single content standards violation."""

    standard_id: str
    rule: str
    issue: str
    suggestion: str
    source: str = "llm"  # "deterministic" or "llm"

    def to_dict(self) -> dict:
        return {
            "standard_id": self.standard_id,
            "rule": self.rule,
            "issue": self.issue,
            "suggestion": self.suggestion,
            "source": self.source,
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
    overall_verdict: str  # "pass", "fail", or "error"
    violations: list[Violation] = field(default_factory=list)
    passes: list[PassedStandard] = field(default_factory=list)
    summary: str = ""
    audience: str = "product_ui"  # "product_ui" or "general"
    moment: str = ""  # detected moment ID, empty if not detected
    pipeline: PipelineMeta = field(default_factory=PipelineMeta)

    def to_dict(self) -> dict:
        return {
            "content_type": self.content_type,
            "overall_verdict": self.overall_verdict,
            "violations": [v.to_dict() for v in self.violations],
            "passes": [p.to_dict() for p in self.passes],
            "summary": self.summary,
            "audience": self.audience,
            "moment": self.moment,
            "pipeline": self.pipeline.to_dict(),
        }


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
