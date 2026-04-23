"""Quarterly self-drift check — human-eval build plan Session 7.

Measures Cohen's κ between past-Robo verdicts and a fresh blind
re-labeling pass on the same cases. The resulting "measured ceiling"
is the single most important number in the graduation ladder —
Session 10's thresholds are expressed as ratios against it.

Workflow (one cycle per quarter):

    1. build-panel    Pick an 80-case stratified sample from the
                      eligible pool, weighted across (moment, content_type).
                      Writes evals/drift/panels/<yyyy-qq>.json.

    2. export-blind   Strip past verdicts + rationale from the panel
                      so Robo can re-label without bias. Writes a
                      standalone JSON suitable for any review surface
                      (the Session 8 queue UI will consume this
                      directly).

    3. score          Given the panel and Robo's fresh labels, compute
                      Cohen's κ + 95% CI + per-standard disagreement
                      breakdown + threshold-regime classification.
                      Writes evals/drift/reports/<yyyy-qq>.json; this
                      report is the input to Session 10's graduation
                      metrics.

Design notes:

- 80 cases rather than the 2k²=338 Cicchetti & Fleiss minimum. The
  plan spec accepts 80 with "contingency margin" — practical review
  burden matters more here than textbook sample size.
- Stratification is deterministic. Same eligible pool + same seed →
  same panel. Growth is stable: adding cases to the pool doesn't
  churn an existing panel (cases are sorted within each bucket).
- The tool never reads or modifies any file outside `evals/drift/`
  and the (gitignored) corpus. Session 10 reads the report JSON;
  this tool doesn't write thresholds into other modules.
- Missing-moment degradation: if the eligible pool lacks cases for
  some moments (today: destructive_action, confirmation,
  empty_state, interruption, compliance_disclosure), stratification
  skips them rather than lowering the per-moment floor. The report
  documents the skipped moments so the threshold isn't quietly
  calibrated on a shrunken pool.
"""

from __future__ import annotations

import argparse
import collections
import datetime as _dt
import json
import math
import sys
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_CORPUS_DIR = Path("evals/industry")
DEFAULT_PANEL_DIR = Path("evals/drift/panels")
DEFAULT_REPORT_DIR = Path("evals/drift/reports")
DEFAULT_PANEL_SIZE = 80

# Age gate: drift panel items must be at least this old so re-labeling
# is genuinely "past-Robo vs current-Robo", not "same-session double-
# tap." Expressed as days from the case's review time.
MIN_AGE_DAYS = 90


# ---------------------------------------------------------------------------
# Threshold recalibration (consumed by Session 10's graduation metrics)
# ---------------------------------------------------------------------------

# Plan-spec ratios — Session 10 expresses thresholds as multiples of the
# measured ceiling so they auto-adjust as the ceiling drifts.
AUTONOMOUS_RATIO = 0.94        # autonomous κ ≥ 0.94 × ceiling (= 0.85 at target)
BATCH_APPROVAL_RATIO = 0.83    # batch κ ≥ 0.83 × ceiling (= 0.75 at target)

# Regime boundaries from the plan's "Measured-ceiling regimes" table.
REGIME_TARGET_MET = "target_met"           # ceiling ≥ 0.90
REGIME_MATURING = "maturing"               # 0.85 ≤ ceiling < 0.90
REGIME_FROZEN = "graduation_frozen"        # 0.80 ≤ ceiling < 0.85
REGIME_DEGRADED = "degraded"               # ceiling < 0.80


def classify_regime(measured_ceiling: float) -> str:
    """Plan-spec regime classification.

    - ≥ 0.90           : target met (ship normally)
    - 0.85 ≤ c < 0.90  : maturing — thresholds still move with ceiling;
                          taxonomy stabilization review required before
                          autonomous graduations resume.
    - 0.80 ≤ c < 0.85  : frozen — no new autonomous graduations.
    - < 0.80           : degraded — existing autonomous standards re-
                          reviewed in next cycle.
    """
    if measured_ceiling >= 0.90:
        return REGIME_TARGET_MET
    if measured_ceiling >= 0.85:
        return REGIME_MATURING
    if measured_ceiling >= 0.80:
        return REGIME_FROZEN
    return REGIME_DEGRADED


