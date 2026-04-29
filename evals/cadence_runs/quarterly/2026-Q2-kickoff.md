# Quarterly review — 2026-Q2 (kickoff cycle)

**Reviewer:** Robert (instrumentation kickoff)
**Completed:** 2026-04-24
**Source artifact:** pending — first real drift report lands once
`tools/drift_check.py score` has a panel to score against.

This is the **load-bearing** cadence. The kickoff exists so the
orchestration layer from Session 33 surfaces a real "last completed"
timestamp; the first true quarterly cycle replaces this file once
the drift panel is built.

## 1. Instrumentation readiness

- `/dashboard/cadence/quarterly` renders the empty state cleanly
  when `evals/drift/reports/` is empty.
- `cadence_status.py` marks the quarterly cadence as "eligible"
  until a real drift report lands (or the next cycle run-file is
  committed).
- Checklist matches the one in `evals/cadence_templates/quarterly.md`.

## 2. First real cycle will produce

- `evals/drift/reports/2026-Q3.json` (drift report)
- `evals/cadence_runs/quarterly/2026-Q3.md` (filled template)
- Threshold recalibration in `tools/graduation_metrics.py`
- Refinement-log entries for any standard with self-disagreement

## 3. Notes

Graduation thresholds in Session 10 currently ride on whatever
measured ceiling was last committed. A full quarter without a fresh
drift report will leave thresholds out of date — the overdue signal
in the overview hub exists for exactly this reason.
