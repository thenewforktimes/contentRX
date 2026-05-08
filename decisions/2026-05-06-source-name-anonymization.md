# ADR: Source-name anonymization across corpus + standards library

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** Robert
**Supersedes:** None
**Cross-links:** ADR 2026-04-25 (private-taxonomy-pivot), ADR 2026-04-28 (customer-not-product), ADR 2026-05-06-sources-page-retired, ADR 2026-05-06-corpus-license-trim

## Context

The 2026-05-05 essay editorial standard (locked in `essays/README.md`) said:

> "Everything will be anonymized, forever. There's no reason to invite disaster when you're not doing something that should invite disaster. We don't need to highlight or pick apart content by name. It's about the philosophy and principles, not where it came from."

That standard was applied at the time to one essay draft. The same principle, applied consistently across the codebase, said the rest of the public repo should also stop naming brands when describing where the model's editorial reasoning came from.

The 2026-05-06 audit on the `/sources` retire (PR #377) and the corpus license trim (PR #379) closed the legal-license half of the gap: only commercial-OK licensed inputs (CC-BY, OGL, CC0) remain. This ADR closes the editorial half: brand names removed from the public repo wherever they sit on the influence side of attribution.

The audit found brand names in five places across the codebase:

| File | Surface | Mentions |
|------|---------|----------|
| `src/content_checker/standards/private/standards_library.json` | `sources`, `influences[].source`, `change_note` fields | 65+ |
| `evals/examples_corpus/pairs.json` | `source_system`, `pair_id` prefixes | 12 |
| `evals/external_source_snippets.json` | `source` field | 3 |
| `src/content_checker/moments.py` | docstring listing canonical sources | 12 sources |
| `tools/check_close_paraphrase.py` | docstring | 3 sources |

Brand names also appeared in tests (`test_examples_corpus.py`, `test_check_close_paraphrase.py`) and the corpus README — same anonymization needed there.

## Decision

### Replace brand names with functional descriptors

Substring substitution applied across all string values in the affected JSON files (covers `sources`, `influences[].source`, `change_note`, `note`, `rationale`, and any free-text reference). Mapping:

| Brand | Functional descriptor |
|-------|-----------------------|
| Mailchimp / Mailchimp Content Style Guide | consumer-marketing platform style guide |
| Microsoft Writing Style Guide | enterprise platform writing style guide |
| GOV.UK / GOV.UK Style Guide | UK national-government style guide |
| Apple HIG / Apple Human Interface Guidelines | consumer-OS interface guidelines |
| Material Design | consumer-tech design system |
| USWDS | US federal design system |
| 18F Content Guide | US federal content guide |
| Google Developer Documentation Style Guide | developer documentation style guide |
| Atlassian Design System | productivity platform design system |
| Shopify Polaris | commerce platform design system |
| GitHub Primer | developer platform design system |
| IBM Carbon | enterprise software design system |
| Chicago Manual of Style | classic prose style reference |

### Pair-id prefixes

`pairs.json` `pair_id` prefixes also encoded brand names (`govuk-clr-01-001`, `microsoft-vt-01-001`, etc.). Prefixes anonymized via the same mapping:

- `govuk-*` → `uk-gov-*`
- `18f-*` → `us-content-*`
- `microsoft-*` → `enterprise-write-*`
- `material-*` → `mobile-design-*`
- `google-*` → `dev-docs-*`
- `uswds-*` → `us-design-*`

### Stable strings (load-bearing for tooling)

The descriptors are deliberately stable — `tools/check_close_paraphrase.py` matches them verbatim between the snippets corpus (`evals/external_source_snippets.json`) and each standard's `sources` field in `standards_library.json`. Changing a descriptor in one file requires changing it in the other; the post-trim canonical list is documented in `evals/examples_corpus/README.md` as the single reference.

### Anti-regression

`tests/test_examples_corpus.py` gets two new guards:

- `test_source_system_uses_canonical_descriptor` — restricted allowlist of the six post-trim descriptors. Adding a new descriptor requires updating the allowlist + the canonical-source list in the README + this ADR's table.
- `test_no_brand_names_in_source_field` — explicit denylist of brand-name fragments. A coincidental brand-name substring in a future descriptor (e.g. someone names a source "Mail Chimp Voice Principles") fails this test.

The close-paraphrase test (`test_check_close_paraphrase.py`) still pins fixture behavior, but its source-name fixtures use the anonymized canonical strings or generic placeholders ("source-cat-A").

### Historical migration script removed

`tools/patch_extend_sources.py` was a one-time Session 16 tool that wrote brand-named source attributions into `standards_library.json`. It already ran; the data it wrote has now been anonymized. The script itself still carried the brand-name mapping in source code, which would re-introduce brand names if anyone re-ran it. Deleted to remove that footgun.

## What stays

- **All 65 source attributions on standards.** Editorial citation of the categories the standards draw from is preserved — just by category, not by brand.
- **The close-paraphrase tool.** Defensive infrastructure that warns when a standard's rule text drifts close to an external snippet without attribution. Still works post-anonymization because both sides of the comparison use the same canonical descriptors.
- **The 12 pair entries + 3 snippet entries** from the post-trim corpus.
- **The standards library's structure.** No standards changed; only the source-attribution metadata was anonymized.

## What goes

- Brand-name substrings in 65+ source mentions across the standards library.
- Brand-name substrings in 12 corpus entries (`pairs.json`).
- Brand-name substrings in 3 snippet entries (`external_source_snippets.json`).
- Brand-name list in the `moments.py` docstring.
- Brand-name list in the `check_close_paraphrase.py` docstring.
- Brand-name fixtures in two test files.
- Brand-name canonical-source table in `evals/examples_corpus/README.md`.
- `tools/patch_extend_sources.py` (historical migration tool that would re-introduce brand names if re-run).

## Considered and rejected

### Keep brand names (status quo)

Argument: CC-BY and OGL licenses **require** attribution; removing brand names from the publicly committed corpus is technically a license-attribution failure. Rejected because:

1. The corpus is internal reference data — not what users see at runtime. The license-compliance question is about what the public artifact says, not what the internal repo says. The public artifact is `/ethics` Commitment 4 ("No stolen content"); attribution belongs on that page if anywhere.
2. Fair-use commentary doesn't require attribution by name; functional descriptors preserve the editorial citation while removing the brand-name target.
3. Robert's 2026-05-05 editorial standard explicitly chose this trade.

### Drop the corpus entirely

Argument: zero brand attribution anywhere is the cleanest legal posture. Rejected because the corpus is small (12 + 3 entries post-trim) and the close-paraphrase tool reads it. Losing the tool to gain a posture improvement that the anonymization already delivers is the wrong trade. Considered + rejected at the prior ADR (2026-05-06-corpus-license-trim) for the same reason.

### Use generic numeric IDs (`src1`, `src2`, ...)

Rejected because debuggability matters. When a future agent reads `"sources": ["src7"]` they have to chase the mapping; reading `"sources": ["UK national-government style guide"]` tells them the source category at sight.

### Use category-level merging (collapse Apple HIG + Material Design → "mobile interface guidelines")

Rejected because it loses fidelity. A standard that synthesizes positions across both Apple HIG and Material Design would, post-merge, look like it draws from one source. The descriptors are distinct so the multi-source synthesis stays visible.

## Sequencing

1. PR #377 retired `/sources` and added `/ethics` Commitment 4.
2. PR #378 deleted dead-code corpus orphan in `docs-site/lib/`.
3. PR #379 trimmed live corpus to commercial-OK licenses.
4. **This PR** anonymizes source attribution across corpus + standards library + supporting code.

The four PRs together close the gap between the public claim on `/ethics` and the corpus the model leans on.

## Reversibility

Re-introducing a brand name requires a new ADR superseding this one, with explicit acknowledgement that:
- The 2026-05-05 essay editorial standard would need a corresponding revision.
- The fair-use defense (which this anonymization strengthens by making the use less brand-targeted) would need a different legal basis.

Functional descriptors can grow as new commercial-OK sources enter the corpus; adding one requires:
1. License check (CC-BY, Apache-2.0, MIT, OGL, CC0).
2. New descriptor that doesn't name a brand.
3. Update to `evals/examples_corpus/README.md` canonical table + the test allowlist in `tests/test_examples_corpus.py`.
4. Consistent use of the new descriptor across `pairs.json`, `external_source_snippets.json` (if applicable), and any standard's `sources` field that draws from it.

## What's not in scope

### Mailchimp eval case files

The audit also surfaced `tools/mailchimp_curated.json` (52 cases) and `tools/mailchimp_eval_cases.json` (52 cases) — eval cases extracted from `mailchimp.com` marketing pages. That's a different category from style-guide attribution: it's directly extracted product copy from a third party's website, used as eval data without explicit permission.

Anonymization isn't the right fix for those files because there's no descriptor that makes "string from mailchimp.com homepage" defensible. The right fix is deletion. That's a separate PR with its own ADR.

### `external_signal/allow_list.json` OSS repo names

OSS repos in the allow-list are coordinates (`vercel/next.js`, `supabase/supabase`, etc.) under MIT/Apache licenses with explicit commercial-use grants. Different category from style-guide attribution — the licenses *expect* attribution and grant the use. Not in scope of this anonymization.

## References

- [/ethics Commitment 4](../src/app/(marketing)/ethics/page.tsx) — public-facing claim
- [evals/examples_corpus/pairs.json](../evals/examples_corpus/pairs.json) — anonymized corpus
- [evals/external_source_snippets.json](../evals/external_source_snippets.json) — anonymized snippets
- [evals/examples_corpus/README.md](../evals/examples_corpus/README.md) — canonical descriptor list
- [src/content_checker/standards/private/standards_library.json](../src/content_checker/standards/private/standards_library.json) — anonymized standards
- [src/content_checker/moments.py](../src/content_checker/moments.py) — anonymized engine docstring
- [tools/check_close_paraphrase.py](../tools/check_close_paraphrase.py) — defensive tool, anonymized docstring
- [tests/test_examples_corpus.py](../tests/test_examples_corpus.py) — anti-regression
- [essays/README.md](../essays/README.md) — 2026-05-05 editorial standard
- [decisions/2026-05-06-corpus-license-trim.md](./2026-05-06-corpus-license-trim.md) — license filter (prior PR)
- [decisions/2026-05-06-sources-page-retired.md](./2026-05-06-sources-page-retired.md) — Commitment 4 origin
- [decisions/2026-04-25-private-taxonomy-pivot.md](./2026-04-25-private-taxonomy-pivot.md) — substrate-vs-public boundary
