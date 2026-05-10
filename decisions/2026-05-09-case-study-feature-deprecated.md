# ADR: Deprecate the case-study feature

**Date:** 2026-05-09
**Status:** Accepted
**Owner:** Robert
**Supersedes (in part):** [2026-05-06-product-extraction-deletion.md](./2026-05-06-product-extraction-deletion.md)
**Cross-links:** ADR 2026-04-25 (private-taxonomy-pivot), ADR 2026-04-28 (customer-not-product)

## Context

The case-study feature was the workflow that picked an OSS target from
`external_signal/allow_list.json` daily, ran ContentRX over its UI
strings via the engine, opened a draft PR with the artifacts, and
gated publication on a "maintainer approval" check. It existed to
seed the named-expert moat: visible runs over real OSS products,
recorded agreements + disagreements between engine and human
judgment, published to the docs site once a maintainer signed off.

Two unrelated facts prompted the deprecation:

1. **The feature was decided not to ship a while ago** — no case
   studies have been published, no maintainers have been contacted at
   scale, and the customer-not-product positioning (ADR 2026-04-28)
   makes a "we ran your product through our tool" outreach posture
   feel off-key. The auto-run kept executing without anyone using its
   output.

2. **Cost investigation 2026-05-09** (full report at
   `_private/cost-investigation-2026-05-09.md`) traced the steady
   drain on the prepaid Anthropic API balance to a small set of
   scheduled jobs. The case-study daily cron (`case_study_daily.yml`)
   was the largest steady contributor — ~25 strings × 3 LLM calls/day
   = ~$15-30/month at Sonnet 4 + Haiku 4.5 prices. Across the 30-day
   console window this aligned with the observed $14.99 spend. The
   bleed was funding a feature nobody was using.

The 2026-05-06 ADR (`product-extraction-deletion.md`) explicitly kept
the case-study workflow infrastructure ("PostHog case-study working
files... MIT grant; stays. The case-study workflow itself still
gates on `maintainer_approval: true` before any narrative graduates
to publication."). This ADR reverses that preservation — not because
the legal posture changed, but because the feature itself is no
longer planned.

## Decision

Delete the case-study feature in full from the product. The legal
analysis in 2026-05-06 still stands for the input materials that
remain (OSS allow-list, MIT-licensed PostHog working files); we're
choosing to delete those alongside the workflow because nothing
downstream consumes them.

### Removed

**Workflows (2):**
- `.github/workflows/case_study_daily.yml` — the daily auto-run cron
- `.github/workflows/case_study_approval.yml` — the registry-approval gate

**Python tools (3):**
- `tools/case_study.py` — the crawl/evaluate/summarize CLI
- `tools/case_study_candidates.py` — candidate-shortlist generator
- `tools/case_study_pick.py` — daily rotation picker

**Admin app surface:**
- `src/app/admin/case-studies/` — `/admin/case-studies` index + `[slug]` detail
- `src/lib/admin-case-studies.server.ts` — server-side helpers
- `src/lib/admin-case-studies-parser.ts` — README parser
- `src/lib/admin-case-studies.test.ts` — vitest suite
- "Case studies" NavLink removed from `src/app/admin/layout.tsx`

**Docs site:**
- `docs-site/app/case-studies/page.tsx` — public case-study index
- `docs-site/lib/case-studies.ts` — `CASE_STUDIES` registry
- `docs-site/content/case-studies/` — README + `_template.mdx`
- "case studies" references in `docs-site/CLAUDE.md`

**Eval artifacts:**
- `evals/case-studies/` — PostHog working files (extracted strings,
  engine results, summary)
- `evals/case_study_candidates.json` — committed candidate shortlist

**Tests + scripts:**
- `tests/test_case_study_approval_script.py`
- `tests/test_case_study_candidates.py`
- `scripts/check_case_study_approval.py` — CI guard for the registry

### Kept

- **`tools/promote_cases.py`** — general-purpose triage→eval-cases
  promotion tool, used by `tools/pipeline_run.py`. Not case-study
  specific.
- **`external_signal/`** — separate "external signal pipeline"
  (Human-eval Session 15), distinct from case studies. Mines
  copy-change pairs from OSS for offline review. Not affected.
- **2026-05-06 ADR** — left in place as a historical record. Its
  legal-posture analysis still applies to any future eval input
  decisions.

## Considered and rejected

### Just disable the cron, leave the rest

Argument: zero-cost mothballing — disable the schedule, leave the
admin UI and tools available for manual use later. Rejected because:

1. The admin nav surfaces a feature that no longer ships, which is
   user-facing dead weight even on a single-user dashboard.
2. The Python tools had branch-condition references to the cron
   (`case_study_pick.py` only existed for the cron's daily rotation),
   which would rot.
3. Future-Robert tripping over the dead UI/tools is a bigger cost
   than the deletion is now. The repo is at zero customers; this is
   the cheapest deletion window we'll ever have.

### Keep the docs-site `/case-studies` page as a "coming soon" placeholder

Rejected because the customer-not-product position (ADR 2026-04-28)
already constrains the docs site's tone — a "case studies coming
soon" page promises something we're not planning to deliver. Better
to have no page than a stale promise.

### Keep `evals/case-studies/posthog/` as a regression-test corpus

Argument: those engine results could serve as a small held-out gate
on PostHog-style copy. Rejected because (a) the `evals/held_out/` and
`evals/drift/` flows already cover this need with license-compatible
sources after the 2026-05-06 cleanup, and (b) keeping a single OSS
product's working files around without a workflow that consumes them
is the same dead-weight argument as the admin UI.

## Operational consequence

- Anthropic API balance drain from this source: **stops immediately**
  on merge. The cron will not run on its next scheduled tick at
  06:00 UTC.
- `/admin/case-studies` returns 404 after deploy.
- `docs-site/app/case-studies/` removed; if the docs-site has
  inbound links from the main app, they 404 (audit done — no
  inbound links present in the main app).
- The `case_study_approval.yml` workflow file is gone; any open PRs
  that triggered it (none currently) will lose that check.

## Reversibility

Reversing this requires:
1. A new ADR superseding this one with the case for re-shipping
   the case-study feature, given the customer-not-product position.
2. Re-creating the deleted files. Git history at the merge of this
   PR's commit can be used as the recovery source.

## References

- 2026-05-06-product-extraction-deletion.md — the preceding ADR that
  preserved the case-study infrastructure.
- 2026-04-28-customer-not-product.md — the position the case-study
  outreach posture would now run against.
- `_private/cost-investigation-2026-05-09.md` — the cost report that
  surfaced the cron as the biggest steady drain on the API balance.
