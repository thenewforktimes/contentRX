# ADR: Delete eval data extracted from third-party public-facing experiences

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** Robert
**Supersedes:** None
**Cross-links:** ADR 2026-04-25 (private-taxonomy-pivot), ADR 2026-04-28 (customer-not-product), ADR 2026-05-06-sources-page-retired, ADR 2026-05-06-corpus-license-trim, ADR 2026-05-06-source-name-anonymization

## Context

The 2026-05-06 cleanup arc closed the gap between `/ethics` Commitment 4 and the inputs the model leans on:

- PR #377 retired `/sources` and folded the transparency commitment into `/ethics`.
- PR #378 deleted dead-code corpus orphan in `docs-site/lib/`.
- PR #379 trimmed the live reference corpus to commercial-OK licenses.
- PR #380 + companion substrate PR anonymized source attribution to functional descriptors.

The audit during PR #380 surfaced a different category of input that the prior PRs hadn't addressed: **eval data extracted directly from third-party organizations' public-facing product and marketing pages**, distinct from editorial citation of their published style guides.

This is the "took a screenshot of a corner of a marketing page" case. Style-guide attribution under fair-use commentary is one legal posture; using extracted product copy as eval data for a commercial AI tool is a stronger posture question. Robert's call: even where the use plausibly falls under fair use, "it's not worth the heartbreak if they decide it's not fair use." Delete.

## What was found

### Tracked files with full extracted content

Three files in `tools/` carrying ~438 cases scraped from `mailchimp.com` (the marketing/product surface, not the published style guide):

- `tools/mailchimp_curated.json` — 52 curated cases.
- `tools/mailchimp_eval_cases.json` — 52 auto-annotated cases.
- `tools/extracted.json` — 334 raw extracted strings.

All three carried `source_url: https://mailchimp.com` and `source_org: Mailchimp` in their schema, alongside structured representations of UI strings (alt text, button labels, headings) lifted from the live product.

### Tracked manifests recording brand-named eval sourcing

Two manifest files that publicly recorded which third parties supplied eval data, even though the underlying scraped content lived in the gitignored `evals/industry/` directory:

- `evals/held_out/manifest.json` — 100 entries with `case_id` strings naming third-party brands (`"EXTRACT Mailchimp alt_text 0750d31c"`) and `source_file` strings naming brand-specific eval files.
- `evals/drift/panels/2026-q2.json` — 80 entries with the same shape and source distribution.

The manifests didn't carry the scraped strings themselves, but the `case_id` and `source_file` fields publicly named which third parties' UI copy had been extracted into the eval pipeline. That public record was its own exposure.

### Out of scope (different category)

- **OSS allow-list repos** in `external_signal/allow_list.json` (vercel/next.js, supabase/supabase, etc.) carry MIT/Apache licenses with explicit commercial-use grants. Different from fair-use territory; the licenses *expect* attribution and grant the use. Stays.
- **PostHog case-study working files** in `evals/case-studies/posthog/` were extracted from PostHog's MIT-licensed GitHub repo (not from posthog.com). MIT grant; stays. The case-study workflow itself still gates on `maintainer_approval: true` before any narrative graduates to publication.
- **Standards library** (`standards_library.json`, in the gitignored substrate repo) — already anonymized in PR #380 + substrate PR #1.

## Decision

### Delete

- `tools/mailchimp_curated.json`
- `tools/mailchimp_eval_cases.json`
- `tools/extracted.json`
- `evals/held_out/manifest.json`
- `evals/drift/panels/2026-q2.json`

### Keep workflow infrastructure

The tools that read these files (`tools/run_held_out.py`, `tools/select_held_out.py`, `tools/drift_check.py`, `tools/score_held_out_kappa.py`, etc.) stay. They already handle corpus-missing gracefully (the held-out CI workflow exits cleanly with a notice when the corpus tarball secret is unset). Local regeneration with license-compatible cases is the path forward; no committed manifest until that's available.

### Sweep incidental brand mentions

Comments and docstrings in tools/tests that named the deleted sources by category have been anonymized:

- `tools/select_held_out.py`: docstring no longer enumerates specific brand sources missing case_id.
- `tools/audience_retest.py`: docstring no longer names the specific eval study by brand.
- `tests/test_held_out_convention.py`: path-pattern fixture changed from `apple_eval_cases.json` to `sample_eval_cases.json`.
- `evals/review_queue/README.md`: same brand reference removed.
- `evals/drift/README.md` schema example uses `sample-001` / `sample_eval_cases.json` placeholders.

### Update the public accuracy page wording

