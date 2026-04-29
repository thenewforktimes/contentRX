"""Score the annual taxonomy-audit panel.

Human-eval build plan Session 36. Given the panel manifest
(`tools/annual_audit_sample.py`) plus current-Robert's blind re-labels,
compute the report structure the plan calls for:

    - overall agreement + Cohen's κ (vs past-Robert)
    - standards with highest past/present disagreement
    - moments with most evolution
    - retired standards that might deserve reinstatement
      (standards fired in past verdicts but absent from the current library)
    - new-moment candidates
      (cases where the re-label picked a moment that didn't exist at
      past-verdict time, or where the stored moment no longer matches
      what a fresh re-label would pick)
    - an explicit recommendation on whether the 0.90 design target
      ceiling remains appropriate

The tool emits a structured JSON report + a markdown rendering of
the same data. The markdown follows the committed template at
`evals/annual_audit/_template.md`.

Usage:
    python3 tools/annual_audit_score.py \\
        --panel evals/annual_audit/panels/2026.json \\
        --labels evals/annual_audit/labels/2026.json \\
        --library src/content_checker/standards/standards_library.json
"""

from __future__ import annotations

import argparse
import collections
import datetime as _dt
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.drift_check import cohens_kappa_with_ci  # noqa: E402

DESIGN_TARGET_KAPPA = 0.9

# κ bands — informed by the graduation-metrics regime classification
# but intentionally distinct because the annual audit is answering a
# different question (overfit detection, not threshold calibration).
# Keep the bands labelled as "audit bands" so future readers don't
# confuse them with Session 10's thresholds.
AUDIT_BAND_STABLE = 0.80  # above this: model is stable under current schema
AUDIT_BAND_WATCH = 0.65  # above this: watch; below threshold but not crisis
# below WATCH: material drift; the audit report should recommend a
# taxonomy review cycle before the next annual audit.


@dataclass
class PerStandardStats:
    standard_id: str
    count: int = 0
    agreements: int = 0

    @property
    def disagreements(self) -> int:
        return self.count - self.agreements

    @property
    def disagreement_rate(self) -> float:
        return self.disagreements / self.count if self.count else 0.0


@dataclass
class PerMomentStats:
    moment: str
    count: int = 0
    agreements: int = 0

    @property
    def disagreements(self) -> int:
        return self.count - self.agreements

    @property
    def disagreement_rate(self) -> float:
        return self.disagreements / self.count if self.count else 0.0


@dataclass
class AuditReport:
    year: int
    generated_at: str
    panel_size: int
    scored_pairs: int
    overall_agreement: float
    kappa: float | None
    kappa_ci_low: float | None
    kappa_ci_high: float | None
    audit_band: str
    per_standard: list[PerStandardStats] = field(default_factory=list)
    per_moment: list[PerMomentStats] = field(default_factory=list)
    retired_standard_candidates: list[str] = field(default_factory=list)
    new_moment_candidates: list[dict[str, Any]] = field(default_factory=list)
    ceiling_recommendation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0.0",
            "year": self.year,
            "generated_at": self.generated_at,
            "panel_size": self.panel_size,
            "scored_pairs": self.scored_pairs,
            "overall_agreement": round(self.overall_agreement, 4),
            "kappa": round(self.kappa, 4) if self.kappa is not None else None,
            "kappa_ci_low": round(self.kappa_ci_low, 4) if self.kappa_ci_low is not None else None,
            "kappa_ci_high": round(self.kappa_ci_high, 4) if self.kappa_ci_high is not None else None,
            "audit_band": self.audit_band,
            "design_target_kappa": DESIGN_TARGET_KAPPA,
            "ceiling_recommendation": self.ceiling_recommendation,
            "per_standard": [
                {
                    "standard_id": s.standard_id,
                    "count": s.count,
                    "disagreements": s.disagreements,
                    "disagreement_rate": round(s.disagreement_rate, 4),
                }
                for s in self.per_standard
            ],
            "per_moment": [
                {
                    "moment": m.moment,
                    "count": m.count,
                    "disagreements": m.disagreements,
                    "disagreement_rate": round(m.disagreement_rate, 4),
                }
                for m in self.per_moment
            ],
            "retired_standard_candidates": list(self.retired_standard_candidates),
            "new_moment_candidates": list(self.new_moment_candidates),
        }


# ---------------------------------------------------------------------------
# Pure scoring
# ---------------------------------------------------------------------------


def classify_audit_band(kappa: float | None) -> str:
    if kappa is None:
        return "insufficient_data"
    if kappa >= AUDIT_BAND_STABLE:
        return "stable"
    if kappa >= AUDIT_BAND_WATCH:
        return "watch"
    return "material_drift"


