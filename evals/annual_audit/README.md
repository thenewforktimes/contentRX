# evals/annual_audit

The annual taxonomy-audit cadence (human-eval build plan Session 36).
Operates alongside the quarterly drift check (Session 7), not instead
of it. The two answer different questions:

- **Quarterly drift check** — "Is the graduation threshold correct
  for today?" Runs on an 80-case stratified panel; output drives
  automatic threshold recalibration in `tools/graduation_metrics.py`.
- **Annual audit** — "Has the system overfit to the year's labeled
  data?" Runs on a 100-case panel of cases **>1 year old**; output is
  a written report that informs next year's taxonomy roadmap and
  includes an explicit statement on whether the 0.90 design target
  ceiling remains appropriate.

## Directory layout

```
evals/annual_audit/
├── README.md           — this file
├── _template.md        — report skeleton for reference
├── panels/             — per-year panel manifests (committed)
│   └── <year>.json
├── blind/              — blind re-label surfaces (git-ignored; transient)
├── labels/             — Robo's re-labels (committed; canonical)
│   └── <year>.json
└── reports/            — scored reports (committed)
    ├── <year>.json
    └── <year>.md
```

## Workflow

One cycle per year:

1. **Build the panel.**

   ```bash
   python3 tools/annual_audit_sample.py build-panel \
     --corpus-dir evals/industry \
     --size 100 \
     --min-age-days 365
   ```

   Writes `evals/annual_audit/panels/<year>.json`. The eligibility
   filter inherits from Session 7 (`human_confidence == "high"` and
   `review_status in {approved, revised}`). The age filter is unique
   to the annual audit — only cases with a parseable `evaluated_at`
   / `created_at` older than `--min-age-days` (default 365) are in
   the pool.

2. **Export the blind surface.**

   ```bash
   python3 tools/annual_audit_sample.py export-blind --year <year>
   ```

   Strips past verdicts + rationale so the re-label pass is truly
   blind. Output lands under `evals/annual_audit/blind/`.

3. **Re-label.** Robo re-labels all 100 cases under the current
   taxonomy. Output format: `evals/annual_audit/labels/<year>.json`
   with `{ "labels": { "<case_id>": "pass" | "violation" | "review_recommended" } }`.

4. **Score the report.**

   ```bash
   python3 tools/annual_audit_score.py \
     --panel evals/annual_audit/panels/<year>.json \
     --labels evals/annual_audit/labels/<year>.json
   ```

   Writes `evals/annual_audit/reports/<year>.json` + `.md`. The
   markdown follows `_template.md` structure; the JSON carries the
   same data for downstream consumption (taxonomy dashboards, next
   year's planning docs).

5. **Write the narrative.** The markdown report has a blank "Next
   year's taxonomy roadmap" section. Robo fills it in after reading
   the scored findings and deciding priorities. Commit the edited
   markdown alongside the JSON.

## Invariants

- **Panel size is 100.** Larger than the quarterly 80 by design —
  the annual audit wants enough power to flag per-standard drift
  that the quarterly would miss.
- **Age floor is 365 days.** Shortening the floor collapses the
  audit into the quarterly check; extending it starves the sample.
  Change only with a refinement-log entry.
- **Every annual report names a ceiling recommendation.** The
  success criterion in the plan is explicit: κ measured this year
  vs the 0.90 design target; if the CI doesn't cover 0.90, the
  report recommends lowering the target for graduation purposes.
- **No composite "accuracy score."** Same discipline as `/accuracy`:
  measured κ, CI, design target, all stated separately.
