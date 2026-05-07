"""Quarterly report scaffold generator.

Phase C3 of the post-pivot rolling plan. Produces one markdown
scaffold per quarter — `reports/quarterly/YYYY-Q.md` — with all the
numbers populated and section headers in place. The founder
hand-edits the narrative before publishing; the combination is the
named-expert artifact (rigor in the numbers, voice in the narrative).

Inputs

  - reports/accuracy/latest.json (current snapshot)
  - reports/calibration/*.md (13 weeks of calibration logs;
    parsed for κ deltas + active refinement entries)
  - taxonomy_refinement_log.md (decided this quarter)

Output: a markdown file with these sections:

  # Quarterly accuracy report — YYYY-Q

  ## Executive summary  (1-paragraph TODO scaffold)
  ## Headline numbers   (latest κ + 95% CI + delta vs quarter start)
  ## Coverage           (standards measured / total + by_level)
  ## Drift              (self-drift κ status)
  ## Calibration trajectory  (week-by-week κ table)
  ## Refinement log activity (counts approved/declined this quarter)
  ## What we got wrong  (founder narrative TODO)
  ## What's next        (founder narrative TODO)

Cron-driven invocation (first Monday of each quarter) lands in C4.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

GENERATOR_VERSION = "1.0.0"

# Path to the canonical standards library — source of truth for the
# total standards count. Same lookup as reports/accuracy/generate.py;
# keep them in sync if either path changes.
_STANDARDS_LIBRARY_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "src"
    / "content_checker"
    / "standards"
    / "private"
    / "standards_library.json"
)

# Conservative fallback when the substrate isn't fetched (CI on a
# fork, fresh dev clone, etc.). Better to under-report than to crash
# the generator.
_FALLBACK_TOTAL_STANDARDS = 49


def _read_total_standards() -> int:
    """Count standards in the canonical library at runtime.

    Mirrors the helper in reports/accuracy/generate.py so the
    quarterly fallback denominator stays in lockstep with the
    nightly accuracy snapshot.
    """
    try:
        data = json.loads(
            _STANDARDS_LIBRARY_PATH.read_text(encoding="utf-8")
        )
    except (FileNotFoundError, json.JSONDecodeError):
        return _FALLBACK_TOTAL_STANDARDS
    total = 0
    for cat in data.get("categories", []):
        total += len(cat.get("standards", []))
    return total or _FALLBACK_TOTAL_STANDARDS


CALIBRATION_FILENAME_RE = re.compile(r"^(\d{4})-(\d{2})\.md$")
KAPPA_LINE_RE = re.compile(
    r"κ\s*=\s*\*\*([\d.]+)\*\*\s*\(95%\s*CI\s*\[([\d.]+),\s*([\d.]+)\],\s*n\s*=\s*(\d+)\)"
)
REFINEMENT_LINE_RE = re.compile(r"^\s*-\s*(REF-A?\d+)")


@dataclass
class CalibrationWeekSnapshot:
    """Distilled-from-markdown view of one week's calibration log."""

    week: str  # "YYYY-WW"
    kappa: float | None
    sample_size: int | None
    active_refinements: int


