# Graduation ladder metrics

Human-eval build plan Session 10. Codifies the six criteria that
govern when a standard promotes from `robo_labels` → `batch_approval`
→ `autonomous`. Every criterion is a **hard gate** — AND-ed, not
averaged — so a 0.95 κ with a 60% counterpart pass rate does NOT
graduate.

## The six criteria (all required)

| # | Criterion | Autonomous | Batch-approval |
|---|---|---|---|
| 1 | Sample size (4-week agreements) | ≥ 500 | ≥ 200 |
| 2 | Cohen's κ vs Robert | ≥ 0.94 × ceiling | ≥ 0.83 × ceiling |
| 3 | Raw agreement (McHugh floor) | ≥ 80% | ≥ 70% |
| 4 | MCC (when prevalence < 15%) | ≥ 0.70 | ≥ 0.60 |
| 5 | Production override rate | < 5% | < 10% |
| 6 | Novel-case counterparts | tier + variation + ≥ 80% pass | tier + variation + ≥ 80% pass |

**Sample size modifiers:**
- 100 – 200 agreements → tighten κ threshold by +0.02 (wider SE)
- < 100 agreements → graduation blocked regardless of κ

**Cohen's κ** uses Session 7's measured ceiling. When the ceiling
drifts, thresholds auto-recalibrate. At the 0.90 target:
- Autonomous κ ≥ 0.85
- Batch-approval κ ≥ 0.75

**Stability window: 4 weeks.** Every one of the prior 4 weekly κ
values must meet the threshold — not just the average. A standard
that just crossed doesn't graduate; we wait for stability.

## Counterpart tiers

A "counterpart" is a pass-case in `evals/novel_cases.json` for the
standard — text that's structurally similar to the standard's trigger
but should NOT fire. Counterparts test reasoning vs pattern-matching
(Gardner et al. 2020 contrast sets; McCoy et al. 2019 HANS).

**Minimum count by observed positive-class prevalence:**

| Prevalence | Base minimum | + Structurally complex |
|---|---|---|
| < 15% | 5 | +3 |
| 15 – 40% | 8 | +3 |
| > 40% | 12 | +3 |

Higher-prevalence standards need more counterparts because the model
has more surface-level signal to overfit on.

**Structural variation — at least 2 of 3 axes, within-moment mandatory:**

| Axis | Target share | Tests |
|---|---|---|
| Within-moment, within-content-type | ≥ 60% | Finest-grain discrimination |
| Cross-content-type | ≥ 25% | Generalization across surface |
| Cross-moment | ≥ 15% | Moment-weighting integrity |

**Pass rate: ≥ 80%** on the counterpart suite. Below that, the
shortcut-learning hypothesis can't be ruled out (McHugh floor + HANS
literature).

## Rule-version counterpart credit

When a standard's rule text changes via per-standard versioning
(Session 1), counterpart credit is policy-driven:

| Change kind | Counterpart credit |
|---|---|
| Semantic (rule fires on different conditions) | Full reset |
| Wording-only (rephrase, example update) | Prior counterparts at 50% weight |
| Additive (new exception/carve-out) | Counterparts outside the carve-out at 100%; those inside need re-verification |

Classification is owned by the taxonomy refinement log using the
existing two-source rule.

## MCC supplementation

Cohen's κ has a documented prevalence paradox: under heavily skewed
marginals, κ can collapse despite high observed accuracy (Chicco,
Warrens & Jurman 2021; Delgado & Tibau 2019). For any standard whose
observed positive-class prevalence on the industry corpus is below
15%, the ladder adds MCC as a supplementary gate.

κ remains the default metric. MCC is a supplement, not a replacement.

## Actor-weighted override rate

Production overrides (Session 4) are weighted by `actor_role`:

| Role | Weight | Reasoning |
|---|---|---|
| Designer | 1.5 | Content-design expertise |
| PM | 1.0 | Business-context signal |
| Engineer | 0.75 | Implementation bias |
| Other / unknown | 1.0 | No adjustment |

## Running the metrics

```sh
# Compute readiness across every standard:
python3 tools/graduation_metrics.py compute \
    --reviews     reviews_last_4_weeks.json \
    --overrides   overrides_last_4_weeks.json \
    --industry    evals/industry \
    --novel       evals/novel_cases.json \
    --drift-report evals/drift/reports/2026-q2.json \
    --out         evals/graduation/readiness.json

# Drill into one standard:
python3 tools/graduation_metrics.py explain \
    --readiness   evals/graduation/readiness.json \
    --standard    CLR-01
```

**Inputs:**
- `--reviews` : JSON list of review events (from Session 8's review
  queue completions). Each entry: `{standard_id, machine_verdict,
  human_verdict, timestamp}`.
- `--overrides` : JSON list of production override events. Each:
  `{standard_id, actor_role, timestamp}`.
- `--industry` : directory of annotated industry corpus files (for
  prevalence + primary-axis inference).
- `--novel` : `evals/novel_cases.json` (counterpart cases).
- `--engine-verdicts` : optional `{case_id: verdict}` map for
  counterpart pass-rate computation.
- `--drift-report` : latest `evals/drift/reports/<yyyy-qq>.json`
  from Session 7 — the measured ceiling drives κ thresholds. If
  absent, defaults to the 0.90 target.

**Output:** `evals/graduation/readiness.json` with per-standard
criteria breakdowns + an aggregate `by_level` summary.

## Schema: readiness.json

```jsonc
{
  "schema_version": "1.0.0",
  "generated_at": "2026-04-23T…Z",
  "measured_ceiling": 0.90,
  "autonomous_kappa_threshold": 0.846,
  "batch_approval_kappa_threshold": 0.747,
  "standards_evaluated": 47,
  "by_level": {"robo_labels": 44, "batch_approval": 3, "autonomous": 0},
  "standards": [
    {
      "standard_id": "CLR-01",
      "recommended_level": "robo_labels",
      "measured_ceiling": 0.90,
      "prevalence": 0.23,
      "autonomous":   {"eligible": false, "criteria": {...}},
      "batch_approval": {"eligible": false, "criteria": {...}}
    }
  ]
}
```

Each `criteria` block has sample_size / kappa (with weekly buckets
+ stable-above flag) / raw_agreement / mcc (when needed) / override_rate
/ counterparts — every one with its threshold, current value, and
a pass/fail boolean.

## What lands in the DB

`graduation_status` table (one row per standard):

| Column | Use |
|---|---|
| `standard_id` | unique — the ladder key |
| `level` | `robo_labels` / `batch_approval` / `autonomous` |
| `last_readiness` (jsonb) | Full criteria snapshot from the last `compute` run |
| `last_readiness_at` | Snapshot timestamp |
| `history` (jsonb) | Append-only level-change log |

`src/lib/graduation.ts` exposes `getGraduationStatus`,
`writeReadinessSnapshot`, `recordLevelChange`. Session 11's approval
flow will write to the history via `recordLevelChange`.

## What Session 10 does NOT include

- **The approval UI** — Session 11 wires one-click graduation approval
  on top of these metrics.
- **Automatic demotion** — Session 12 monitors the 2-week override rate
  and auto-demotes standards that breach it.
- **Direct production review-event ingestion** — today the metrics
  tool reads a JSON dump; a later session can add `--from-db`.

## Today's baseline

On the first run (empty reviews, no production overrides), all 43
standards in the industry corpus land at `robo_labels` — no sample,
no κ, no graduation possible. The committed
`evals/graduation/readiness.json` captures that baseline so
downstream sessions have a real input file to develop against.
