# Production override review queue

Human-eval build plan Session 8. Turns a stream of real-user override
events into an ordered queue Robert reviews 50-at-a-time via the
existing Phase 2 CLI (`tools/triage.py`). Target cadence: **50 items
in 60 minutes**.

## Daily-ish workflow

```
1. Dump production overrides
     (DB dump → JSON, or /api/team-analytics/overrides JSON export)

2. Run the audience re-test (optional but recommended at each build)
     python3 tools/audience_retest.py --corpus-dir evals/industry

3. Build the queue
     python3 tools/review_queue.py build \
         --overrides     overrides_2026_w16.json \
         --annotated-cases evals/industry \
         --out           evals/review_queue/queues/2026_w16.json

4. Review the batches
     (surface the queue in the Phase 2 UI — in the interim, hand it
      to `tools/triage.py` with a small adapter to convert the queue
      schema to triage's input shape)

5. Summarize + maybe draft a refinement-log candidate
     python3 tools/batch_summary.py analyze \
         --batch    completed_2026_w16.json
     python3 tools/batch_summary.py draft-refinement \
         --batch    completed_2026_w16.json \
         --log      taxonomy_refinement_log.md
```

## Queue ordering

Outer dimension is **audience**, provisional. Everything else is
phase-dependent.

### Early phase (<500 high-confidence precedent tuples)

Exploration-weighted. Novel `(standard, content_type, verdict)`
combinations land near the top because each labeled case fills a new
cell in the precedent index — high information value when the pool
is sparse.

```
1. Audience (outer — general_audience before product_ui)
2. Novel combinations (sparse precedent-index cells)
3. standards_conflict subtype
4. ensemble_disagreement subtype (Session 13's name for scan/validate
                                   disagreement — active today via
                                   the standards_conflict subtype)
5. standard_pushback aggregates (Session 4)
6. Calibration sample at 5% of queue
```

### Late phase (≥500 tuples)

Exploitation-weighted. Taxonomy bugs (standards_conflict) are the
highest-remaining-value failure mode once the index is populated.

```
1. Audience (outer — same provisional status)
2. standards_conflict subtype
3. ensemble_disagreement subtype
4. Novel combinations (demoted — remaining uncertainty is noise-y)
5. standard_pushback aggregates
6. Calibration sample at 10% of queue (raised to catch miscalibration)
```

The phase switch is **automatic**. `review_queue.py build` counts
high-confidence tuples (`≥3` precedents per plan spec) in the
annotated corpus at build time and picks the order. No manual toggle
required.

The 500-tuple threshold comes from coverage math: 47 standards × ~4
practical content types × 2 verdicts = 376 plausible cells; 500
high-confidence precedents ≈ 1.3× baseline coverage with moment-
specific margin.

## Audience re-test

Audience-first ordering is a hypothesis. An early eval on a small
panel suggested general-audience content concentrates false
positives, but that read was on 12 cases — way too small to commit.
The re-test:

- **Trigger:** 50 annotated general-audience cases.
- **Keep rule:** `P(general | FP) ≥ 40%` → hypothesis holds; keep
  audience-first.
- **Drop rule:** below 40% → drop audience as the outer dimension;
  let subtypes drive batching directly.

`tools/audience_retest.py` computes the decision on demand and emits
either `keep_audience_first` / `drop_audience_first` / `pending` /
`inconclusive`. Wire the output into `review_queue.py build` via
`--no-audience-first` when the decision is `drop_audience_first`.

## Calibration sample

`calibration_pool` is the corpus of **high-confidence** annotated
cases. A random sample of them mixes into each queue:

- Early phase: 5% of queue size
- Late phase: 10% of queue size

The rationale is in the plan: "5% is bounded below by statistical
power (minimum ~200 cases per quarter for 95% CI with 3% margin of
error on a 5% miscalibration rate) and above by opportunity cost." In
late phase, miscalibration becomes the dominant risk, so the
percentage rises.

The sample is seeded (`random.Random(7)`) so re-builds over the same
pool are reproducible.

## Batching mechanics

Batches are **size-3 clusters** matching `tools/triage.py`'s existing
agree/override/skip UI. Batches never cross audience boundaries — when
the outer dimension flips from general to product_ui, the current
batch closes even if it's under-sized. Keeps context coherent.

## Pattern detection + refinement-log drafting

After each batch, `tools/batch_summary.py analyze` counts actions and
looks for:

- **`recurring_standard_override`** — 3+ overrides on the same
  standard inside a single batch. Plan's default trigger: "the 4
  overrides suggest standard 17 may be too strict on error states —
  open refinement-log entry?"

When a pattern fires, `batch_summary.py draft-refinement` appends a
candidate to `taxonomy_refinement_log.md` under `## Open refinements`.
The entry follows the existing format (current category → proposed
change → triggering cases → architectural consequence → date →
verdict: pending). It's marked pending auto-detected — Robert triages
during the weekly cadence and promotes to approved only after the
two-source rule is satisfied.

## Schema: queue output

```jsonc
{
  "schema_version": "1.0.0",
  "phase": "early",
  "audience_first": true,
  "precedent_tuple_count": 317,
  "candidates": 47,
  "batches": [
    {
      "audience": "general",
      "size": 3,
      "entries": [
        {"case_id": "ov-001", "standard_id": "CLR-01", ...},
        ...
      ]
    },
    ...
  ],
  "calibration_sample": [...]
}
```

## Schema: completed batch (reviewer output)

`triage.py` (or any Phase 2 surface) emits per-case records with the
reviewer's action attached:

```jsonc
{
  "entries": [
    {"case_id": "ov-001", "standard_id": "CLR-01",
     "moment": "error_recovery", "action": "override",
     "reviewer_note": "Error says 'authorization parameters' — too technical."},
    {"case_id": "ov-002", "action": "agree"},
    ...
  ]
}
```

`batch_summary.py analyze` consumes this shape.

## Deferred (from the plan spec)

- **Web review-queue surface.** The existing Phase 2 substrate is a
  CLI. Building a web surface is a separate UX pass; not blocking.
- **Direct DB integration for queue building.** Today the builder
  reads a JSON dump of overrides. A future session can add a
  `--from-db` mode that pulls directly from `violation_overrides`.
- **Dashboard cadence UI.** Session 9 territory.
