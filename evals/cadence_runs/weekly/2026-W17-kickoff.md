# Weekly review — 2026-W17 (kickoff cycle)

**Reviewer:** Robert (instrumentation kickoff)
**Completed:** 2026-04-24
**Target window:** 2026-04-20 to 2026-04-24

## 1. Override stream pass

Source: `/dashboard/cadence` daily view (Session 9) + `/dashboard/overrides`.

The instrumented cadence kicks in once live teams are on the product.
For the kickoff, the cycle is confirming:

- The weekly surface loads without error for a team admin.
- `/dashboard/cadence/overview` lists weekly cadence as "eligible"
  until the first team override timestamp lands.
- The `cadence_status.py` CLI returns the same shape as the web view.

## 2. Contested standards

n/a — no live traffic yet.

## 3. Follow-ups

- [x] Hub page wired up and linkable from daily cadence
- [x] Template lives at `evals/cadence_templates/weekly.md`
- [ ] First real cycle runs when a team hits the queue

## 4. Notes for next week

First real run should treat this file as reference, not a template.
The real template is `evals/cadence_templates/weekly.md`.