@dataclass
class QuarterlyReport:
    quarter: str  # "YYYY-Q" (e.g., "2026-Q2")
    generated_at: str
    measured_system: dict | None
    measured_self_drift: dict | None
    design_target: float
    by_level: dict
    standards_measured: int
    standards_total: int
    weeks_in_quarter: list[CalibrationWeekSnapshot]
    kappa_at_quarter_start: float | None
    kappa_delta_pp: float | None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate the quarterly accuracy report scaffold."
    )
    parser.add_argument(
        "--accuracy",
        type=Path,
        default=Path("reports/accuracy/latest.json"),
    )
    parser.add_argument(
        "--calibration-dir",
        type=Path,
        default=Path("reports/calibration"),
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("reports/quarterly"),
    )
    parser.add_argument(
        "--quarter",
        type=str,
        help='Override quarter (e.g. "2026-Q2"). Defaults to current.',
    )
    args = parser.parse_args(argv)

    now = datetime.now(timezone.utc)
    quarter = args.quarter or current_quarter(now.date())
    accuracy = _safe_read_json(args.accuracy)
    weeks = _read_calibration_weeks(args.calibration_dir, quarter)

    report = build_quarterly_report(
        accuracy=accuracy,
        calibration_weeks=weeks,
        quarter=quarter,
        now=now,
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"{quarter}.md"
    out_path.write_text(render_markdown(report), encoding="utf-8")
    print(f"wrote {out_path}", file=sys.stderr)
    return 0


def build_quarterly_report(
    *,
    accuracy: dict | None,
    calibration_weeks: list[CalibrationWeekSnapshot],
    quarter: str,
    now: datetime,
) -> QuarterlyReport:
    measured_system = _extract_kappa(accuracy, "measured_system")
    measured_self_drift = _extract_kappa(accuracy, "measured_self_drift")

    by_level = {"robo_labels": 0, "batch_approval": 0, "autonomous": 0}
    standards_measured = 0
    # Default denominator reads from the canonical library at runtime
    # so adding a standard auto-updates the quarterly report's count.
    # Replaces the hardcoded 47 that drifted against the library.
    standards_total = _read_total_standards()
    if accuracy:
        bl = accuracy.get("by_level")
        if isinstance(bl, dict):
            for k in by_level.keys():
                v = bl.get(k, 0)
                by_level[k] = int(v) if isinstance(v, (int, float)) else 0
        standards_measured = int(accuracy.get("standards_measured", 0) or 0)
        if isinstance(accuracy.get("standards_total"), int):
            standards_total = int(accuracy["standards_total"])

    weeks_sorted = sorted(calibration_weeks, key=lambda w: w.week)
    kappa_at_start = next(
        (w.kappa for w in weeks_sorted if w.kappa is not None), None
    )
    current_kappa = (
        measured_system["value"] if measured_system else None
    )
    kappa_delta_pp = None
    if kappa_at_start is not None and current_kappa is not None:
        kappa_delta_pp = round((current_kappa - kappa_at_start) * 100, 1)

    return QuarterlyReport(
        quarter=quarter,
        generated_at=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        measured_system=measured_system,
        measured_self_drift=measured_self_drift,
        design_target=accuracy.get("design_target", 0.9) if accuracy else 0.9,
        by_level=by_level,
        standards_measured=standards_measured,
        standards_total=standards_total,
        weeks_in_quarter=weeks_sorted,
        kappa_at_quarter_start=kappa_at_start,
        kappa_delta_pp=kappa_delta_pp,
    )


def render_markdown(report: QuarterlyReport) -> str:
    lines: list[str] = []
    lines.append(f"# Quarterly accuracy report — {report.quarter}")
    lines.append("")
    lines.append(
        f"_Scaffold generated {report.generated_at}. "
        "Numbers are populated; the founder writes the narrative for "
        "Executive summary / What we got wrong / What's next before publishing._"
    )
    lines.append("")

    # Executive summary — TODO marker
    lines.append("## Executive summary")
    lines.append("")
    lines.append(
        "<!-- Founder narrative. 2–3 sentences naming the quarter's "
        "headline number + the single decision it drove. -->"
    )
    lines.append("")
    lines.append("> _TODO: write the executive summary._")
    lines.append("")

    # Headline numbers
    lines.append("## Headline numbers")
    lines.append("")
    if report.measured_system:
        m = report.measured_system
        lines.append(
            f"- Measured system κ = **{m['value']:.3f}** "
            f"(95% CI [{m['ci_low']:.3f}, {m['ci_high']:.3f}], n = {m.get('sample_size', 0)})."
        )
    else:
        lines.append("- Measured system κ: _pending — no current snapshot._")
    if report.kappa_delta_pp is not None:
        sign = "+" if report.kappa_delta_pp >= 0 else ""
        lines.append(
            f"- Quarter-to-date delta: {sign}{report.kappa_delta_pp:.1f} percentage points "
            f"(starting κ = {report.kappa_at_quarter_start:.3f})."
        )
    else:
        lines.append(
            "- Quarter-to-date delta: pending — fewer than two weekly κ values "
            "available in this quarter."
        )
    lines.append(f"- Design target: {report.design_target:.2f}.")
    lines.append("")

    # Coverage
    lines.append("## Coverage")
    lines.append("")
    lines.append(
        f"- Standards measured: **{report.standards_measured}** of {report.standards_total}."
    )
    lines.append(
        f"- By graduation level: {report.by_level['autonomous']} autonomous, "
        f"{report.by_level['batch_approval']} batch_approval, "
        f"{report.by_level['robo_labels']} robo_labels."
    )
    lines.append("")

    # Drift
    lines.append("## Drift")
    lines.append("")
    if report.measured_self_drift:
        sd = report.measured_self_drift
        lines.append(
            f"- Self-drift κ = **{sd['value']:.3f}** "
            f"(95% CI [{sd['ci_low']:.3f}, {sd['ci_high']:.3f}]). The expert ceiling — "
            "the system can't out-perform Robert against past-Robert."
        )
    else:
        lines.append("- Self-drift κ: _pending — drift panel awaiting blind re-label + score._")
    lines.append("")

    # Calibration trajectory
    lines.append("## Calibration trajectory")
    lines.append("")
    if not report.weeks_in_quarter:
        lines.append(
            "- No weekly calibration logs available in this quarter yet. "
            "The trajectory table populates once Phase C2 has emitted at "
            "least one week's log."
        )
    else:
        lines.append("| Week | κ | n | Active refinements |")
        lines.append("|---|---|---|---|")
        for w in report.weeks_in_quarter:
            kappa_cell = f"{w.kappa:.3f}" if w.kappa is not None else "—"
            sample_cell = (
                str(w.sample_size) if w.sample_size is not None else "—"
            )
            lines.append(
                f"| {w.week} | {kappa_cell} | {sample_cell} | {w.active_refinements} |"
            )
    lines.append("")

    # Refinement log activity placeholder — needs a richer parser to
    # tally approved/declined-this-quarter; defer to a follow-up.
    lines.append("## Refinement log activity")
    lines.append("")
    lines.append(
        "<!-- TODO: tally refinements approved + declined this quarter. -->"
    )
    lines.append(
        "_Refinement-log activity counts land once the parser tracks "
        "decision dates per entry. For now, see `taxonomy_refinement_log.md` "
        "for the full picture._"
    )
    lines.append("")

    # Founder narrative TODOs
    lines.append("## What we got wrong")
    lines.append("")
    lines.append("<!-- Founder narrative. The honest piece. -->")
    lines.append("")
    lines.append("> _TODO: name the quarter's biggest miss. Be specific._")
    lines.append("")

    lines.append("## What's next")
    lines.append("")
    lines.append("<!-- Founder narrative. -->")
    lines.append("")
    lines.append("> _TODO: name the next quarter's load-bearing decision._")
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def current_quarter(d: date) -> str:
    quarter_num = (d.month - 1) // 3 + 1
    return f"{d.year}-Q{quarter_num}"


def _extract_kappa(accuracy: dict | None, key: str) -> dict | None:
    if not accuracy:
        return None
    block = accuracy.get(key)
    if not isinstance(block, dict):
        return None
    if block.get("state") != "measured":
        return None
    if not isinstance(block.get("value"), (int, float)):
        return None
    return {
        "value": float(block["value"]),
        "ci_low": float(block.get("ci_low", block["value"])),
        "ci_high": float(block.get("ci_high", block["value"])),
        "sample_size": int(block.get("sample_size", 0)),
    }


def _read_calibration_weeks(
    directory: Path, quarter: str
) -> list[CalibrationWeekSnapshot]:
    if not directory.exists() or not directory.is_dir():
        return []
    weeks: list[CalibrationWeekSnapshot] = []
    for entry in sorted(directory.iterdir()):
        if not entry.is_file():
            continue
        m = CALIBRATION_FILENAME_RE.match(entry.name)
        if not m:
            continue
        year = int(m.group(1))
        week_num = int(m.group(2))
        if not _week_belongs_to_quarter(year, week_num, quarter):
            continue
        try:
            md = entry.read_text(encoding="utf-8")
        except OSError:
            continue
        snap = _parse_calibration_week(
            week=f"{year}-{week_num:02d}", md=md
        )
        weeks.append(snap)
    return weeks


def _week_belongs_to_quarter(year: int, week_num: int, quarter: str) -> bool:
    """Map an ISO week to its quarter and compare. Pure date math —
    avoids pulling in dateutil."""
    try:
        q_year, q_token = quarter.split("-Q")
        q_num = int(q_token)
        if int(q_year) != year:
            return False
    except (ValueError, AttributeError):
        return False
    # The Monday of ISO week N is the start; use it to identify the quarter.
    monday = date.fromisocalendar(year, week_num, 1)
    week_quarter = (monday.month - 1) // 3 + 1
    return week_quarter == q_num


def _parse_calibration_week(*, week: str, md: str) -> CalibrationWeekSnapshot:
    kappa: float | None = None
    sample_size: int | None = None
    active_refinements = 0

    in_refinements = False
    for line in md.split("\n"):
        if KAPPA_LINE_RE.search(line):
            m = KAPPA_LINE_RE.search(line)
            assert m
            try:
                kappa = float(m.group(1))
                sample_size = int(m.group(4))
            except ValueError:
                pass
        if line.startswith("## Active refinements"):
            in_refinements = True
            continue
        if in_refinements and line.startswith("## "):
            in_refinements = False
            continue
        if in_refinements and REFINEMENT_LINE_RE.match(line):
            active_refinements += 1

    return CalibrationWeekSnapshot(
        week=week,
        kappa=kappa,
        sample_size=sample_size,
        active_refinements=active_refinements,
    )


def _safe_read_json(path: Path | None) -> dict | None:
    if path is None:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