def calibrate_thresholds(measured_ceiling: float) -> dict[str, Any]:
    """Convert a measured ceiling into graduation thresholds.

    Output shape matches what Session 10's graduation metrics expect to
    read from the drift report. Ratios are constants; only the ceiling
    varies quarter-to-quarter.
    """
    regime = classify_regime(measured_ceiling)
    return {
        "measured_ceiling": measured_ceiling,
        "regime": regime,
        "autonomous_kappa": AUTONOMOUS_RATIO * measured_ceiling,
        "batch_approval_kappa": BATCH_APPROVAL_RATIO * measured_ceiling,
        "autonomous_ratio": AUTONOMOUS_RATIO,
        "batch_approval_ratio": BATCH_APPROVAL_RATIO,
        "blocks_new_autonomous": regime in (REGIME_FROZEN, REGIME_DEGRADED),
    }


# ---------------------------------------------------------------------------
# Cohen's κ with 95% CI
# ---------------------------------------------------------------------------


def cohens_kappa(pairs: list[tuple[str, str]]) -> float | None:
    """Cohen's κ on binary rater pairs."""
    if len(pairs) < 2:
        return None
    n = len(pairs)
    po = sum(1 for a, b in pairs if a == b) / n
    counts_a = collections.Counter(a for a, _ in pairs)
    counts_b = collections.Counter(b for _, b in pairs)
    labels = set(counts_a) | set(counts_b)
    pe = sum(
        (counts_a.get(lbl, 0) / n) * (counts_b.get(lbl, 0) / n) for lbl in labels
    )
    if pe >= 1.0:
        return None
    return (po - pe) / (1.0 - pe)