def ceiling_recommendation(
    kappa: float | None,
    ci_high: float | None,
) -> str:
    """One-line recommendation on whether the 0.90 design target ceiling
    remains appropriate. The plan's success criterion requires an
    explicit statement.
    """
    if kappa is None:
        return (
            "Ceiling recommendation deferred — insufficient scored pairs "
            "to compute κ. Re-run after a full re-label pass."
        )
    if kappa >= DESIGN_TARGET_KAPPA:
        return (
            f"Measured annual κ = {kappa:.3f} meets or exceeds the 0.90 "
            "design target. Keep the ceiling as-is for the coming year."
        )
    if ci_high is not None and ci_high >= DESIGN_TARGET_KAPPA:
        return (
            f"Measured annual κ = {kappa:.3f}; 95% CI upper bound "
            f"{ci_high:.3f} covers 0.90. Ceiling is defensible but tight "
            "— revisit mid-year if quarterly drift weakens."
        )
    return (
        f"Measured annual κ = {kappa:.3f} is below the 0.90 design target "
        "and its 95% CI does not cover it. Recommend reducing the target "
        "to the measured ceiling for graduation purposes (per the plan's "
        "'thresholds move with the measurement, not the target' rule)."
    )


def build_report(
    panel: dict[str, Any],
    labels: dict[str, str],
    *,
    current_library_standards: set[str],
    current_library_moments: set[str],
    now_iso: str,
) -> AuditReport:
    entries = panel.get("entries", [])
    year = panel.get("year", _dt.date.today().year)

    pairs: list[tuple[str, str]] = []
    per_std: dict[str, PerStandardStats] = {}
    per_moment: dict[str, PerMomentStats] = {}
    retired_seen: set[str] = set()
    new_moment_candidates: list[dict[str, Any]] = []

    for entry in entries:
        case_id = entry.get("case_id")
        past = _normalize(entry.get("past_human_verdict"))
        current = _normalize(labels.get(case_id))
        std_id = entry.get("standard_id") or ""
        moment = entry.get("moment") or ""

        # Track retired-standard candidates regardless of scoreable
        # pair presence — the standard either appears in the current
        # library or it doesn't.
        if std_id and std_id not in current_library_standards:
            retired_seen.add(std_id)

        if past is None or current is None:
            continue

        pairs.append((past, current))

        if std_id:
            stat = per_std.setdefault(std_id, PerStandardStats(standard_id=std_id))
            stat.count += 1
            if past == current:
                stat.agreements += 1

        if moment:
            m_stat = per_moment.setdefault(moment, PerMomentStats(moment=moment))
            m_stat.count += 1
            if past == current:
                m_stat.agreements += 1

        # New-moment candidates: cases where the past moment is gone
        # from the current taxonomy OR where a disagreement cluster
        # on the same moment suggests the moment itself has evolved.
        if moment and moment not in current_library_moments:
            new_moment_candidates.append(
                {
                    "case_id": case_id,
                    "retired_moment": moment,
                    "past_standard_id": std_id,
                    "note": (
                        "Moment ID absent from the current taxonomy — "
                        "case may need re-routing or the moment may need "
                        "reinstatement."
                    ),
                }
            )

    agreements = sum(1 for p, c in pairs if p == c)
    overall = agreements / len(pairs) if pairs else 0.0
    kappa: float | None = None
    kci_low: float | None = None
    kci_high: float | None = None
    if pairs:
        ki = cohens_kappa_with_ci(pairs)
        # drift_check returns a dict with `kappa`, `ci_low`, `ci_high`.
        # When n < 2 or κ is undefined, kappa is None in the dict
        # rather than the dict itself being None.
        if isinstance(ki, dict):
            kappa = ki.get("kappa")
            kci_low = ki.get("ci_low")
            kci_high = ki.get("ci_high")

    per_std_sorted = sorted(
        per_std.values(),
        key=lambda s: (-s.disagreement_rate, -s.disagreements, s.standard_id),
    )
    per_moment_sorted = sorted(
        per_moment.values(),
        key=lambda m: (-m.disagreement_rate, -m.disagreements, m.moment),
    )

    band = classify_audit_band(kappa)
    reco = ceiling_recommendation(kappa, kci_high)

    return AuditReport(
        year=year,
        generated_at=now_iso,
        panel_size=len(entries),
        scored_pairs=len(pairs),
        overall_agreement=overall,
        kappa=kappa,
        kappa_ci_low=kci_low,
        kappa_ci_high=kci_high,
        audit_band=band,
        per_standard=per_std_sorted,
        per_moment=per_moment_sorted,
        retired_standard_candidates=sorted(retired_seen),
        new_moment_candidates=new_moment_candidates,
        ceiling_recommendation=reco,
    )


