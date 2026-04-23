# Quarterly self-drift check

Human-eval build plan Session 7. Measures Cohen's κ between past-Robo
verdicts and a fresh blind re-labeling pass on the same cases, quarterly.
The resulting **measured ceiling** is the single most important number
in the graduation ladder — Session 10's thresholds are expressed as
ratios against it, so the ladder auto-recalibrates each quarter.

## Why quarterly

Graduation thresholds depend on the measured ceiling. An annual
cadence means up to 364 days of threshold drift between measurements.
Quarterly keeps recalibration tight without imposing unsustainable
review burden.

The annual full-corpus audit (Session 36) still runs alongside this —
it answers a different question ("has the taxonomy overfit to the
year's labeled data?") on a larger sample.

## The cadence (one cycle per quarter)

```
1.  build-panel      Sample 80 stratified cases from the eligible pool.
                     Writes evals/drift/panels/<yyyy-qq>.json.

2.  export-blind     Strip past verdicts + rationale so re-labeling
                     is unbiased. Writes a file suitable for any
                     review surface (Session 8's queue UI will
                     consume this directly).

3.  re-label         Robo re-labels blind. Output must have the
                     shape {entries: [{case_id, human_verdict,
                     human_confidence}, ...]}.

4.  score            Compute κ + 95% CI + per-standard disagreement
                     + threshold regime. Writes
                     evals/drift/reports/<yyyy-qq>.json.

5.  Session 10       Graduation metrics read the latest report and
                     recalibrate thresholds via the ratio formula
                     (autonomous = 0.94 × ceiling, batch = 0.83 ×
                     ceiling). Until Session 10 lands, this step is
                     documented but not wired.
```

## Commands

```sh
# Build this quarter's panel from the private corpus.
python3 tools/drift_check.py build-panel

# Export the blind re-labeling file for Robo.
python3 tools/drift_check.py export-blind \
    --panel evals/drift/panels/2026-q2.json \
    --out   /tmp/drift-blind.json

# After re-labeling, score the responses.
python3 tools/drift_check.py score \
    --panel     evals/drift/panels/2026-q2.json \
    --responses evals/drift/responses/2026-q2.json \
    --out       evals/drift/reports/2026-q2.json
```

## Stratification

80 cases sampled across `(moment, content_type)` buckets via
largest-remainder allocation over the eligible pool. Eligibility is
identical to Session 5's held-out filter:

- `human_confidence == "high"`
- `review_status in {approved, revised}`

Stratification is **deterministic** — same eligible pool + same size →
same panel. Growth is stable: adding cases doesn't churn an existing
panel (cases are sorted within each bucket by `(source_file, case_id)`).

If a bucket's proportional quota exceeds its available cases, the
shortfall redistributes via a residual fill pass in deterministic
order. The tool records which moments were skipped (i.e., had zero
eligible cases) so the regime classification can account for coverage
gaps when threshold recalibration runs.

## Coverage gaps (as of 2026-04-23)

The current eligible pool has **zero** cases for:

- `destructive_action`
- `confirmation`
- `empty_state`
- `interruption`

Drift measurement for those moments is impossible until annotation
lands. The panel's `stats.skipped_moments` records the gap; the report
carries it forward. When those moments gain cases, the next
`build-panel` run picks them up automatically.

## Regime classification

Session 10's graduation ladder branches on the measured-ceiling regime
(plan spec):

| Measured ceiling | Regime | Consequence |
|---|---|---|
| ≥ 0.90 | `target_met` | Thresholds at calibrated defaults. Ship normally. |
| 0.85 – 0.90 | `maturing` | Thresholds fall proportionally; trigger a taxonomy stabilization review of any standards where self-drift disagreements clustered before autonomous graduations resume. |
| 0.80 – 0.85 | `graduation_frozen` | No new autonomous graduations. Invest in the refinement log until ceiling recovers. |
| < 0.80 | `degraded` | Existing autonomous standards re-reviewed in next cycle. |

`classify_regime()` in `tools/drift_check.py` is the single source of
truth for these boundaries. Session 10's graduation metrics consumes
`thresholds.regime` from the report.

## Threshold ratios (plan-spec constants)

| Threshold | Ratio | Value at 0.90 target |
|---|---|---|
| Autonomous κ | `0.94 × ceiling` | 0.85 |
| Batch-approval κ | `0.83 × ceiling` | 0.75 |

These are constants in `AUTONOMOUS_RATIO` / `BATCH_APPROVAL_RATIO`.
Never hand-override them to accelerate graduation — the plan's standing
note makes that explicit.

## Blind re-labeling contract

The blind panel file intentionally omits:

- `past_human_verdict`
- `past_human_confidence`
- `human_notes`
- `machine_verdict`
- Any triage commentary

It keeps:

- `case_id`, `source_file` (for reference back)
- `text` (the actual content to re-label)
- `content_type`, `moment`, `standard_id` (the context Robo had the
  first time — stripping these would change the task, not just the
  bias)

This way Robo's re-labeling task matches the original task shape but
without the anchoring effect of seeing the past verdict.

## Schema: panel file

```jsonc
{
  "schema_version": "1.0.0",
  "quarter": "2026-q2",
  "generated_at": "2026-04-23T…Z",
  "corpus_dir": "evals/industry",
  "panel_size_target": 80,
  "stats": {
    "eligible_pool": 363,
    "selected": 80,
    "buckets": {"browsing_discovery|heading": 13, ...},
    "skipped_moments": ["(none)"],
    "moments_covered": ["browsing_discovery", ...]
  },
  "entries": [
    {
      "case_id": "apple-001",
      "source_file": "apple_eval_cases.json",
      "moment": "wayfinding",
      "content_type": "heading",
      "standard_id": "PRF-03",
      "past_human_verdict": "pass",
      "past_human_confidence": "high"
    },
    ...
  ]
}
```

## Schema: responses file

```jsonc
{
  "entries": [
    {"case_id": "apple-001", "human_verdict": "pass", "human_confidence": "high"},
    {"case_id": "apple-002", "human_verdict": "fail", "human_confidence": "medium"},
    ...
  ]
}
```

(A bare list is also accepted: `[{case_id, human_verdict, ...}, ...]`.)

## Schema: report file

```jsonc
{
  "schema_version": "1.0.0",
  "quarter": "2026-q2",
  "generated_at": "2026-04-23T…Z",
  "measured_ceiling": 0.89,
  "kappa_summary": {
    "kappa": 0.89,
    "ci_low": 0.83,
    "ci_high": 0.95,
    "n": 78,
    "observed_agreement": 0.95
  },
  "thresholds": {
    "measured_ceiling": 0.89,
    "regime": "maturing",
    "autonomous_kappa": 0.8366,
    "batch_approval_kappa": 0.7387,
    "autonomous_ratio": 0.94,
    "batch_approval_ratio": 0.83,
    "blocks_new_autonomous": false
  },
  "disagreements": [...],
  "per_standard_kappa": {...},
  "implicated_standards": [...]
}
```

Session 10 reads `thresholds.*` from the latest report and applies
those κ cutoffs to the graduation ladder. `implicated_standards` is
the list Session 9's weekly cadence should triage against the
refinement log.

## Scheduling

No cron yet. Plan-spec is quarterly; today the cadence is manual —
Robo runs the three commands above at the start of each quarter. A
GH Actions cron that opens a "drift panel ready" issue at the
quarter boundary is a good future addition but not blocking.