def cohens_kappa_with_ci(
    pairs: list[tuple[str, str]],
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Cohen's κ + asymptotic 95% CI (Fleiss 1969, Eq. 13).

    Standard error for two-rater binary κ:
        SE(κ) = √( po(1-po) / [n(1-pe)²] )

    95% CI: κ ± z_{1-α/2} × SE.

    Returns a dict with `kappa`, `ci_low`, `ci_high`, `n`, and
    `observed_agreement`. When κ is undefined (n<2 or marginals
    perfect), returns None for κ + CI fields but keeps `n` +
    `observed_agreement` (the latter may still be 1.0).
    """
    n = len(pairs)
    observed = (
        sum(1 for a, b in pairs if a == b) / n if n > 0 else None
    )
    kappa = cohens_kappa(pairs)
    ci_low: float | None = None
    ci_high: float | None = None

    if kappa is not None and n >= 2:
        po = observed or 0.0
        counts_a = collections.Counter(a for a, _ in pairs)
        counts_b = collections.Counter(b for _, b in pairs)
        labels = set(counts_a) | set(counts_b)
        pe = sum(
            (counts_a.get(lbl, 0) / n) * (counts_b.get(lbl, 0) / n)
            for lbl in labels
        )
        denom_sq = n * (1.0 - pe) ** 2
        if denom_sq > 0:
            se = math.sqrt((po * (1.0 - po)) / denom_sq)
            # 95% CI via normal approximation (alpha=0.05 → z≈1.96).
            z = 1.959963984540054 if abs(alpha - 0.05) < 1e-9 else _inv_std_normal(1 - alpha / 2)
            ci_low = kappa - z * se
            ci_high = kappa + z * se

    return {
        "kappa": kappa,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "n": n,
        "observed_agreement": observed,
    }


def _inv_std_normal(p: float) -> float:
    """Inverse CDF of the standard normal at p. Rational approximation
    good to ~1e-7; sufficient for CI reporting."""
    # Peter J. Acklam's algorithm.
    a = [
        -3.969683028665376e+01, 2.209460984245205e+02,
        -2.759285104469687e+02, 1.383577518672690e+02,
        -3.066479806614716e+01, 2.506628277459239e+00,
    ]
    b = [
        -5.447609879822406e+01, 1.615858368580409e+02,
        -1.556989798598866e+02, 6.680131188771972e+01,
        -1.328068155288572e+01,
    ]
    c = [
        -7.784894002430293e-03, -3.223964580411365e-01,
        -2.400758277161838e+00, -2.549732539343734e+00,
        4.374664141464968e+00, 2.938163982698783e+00,
    ]
    d = [
        7.784695709041462e-03, 3.224671290700398e-01,
        2.445134137142996e+00, 3.754408661907416e+00,
    ]
    plow = 0.02425
    phigh = 1 - plow
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
            (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1
        )
    if p <= phigh:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (
            ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1
        )
    q = math.sqrt(-2 * math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
        (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1
    )


# ---------------------------------------------------------------------------
# Loading + eligibility (mirrors tools/select_held_out.py)
# ---------------------------------------------------------------------------


def load_cases(corpus_dir: Path) -> list[dict[str, Any]]:
    all_cases: list[dict[str, Any]] = []
    for path in sorted(corpus_dir.glob("*.json")):
        with open(path) as f:
            data = json.load(f)
        cases = data.get("cases", data) if isinstance(data, dict) else data
        if not isinstance(cases, list):
            continue
        for i, case in enumerate(cases, start=1):
            case["_source_file"] = path.name
            cid = case.get("case_id")
            if cid is None or cid == "":
                case["case_id"] = f"auto:{path.name}:{i}"
            all_cases.append(case)
    return all_cases


def is_eligible(case: dict[str, Any]) -> bool:
    """Same eligibility filter as Session 5's held-out tool."""
    return (
        case.get("human_confidence") == "high"
        and case.get("review_status") in {"approved", "revised"}
    )


# ---------------------------------------------------------------------------
# Stratified panel construction
# ---------------------------------------------------------------------------


def _bucket_key(case: dict[str, Any]) -> tuple[str, str]:
    return (case.get("moment") or "(none)", case.get("content_type") or "(none)")


def _sort_key(case: dict[str, Any]) -> tuple[str, str]:
    return (case.get("_source_file", ""), str(case.get("case_id", "")))


def build_panel(
    cases: list[dict[str, Any]],
    size: int = DEFAULT_PANEL_SIZE,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Select `size` cases stratified by (moment, content_type).

    Largest-remainder allocation assigns proportional slots per bucket;
    ties broken deterministically by bucket key. Within each bucket,
    pick in `(source_file, case_id)` order. If any bucket's quota
    exceeds its available eligible cases, the shortfall redistributes
    via a residual fill pass in deterministic order.
    """
    eligible = [c for c in cases if is_eligible(c)]
    if not eligible:
        return [], {
            "eligible_pool": 0,
            "selected": 0,
            "buckets": {},
            "skipped_moments": [],
        }

    by_bucket: dict[tuple[str, str], list[dict[str, Any]]] = collections.defaultdict(list)
    for c in eligible:
        by_bucket[_bucket_key(c)].append(c)

    # Largest-remainder allocation.
    total = len(eligible)
    quotas: dict[tuple[str, str], float] = {
        key: size * len(rows) / total for key, rows in by_bucket.items()
    }
    floors: dict[tuple[str, str], int] = {key: int(q) for key, q in quotas.items()}
    allocated = sum(floors.values())
    slack = size - allocated
    fractional = sorted(
        (((q - int(q)), key) for key, q in quotas.items()),
        reverse=True,
    )
    for _, key in fractional[:slack]:
        floors[key] += 1

    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    for key in sorted(by_bucket.keys()):
        quota = floors.get(key, 0)
        if quota <= 0:
            continue
        picks = _pick_from(by_bucket[key], quota, selected_ids)
        selected.extend(picks)

    # Residual fill if any bucket's quota outran its leftover.
    if len(selected) < size:
        remaining = size - len(selected)
        picks = _pick_from(eligible, remaining, selected_ids)
        selected.extend(picks)

    selected.sort(key=_sort_key)

    bucket_counts = collections.Counter(_bucket_key(c) for c in selected)
    skipped = sorted({
        moment
        for moment in {_bucket_key(c)[0] for c in eligible}
        if not any(bucket_counts[(moment, ct)] > 0 for _, ct in by_bucket)
    })

    stats = {
        "eligible_pool": len(eligible),
        "selected": len(selected),
        "buckets": {f"{m}|{ct}": n for (m, ct), n in sorted(bucket_counts.items())},
        "skipped_moments": skipped,
        "moments_covered": sorted({_bucket_key(c)[0] for c in selected}),
    }
    return selected, stats


def _pick_from(
    bucket: list[dict[str, Any]],
    count: int,
    selected_ids: set[str],
) -> list[dict[str, Any]]:
    picked: list[dict[str, Any]] = []
    for case in sorted(bucket, key=_sort_key):
        if len(picked) >= count:
            break
        cid = str(case.get("case_id", ""))
        if cid in selected_ids:
            continue
        picked.append(case)
        selected_ids.add(cid)
    return picked


# ---------------------------------------------------------------------------
# Panel + report serialization
# ---------------------------------------------------------------------------


def build_panel_manifest(
    selected: list[dict[str, Any]],
    stats: dict[str, Any],
    *,
    quarter: str,
    generated_at: str,
    corpus_dir: Path,
    size: int,
) -> dict[str, Any]:
    """A panel manifest records which cases are in the panel + their
    historical verdicts, so `score` can compare current labels
    against them later.
    """
    return {
        "description": (
            f"Quarterly self-drift panel for {quarter}. Blind re-label "
            "this panel and pass the responses to `drift_check.py score` "
            "to compute the measured-ceiling κ."
        ),
        "schema_version": "1.0.0",
        "quarter": quarter,
        "generated_at": generated_at,
        "corpus_dir": str(corpus_dir),
        "panel_size_target": size,
        "stats": stats,
        "entries": [
            {
                "case_id": c.get("case_id"),
                "source_file": c.get("_source_file"),
                "moment": c.get("moment"),
                "content_type": c.get("content_type"),
                "standard_id": c.get("standard_id"),
                # Historical verdict — the "past-Robo" baseline. This is
                # the value re-labeling will be compared against.
                "past_human_verdict": c.get("human_verdict"),
                "past_human_confidence": c.get("human_confidence"),
            }
            for c in selected
        ],
    }


def build_blind_panel(panel: dict[str, Any], corpus_index: dict[str, dict[str, dict[str, Any]]]) -> dict[str, Any]:
    """Strip past verdicts + rationale so re-labeling is truly blind.

    The output file is what Robo sees during re-labeling. Keeps the
    input text + content_type + moment + standard_id context so the
    re-labeling context matches the original, but hides the prior
    verdict, confidence, human_notes, and any triage commentary.
    """
    entries: list[dict[str, Any]] = []
    missing: list[str] = []
    for ref in panel.get("entries", []):
        src = ref.get("source_file") or ""
        cid = str(ref.get("case_id") or "")
        case = corpus_index.get(src, {}).get(cid)
        if case is None:
            missing.append(f"{src}::{cid}")
            continue
        entries.append(
            {
                "case_id": cid,
                "source_file": src,
                "text": case.get("text") or case.get("input") or "",
                "content_type": case.get("content_type"),
                "moment": case.get("moment"),
                "standard_id": case.get("standard_id"),
                # Blind: NO past_human_verdict, NO human_notes, NO
                # machine_verdict. If the UI needs those for recall
                # suppression it can still filter server-side.
            }
        )
    return {
        "description": (
            "Blind re-labeling panel — past verdicts and rationale "
            "intentionally omitted. Pair each entry with a fresh "
            "human_verdict + human_confidence and pass the file to "
            "`drift_check.py score`."
        ),
        "quarter": panel.get("quarter"),
        "generated_at_source": panel.get("generated_at"),
        "entries": entries,
        "missing": missing,
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def _normalize(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip().lower()
    if v in {"pass", "fail"}:
        return v
    return None


def compute_drift_report(
    panel: dict[str, Any],
    responses: list[dict[str, Any]],
    *,
    quarter: str | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Score a blind re-labeling pass against stored past verdicts."""
    past_by_id: dict[str, dict[str, Any]] = {
        e["case_id"]: e for e in panel.get("entries", []) if e.get("case_id")
    }
    current_by_id: dict[str, dict[str, Any]] = {
        r["case_id"]: r for r in responses if r.get("case_id")
    }

    pairs: list[tuple[str, str]] = []
    disagreements: list[dict[str, Any]] = []
    by_standard_pairs: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    missing_current: list[str] = []
    missing_past: list[str] = []
    unknown_verdict: list[str] = []

    for cid, past in past_by_id.items():
        cur = current_by_id.get(cid)
        if cur is None:
            missing_current.append(cid)
            continue
        past_v = _normalize(past.get("past_human_verdict"))
        cur_v = _normalize(cur.get("human_verdict"))
        if past_v is None:
            missing_past.append(cid)
            continue
        if cur_v is None:
            unknown_verdict.append(cid)
            continue
        pairs.append((past_v, cur_v))
        std = past.get("standard_id")
        if std:
            by_standard_pairs[std].append((past_v, cur_v))
        if past_v != cur_v:
            disagreements.append(
                {
                    "case_id": cid,
                    "source_file": past.get("source_file"),
                    "moment": past.get("moment"),
                    "standard_id": std,
                    "past_verdict": past_v,
                    "current_verdict": cur_v,
                }
            )

    kappa_summary = cohens_kappa_with_ci(pairs)
    measured_ceiling = kappa_summary["kappa"] if kappa_summary["kappa"] is not None else 0.0
    thresholds = calibrate_thresholds(measured_ceiling)

    # Per-standard κ for the taxonomy-stabilization triage Session 7
    # specifies: "items where past-Robo and current-Robo disagree are
    # logged with reasons; any standards implicated get flagged for
    # refinement-log review."
    per_standard: dict[str, Any] = {}
    for std, std_pairs in sorted(by_standard_pairs.items()):
        per_standard[std] = {
            "n": len(std_pairs),
            "kappa": cohens_kappa(std_pairs),
            "disagreements": sum(1 for a, b in std_pairs if a != b),
        }

    return {
        "schema_version": "1.0.0",
        "quarter": quarter or panel.get("quarter"),
        "generated_at": generated_at,
        "measured_ceiling": measured_ceiling,
        "kappa_summary": kappa_summary,
        "thresholds": thresholds,
        "panel_size": len(past_by_id),
        "responses_received": len(current_by_id),
        "pairs_scored": len(pairs),
        "disagreements": disagreements,
        "per_standard_kappa": per_standard,
        "missing_current": missing_current,
        "missing_past": missing_past,
        "unknown_verdict": unknown_verdict,
        "implicated_standards": sorted(
            {d.get("standard_id") for d in disagreements if d.get("standard_id")}
        ),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def current_quarter(today: _dt.date | None = None) -> str:
    today = today or _dt.date.today()
    q = (today.month - 1) // 3 + 1
    return f"{today.year}-q{q}"


def _utc_now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_corpus_index(corpus_dir: Path) -> dict[str, dict[str, dict[str, Any]]]:
    index: dict[str, dict[str, dict[str, Any]]] = {}
    for case in load_cases(corpus_dir):
        src = case.get("_source_file", "")
        cid = str(case.get("case_id", ""))
        index.setdefault(src, {})[cid] = case
    return index


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _subparsers(p: argparse.ArgumentParser) -> argparse._SubParsersAction:
    return p.add_subparsers(dest="cmd", required=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Quarterly self-drift check.")
    sub = _subparsers(parser)

    # build-panel
    bp = sub.add_parser("build-panel", help="Sample an 80-case stratified panel.")
    bp.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    bp.add_argument("--out", type=Path, default=None)
    bp.add_argument("--quarter", default=None)
    bp.add_argument("--size", type=int, default=DEFAULT_PANEL_SIZE)

    # export-blind
    eb = sub.add_parser("export-blind", help="Emit the blind re-labeling file.")
    eb.add_argument("--panel", type=Path, required=True)
    eb.add_argument("--corpus-dir", type=Path, default=DEFAULT_CORPUS_DIR)
    eb.add_argument("--out", type=Path, required=True)

    # score
    sc = sub.add_parser("score", help="Score responses against a panel.")
    sc.add_argument("--panel", type=Path, required=True)
    sc.add_argument("--responses", type=Path, required=True)
    sc.add_argument("--out", type=Path, default=None)

    args = parser.parse_args(argv)

    if args.cmd == "build-panel":
        if not args.corpus_dir.exists():
            print(
                f"ERROR: corpus {args.corpus_dir} not found. "
                "Drift panels draw from the private industry corpus — "
                "run from a checkout that has it, or pass --corpus-dir.",
                file=sys.stderr,
            )
            return 2
        cases = load_cases(args.corpus_dir)
        selected, stats = build_panel(cases, size=args.size)
        quarter = args.quarter or current_quarter()
        manifest = build_panel_manifest(
            selected, stats,
            quarter=quarter,
            generated_at=_utc_now_iso(),
            corpus_dir=args.corpus_dir,
            size=args.size,
        )
        out = args.out or DEFAULT_PANEL_DIR / f"{quarter}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(
            f"Panel {quarter}: {stats['selected']}/{args.size} cases "
            f"(eligible pool {stats['eligible_pool']})."
        )
        print(f"Moments covered: {', '.join(stats['moments_covered'])}")
        print(f"Wrote {out}")
        return 0

    if args.cmd == "export-blind":
        with open(args.panel) as f:
            panel = json.load(f)
        if not args.corpus_dir.exists():
            print(
                f"ERROR: corpus {args.corpus_dir} not found.",
                file=sys.stderr,
            )
            return 2
        corpus = load_corpus_index(args.corpus_dir)
        blind = build_blind_panel(panel, corpus)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(blind, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(
            f"Blind panel: {len(blind['entries'])} entries "
            f"(missing: {len(blind['missing'])}). Wrote {args.out}"
        )
        return 0

    if args.cmd == "score":
        with open(args.panel) as f:
            panel = json.load(f)
        with open(args.responses) as f:
            responses = json.load(f)
        if isinstance(responses, dict):
            responses = responses.get("entries", [])
        report = compute_drift_report(
            panel, responses,
            quarter=panel.get("quarter"),
            generated_at=_utc_now_iso(),
        )
        out = args.out or DEFAULT_REPORT_DIR / f"{report['quarter']}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
            f.write("\n")
        k = report["kappa_summary"]["kappa"]
        lo = report["kappa_summary"]["ci_low"]
        hi = report["kappa_summary"]["ci_high"]
        if k is not None:
            print(f"Measured ceiling κ = {k:.4f}  (95% CI [{lo:.4f}, {hi:.4f}])")
        else:
            print("Measured ceiling κ = n/a (insufficient data)")
        print(f"Regime: {report['thresholds']['regime']}")
        print(
            f"Autonomous κ threshold = {report['thresholds']['autonomous_kappa']:.4f}  "
            f"Batch κ threshold = {report['thresholds']['batch_approval_kappa']:.4f}"
        )
        if report["disagreements"]:
            print(f"Disagreements: {len(report['disagreements'])}")
            print(f"Implicated standards: {', '.join(report['implicated_standards'])}")
        print(f"Wrote {out}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