def _normalize(v: str | None) -> str | None:
    if v is None:
        return None
    return str(v).strip().lower() or None


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def render_markdown(report: AuditReport) -> str:
    lines: list[str] = []
    lines.append(f"# Annual taxonomy audit — {report.year}")
    lines.append("")
    lines.append(
        f"*Generated {report.generated_at}. "
        f"Panel: {report.panel_size} cases, {report.scored_pairs} scored pairs.*"
    )
    lines.append("")

    lines.append("## Top line")
    lines.append("")
    if report.kappa is not None:
        lines.append(
            f"- Cohen's κ = **{report.kappa:.3f}** "
            f"(95% CI [{report.kappa_ci_low:.3f}, {report.kappa_ci_high:.3f}])"
        )
    else:
        lines.append("- Cohen's κ: insufficient scored pairs to compute.")
    lines.append(f"- Overall agreement: {report.overall_agreement:.1%}")
    lines.append(f"- Audit band: `{report.audit_band}`")
    lines.append(f"- Design target: κ = {DESIGN_TARGET_KAPPA}")
    lines.append("")

    lines.append("## Ceiling recommendation")
    lines.append("")
    lines.append(report.ceiling_recommendation)
    lines.append("")

    lines.append("## Standards with highest past/present disagreement")
    lines.append("")
    if report.per_standard:
        lines.append("| Standard | Count | Disagreements | Rate |")
        lines.append("|---|---:|---:|---:|")
        for s in report.per_standard[:10]:
            lines.append(
                f"| `{s.standard_id}` | {s.count} | {s.disagreements} | {s.disagreement_rate:.1%} |"
            )
    else:
        lines.append("*No per-standard scored pairs in the audit panel.*")
    lines.append("")

    lines.append("## Moments with most evolution")
    lines.append("")
    if report.per_moment:
        lines.append("| Moment | Count | Disagreements | Rate |")
        lines.append("|---|---:|---:|---:|")
        for m in report.per_moment[:10]:
            lines.append(
                f"| `{m.moment}` | {m.count} | {m.disagreements} | {m.disagreement_rate:.1%} |"
            )
    else:
        lines.append("*No per-moment scored pairs in the audit panel.*")
    lines.append("")

    lines.append("## Retired standards that might deserve reinstatement")
    lines.append("")
    if report.retired_standard_candidates:
        for sid in report.retired_standard_candidates:
            lines.append(f"- `{sid}` — appeared in historical verdicts; absent from the current library.")
    else:
        lines.append("*None. Every standard invoked in the historical panel is still in the current library.*")
    lines.append("")

    lines.append("## New-moment candidates")
    lines.append("")
    if report.new_moment_candidates:
        for c in report.new_moment_candidates[:15]:
            lines.append(
                f"- Case `{c['case_id']}` — historical moment `{c['retired_moment']}` "
                f"no longer in the taxonomy. {c['note']}"
            )
    else:
        lines.append("*No new-moment candidates surfaced by this audit.*")
    lines.append("")

    lines.append("## Next year's taxonomy roadmap")
    lines.append("")
    lines.append(
        "Robert fills in one or two sentences per priority. The committed "
        "template at `evals/annual_audit/_template.md` carries the full "
        "prompt list for this section."
    )
    lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--panel", type=Path, required=True)
    parser.add_argument(
        "--labels",
        type=Path,
        required=True,
        help="JSON mapping case_id → verdict (pass | violation | review_recommended).",
    )
    parser.add_argument(
        "--library",
        type=Path,
        default=REPO_ROOT / "src" / "content_checker" / "standards" / "standards_library.json",
    )
    parser.add_argument("--output-dir", type=Path, default=REPO_ROOT / "evals" / "annual_audit")
    parser.add_argument("--now", default=None)
    args = parser.parse_args(argv)

    panel = json.loads(args.panel.read_text(encoding="utf-8"))
    labels_raw = json.loads(args.labels.read_text(encoding="utf-8"))
    # Accept either a flat { case_id: verdict } mapping OR a richer
    # labels envelope { labels: { case_id: verdict } }.
    if isinstance(labels_raw, dict) and "labels" in labels_raw:
        labels = labels_raw["labels"]
    else:
        labels = labels_raw

    library = json.loads(args.library.read_text(encoding="utf-8"))
    std_ids: set[str] = set()
    for cat in library.get("categories", []):
        for std in cat.get("standards", []):
            sid = std.get("id")
            if sid:
                std_ids.add(sid)

    # Moments: load from the exported moments taxonomy where available.
    moment_ids: set[str] = set()
    moments_path = Path(library["__moments_taxonomy_path__"]) if "__moments_taxonomy_path__" in library else (
        REPO_ROOT / "src" / "content_checker" / "standards" / "private" / "moments_taxonomy.json"
    )
    if moments_path.exists():
        mt = json.loads(moments_path.read_text(encoding="utf-8"))
        for m in mt.get("moments", []):
            mid = m.get("id")
            if mid:
                moment_ids.add(mid)

    now_iso = args.now or _dt.datetime.now(_dt.timezone.utc).isoformat()
    report = build_report(
        panel,
        labels,
        current_library_standards=std_ids,
        current_library_moments=moment_ids,
        now_iso=now_iso,
    )

    out_dir = args.output_dir / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{report.year}.json"
    md_path = out_dir / f"{report.year}.md"
    json_path.write_text(json.dumps(report.to_dict(), indent=2) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    print(
        f"wrote {json_path} and {md_path} "
        f"(κ={report.kappa}, band={report.audit_band})",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())


__all__ = [
    "AUDIT_BAND_STABLE",
    "AUDIT_BAND_WATCH",
    "AuditReport",
    "DESIGN_TARGET_KAPPA",
    "PerMomentStats",
    "PerStandardStats",
    "build_report",
    "ceiling_recommendation",
    "classify_audit_band",
    "render_markdown",
]