`src/lib/accuracy-data.ts` carried a static failure-mode description: *"The Session 7 quarterly panel exists (evals/drift/panels) but the blind re-label pass hasn't been scored yet."* That statement is no longer accurate after the panel deletion. Updated to describe local regeneration from license-compatible cases as the path forward.

### Operational consequence

The held-out gate CI workflow currently produces a notice when the corpus is unavailable rather than failing. With the manifest deleted, the workflow will continue to produce notices on PRs touching engine paths until a clean manifest is regenerated locally. That's an acceptable trade — the gate's purpose is to catch engine regressions against a known-good eval set; we'd rather skip than gate against an exfil-by-our-own-record corpus.

## What stays

- The eval-pipeline machinery — reusable once a license-compatible corpus exists.
- The `evals/industry/` gitignored directory — Robert's local working corpus is unaffected by the public-repo cleanup.
- The held-out gate CI workflow + commit-message convention checker — still fire on engine PRs; the convention test is path-pattern-based and still passes.
- The drift-check tool's `build-panel` / `score` subcommands — usable as soon as a license-compatible eligible pool is available.

## What goes

- All five files named above.
- Five incidental brand mentions in tool docstrings, test fixtures, README schema examples.
- Stale "panel exists but unscored" wording on `/accuracy`.

## Considered and rejected

### Anonymize the manifests instead of deleting them

Replace `case_id: "EXTRACT Mailchimp alt_text 0750d31c"` with `case-0001`, replace `source_file: "mailchimp_eval_cases.json"` with `industry-1.json`, etc. Rejected because:

1. The anonymization preserves the operational utility (the gate could still run) but loses the audit trail that made the manifest useful in the first place — a generic `case-0001` doesn't tell anyone what was selected or from where.
2. The underlying eval data the manifest references is still scraped third-party content. Anonymizing the public pointer doesn't change what's at the other end. Robert's call ("not worth the heartbreak") applies to the eval data itself, not just to the manifest's public face.
3. The right rebuild uses license-compatible sources from the ground up; carrying brand-named manifest IDs forward into a clean rebuild would be fragile.

### Keep the manifests, delete just the `tools/mailchimp_*.json` files

Argument: the manifests are metadata only; the scraped content lives elsewhere. Rejected because the manifests are the public-repo record of what was used. Even without the underlying strings present, the per-source case counts are exposure on their own. Robert's framing closes this argument: *"It wouldn't be fair for someone to look back before we had any customers and say because we took a screenshot of a corner of a marketing page that we did something wrong."*

### Defer to post-launch

Argument: the held-out gate is currently active eval infrastructure; deleting it during the pre-launch cleanup window introduces a coverage gap. Rejected because:
- Pre-launch is the cleanest moment for a delete-and-rebuild — there are zero customers to migrate, zero published accuracy claims that depend on this specific eval pool, and the public `/accuracy` page already surfaces pending-measurement honestly.
- The gate's defensive value is real but not load-bearing on any specific number we've published.
- Carrying the exposure forward into the launch window means more time for someone to find it and a higher cost of fixing it later.

## Reversibility

Re-instating committed manifests requires:
1. A license-compatible eligible pool in `evals/industry/` (or another corpus directory). The expected source profile is **synthetic / hand-written cases by Robert**, **MIT/Apache OSS code with explicit commercial-use grants**, or **public-domain government style guides** — not extractions from any organization's public product or marketing surfaces.
2. Running `tools/select_held_out.py` and `tools/drift_check.py build-panel` against the new pool.
3. Committing the regenerated manifests under the held-out-update commit-message convention.
4. No new ADR required if the rebuild stays within the license envelope; the constraint above is already documented here.

If the corpus rebuild needs to draw from any source outside the license envelope (e.g. fair-use editorial commentary on a specific brand's product copy for a published case study), that requires a new ADR superseding this one with explicit per-source legal posture.

## References

- [/ethics Commitment 4](../src/app/(marketing)/ethics/page.tsx) — public-facing claim
- [evals/held_out/README.md](../evals/held_out/README.md) — updated, manifest deletion noted
- [evals/drift/README.md](../evals/drift/README.md) — updated, panel deletion noted
- [src/lib/accuracy-data.ts](../src/lib/accuracy-data.ts) — failure-mode description updated
- [decisions/2026-05-06-sources-page-retired.md](./2026-05-06-sources-page-retired.md) — Commitment 4 origin
- [decisions/2026-05-06-corpus-license-trim.md](./2026-05-06-corpus-license-trim.md) — license filter (prior PR)
- [decisions/2026-05-06-source-name-anonymization.md](./2026-05-06-source-name-anonymization.md) — anonymization (prior PR)
- [decisions/2026-04-28-customer-not-product.md](./2026-04-28-customer-not-product.md) — customer-not-product position
