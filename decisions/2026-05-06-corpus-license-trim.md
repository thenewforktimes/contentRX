# ADR: Reference-corpus license trim

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** Robert
**Supersedes:** None
**Cross-links:** ADR 2026-04-25 (private-taxonomy-pivot), ADR 2026-04-28 (customer-not-product), ADR 2026-05-06-sources-page-retired

## Context

ADR 2026-05-06-sources-page-retired added Commitment 4 ("No stolen content") to `/ethics` with a load-bearing public claim:

> "Every input has an MIT license, a fair-use standing, or a public-style-guide convention behind it."

The pre-merge audit for that ADR ran the claim against `external_signal/allow_list.json` (the GitHub-miner allow-list) and the `"sources"` citations in `standards_library.json`. Both passed after three license-incompatible repos were removed from the allow-list (calcom AGPL, sentry BUSL, mdn/content CC-BY-SA).

A follow-up audit (this ADR) widened the scope to the rest of the reference corpus and surfaced three files that didn't fit the same envelope:

- **`evals/examples_corpus/pairs.json`** — 38 "this, not that" example pairs. Of those, 11 entries from Mailchimp under `CC-BY-NC-ND-4.0` (non-commercial, no-derivatives) and 15 entries from sources marked `all-rights-reserved` (Apple HIG, Atlassian Design System, Shopify Polaris, GitHub Primer, IBM Carbon).

- **`evals/examples_corpus/disagreement_map.json`** — 5 entries documenting cases where canonical design systems give conflicting guidance. Every entry's positions came from a mix of NC-ND + all-rights-reserved sources; no entry had ≥2 positions from sources inside the envelope.

- **`evals/external_source_snippets.json`** — 6 transcribed style-guide snippets used by `tools/check_close_paraphrase.py` to defensively warn when a ContentRX standard's rule text drifts close to a source the standard doesn't cite. Three of the six were from sources outside the envelope (Mailchimp NC-ND, Apple HIG ARR, Shopify Polaris ARR).

A precedent: the dead-code copy at `docs-site/lib/examples_pairs.json` (orphaned by the 2026-04-25 private-taxonomy pivot, which retired the public `/model` page) carried the same license profile and was deleted in PR #378 ahead of this ADR.

The reference-corpus files aren't loaded by the engine at runtime — they're inert reference data — but they sit in the public repo at `thenewforktimes/contentRX`, which means the brand attribution + license-incompatible content is publicly searchable. With the new public claim on `/ethics`, the gap between the claim and the corpus needed to close.

## Decision

### Trim to commercial-OK licenses only

Filter rule, applied consistently across all three reference files:

**Keep** entries from sources with commercial-OK licenses that permit attribution-required reuse:
- MIT, Apache-2.0, BSD-2/3 (none in the existing corpus)
- CC-BY-4.0 (Microsoft Writing Style Guide, Material Design, Google Developer Documentation)
- OGL-3.0 (GOV.UK Style Guide)
- CC0-1.0 (18F Content Guide, USWDS)

**Drop** entries from sources outside that envelope:
- `CC-BY-NC-ND-4.0` (Mailchimp) — non-commercial, no-derivatives
- `all-rights-reserved` (Apple HIG, Atlassian, Shopify Polaris, GitHub Primer, IBM Carbon)

### File-by-file outcomes

- **`pairs.json`**: 38 → 12 entries. Six source systems remain (GOV.UK, 18F, Google Dev Docs, Microsoft, USWDS, Material Design).
- **`disagreement_map.json`**: deleted entirely. Every entry's positions failed the license filter; trimming positions in place would leave each entry with ≤1 position, which defeats the file's purpose ("disagreement" requires ≥2 sources).
- **`external_source_snippets.json`**: 6 → 3 entries. Three sources remain (Material Design, GOV.UK, 18F).

### Anti-regression

`tests/test_examples_corpus.py` gets a new `test_every_pair_has_commercial_ok_license` that fails if any pair re-enters with a license outside the envelope. The canonical-source list in `test_source_system_uses_canonical_name` is restricted to the post-trim set, with a comment pointing future agents at this ADR before re-adding.

The `test_has_at_least_thirty_pairs` minimum drops to `>= 10` because the trim brought the count to 12. The disagreement-map test class is removed entirely; the corresponding code path in `test_examples_corpus.py` no longer exists.

### What stays

