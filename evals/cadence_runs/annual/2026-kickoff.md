# Annual taxonomy audit — 2026 (kickoff cycle)

**Reviewer:** Robert (instrumentation kickoff)
**Completed:** 2026-04-24
**Source artifacts:** pending — the first real audit runs once
there's at least one year's worth of stored verdicts to re-label.

This cycle is a placeholder so the orchestration layer from Session 33
surfaces a real "last completed" timestamp. The first true annual
audit replaces this file once:

- `evals/industry/*.json` cases have `evaluated_at` entries older
  than 365 days (guaranteed by 2027-04).
- `tools/annual_audit_sample.py build-panel --size 100 --min-age-days 365`
  produces a valid panel (the eligibility filter needs enough
  `human_confidence == "high"` + `review_status in {approved, revised}`
  cases).

## 1. Instrumentation readiness

- `/dashboard/cadence/annual` renders the empty state when
  `evals/annual_audit/reports/` is empty.
- `cadence_status.py` marks the annual cadence as "eligible"
  pending the first real audit.
- `evals/annual_audit/README.md` documents the full workflow.

## 2. First real cycle will produce

- `evals/annual_audit/panels/2027.json` (100 cases, >365d old)
- `evals/annual_audit/reports/2027.json` + `.md` (scored output)
- A written design-target ceiling recommendation (keep/raise/lower 0.90)
- `evals/cadence_runs/annual/2027.md` (filled template)

## 3. Notes

The quarterly drift check and the annual audit answer different
questions. Don't skip either because the other ran — the quarterly
recalibrates thresholds on recent data; the annual catches
overfitting the quarterly can't.