- The 12 license-compatible pair entries, with brand attribution intact (CC-BY and OGL licenses **require** attribution; CC0 doesn't require it but consistency keeps the per-entry source field).
- The 3 license-compatible snippet entries.
- The `tools/check_close_paraphrase.py` defensive tool, now reading the trimmed snippet corpus.
- The standards-library `sources` field on individual standards (see "What's not in scope" below).

### What goes

- 26 license-incompatible pair entries.
- All 5 disagreement_map entries (file deleted).
- 3 license-incompatible snippet entries.

## What's not in scope

### Brand-name anonymization on kept entries

The 2026-05-05 essay-anonymization standard ("Everything will be anonymized, forever") locked in `essays/README.md` applies to **editorial critique** of UI copy in essays — calling out specific brands by name when analyzing their work. The reference-corpus context is different: brand attribution exists because the licenses (CC-BY, OGL) require it, and because fair-use editorial citation on a small set of short illustrative quotes is the legal basis for the use.

Anonymizing `source_system` on the kept corpus entries would also require a coordinated change to the `sources` field in `standards_library.json` (the `tools/check_close_paraphrase.py` tool matches on source name; mismatch produces false positives). That's a bigger coordinated audit involving 65 source mentions across the standards library, plus tooling updates, plus a decision on whether to retire the close-paraphrase tool entirely.

That coordinated cleanup is a follow-up. The license trim is the load-bearing fix that brings the corpus into envelope with Commitment 4; the anonymization is polish that can land in its own PR with its own ADR if and when the cascade work is sequenced.

### `standards_library.json` source attributions

The standards library carries 65 `sources` field mentions across the 47 standards, with the same license distribution as the corpus (Mailchimp 25, Microsoft 10, GOV.UK 6, Apple HIG 5, etc.). The library is **private** per ADR 2026-04-25 — never rendered to product users — but the brand mentions still sit in the public repo.

This is the larger half of the same problem. Trimming the corpus closes the gap on the inert reference files; trimming the live taxonomy's source attributions is a substrate-level change that warrants its own audit + ADR. Deferred deliberately to keep this PR focused.

### `tools/check_close_paraphrase.py`

The defensive close-paraphrase tool stays. After the trim, it reads 3 snippets instead of 6. The smaller corpus reduces coverage (fewer rules to check standards against) but doesn't change the tool's correctness. Re-instating coverage with new license-compatible sources is a follow-up.

## Considered and rejected

### Keep brand attribution but rely entirely on fair use

Stop treating CC-BY and OGL as the legal basis; rely solely on fair-use commentary doctrine for all kept entries. Rejected: would mean accepting the same risk profile we just rejected for Mailchimp NC-ND and the all-rights-reserved sources. The CC-BY / OGL / CC0 licenses are explicit grants of commercial use; abandoning them would forfeit the strongest legal basis for the existing use.

### Anonymize all `source_system` fields in this PR

Drop brand attribution everywhere; rely on fair use; replace specific names with category descriptors ("national-government style guide," "tech-platform writing-style guide"). Rejected for this PR because of the cascade through `tools/check_close_paraphrase.py` — the tool matches on source name, and anonymizing the corpus without anonymizing the standards library's `sources` field produces false positives. The coordinated change is bigger scope than the trim. Deferred.

### Delete the entire reference corpus

Remove `pairs.json`, `disagreement_map.json`, `external_source_snippets.json`, and the `tools/check_close_paraphrase.py` tool. Cleanest legal posture: no brand attribution anywhere in the public repo. Rejected: the close-paraphrase tool is real defensive infrastructure (it catches the case where a standard accidentally tracks too close to an external source the standard doesn't cite). Losing it for a posture improvement that the trim already delivers is the wrong trade.

### Keep all entries

Status quo, accept the gap between Commitment 4's claim and the corpus. Rejected: the new public claim is load-bearing; failing the audit makes the page worse than not shipping it.

## Sequencing

1. PR #378 deletes the dead-code orphan (`docs-site/lib/examples_pairs.json` + `examples.ts`).
2. **This PR** trims the live source-of-truth corpus (`pairs.json`, deletes `disagreement_map.json`, trims `external_source_snippets.json`) and updates tests + README.
3. Follow-up: brand-name anonymization on kept corpus + `standards_library.json` `sources` field, with coordinated `tools/check_close_paraphrase.py` updates.

## Reversibility

Re-instating a dropped source requires:
1. Confirm the license is commercial-OK (MIT, Apache-2.0, BSD, CC-BY, OGL, CC0).
2. Add the source to the canonical list in `test_source_system_uses_canonical_name`.
3. Add entries to `pairs.json` (and optionally `disagreement_map.json` if/when re-instated).

Anything outside the commercial-OK envelope requires a new ADR superseding this one, with a corresponding update to `/ethics` Commitment 4 if the underlying claim changes.

## References

- [/ethics Commitment 4](../src/app/(marketing)/ethics/page.tsx) — public-facing claim
- [evals/examples_corpus/pairs.json](../evals/examples_corpus/pairs.json) — trimmed corpus
- [evals/examples_corpus/README.md](../evals/examples_corpus/README.md) — canonical source list (post-trim)
- [evals/external_source_snippets.json](../evals/external_source_snippets.json) — trimmed snippet corpus
- [tools/check_close_paraphrase.py](../tools/check_close_paraphrase.py) — defensive tool that reads the snippet corpus
- [tests/test_examples_corpus.py](../tests/test_examples_corpus.py) — anti-regression
- [decisions/2026-04-25-private-taxonomy-pivot.md](./2026-04-25-private-taxonomy-pivot.md) — public-surface scope
- [decisions/2026-04-28-customer-not-product.md](./2026-04-28-customer-not-product.md) — customer-not-product position
- [decisions/2026-05-06-sources-page-retired.md](./2026-05-06-sources-page-retired.md) — Commitment 4 origin
