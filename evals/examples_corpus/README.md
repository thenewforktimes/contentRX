# Examples corpus

Human-eval build plan Session 16. A distinct artifact holding
"this, not that" copy pairs extracted from the 10+ canonical design
systems, keyed by `(moment, standard_id, source_system)`.

**Not** part of `standards_library.json`, **not** a CI gate, **not**
the training data. It's a reference artifact — a test set as a
byproduct of attribution work — that supports the plan's "guidance
separate from examples" principle.

## Why this matters

Robert's decision: standards carry their prescriptions
(`standards_library.json` `rule` + `correct` + `incorrect`);
worked-out examples from external systems live here. Mixing them
would bloat the library and entangle evolution — if the corpus grows
to thousands of pairs, the library's shape would be dominated by
example churn rather than rule revisions.

The clean separation matches the plan's standing note:

> **Guidance separate from examples.** Standards library keeps
> prescriptions in `standards_library.json` content; examples move
> to the separate `evals/examples_corpus/` artifact built in Session
> 16. The examples corpus is the eval test set as byproduct.

## Schema — `pairs.json`

```jsonc
{
  "schema_version": "1.0.0",
  "description": "…",
  "generated_at": "2026-04-23T…Z",
  "pairs": [
    {
      "pair_id": "us-content-clr-01-001",
      "standard_id": "CLR-01",
      "moment": "error_recovery",
      "content_type": "error_message",
      "source_system": "US federal content guide",
      "source_section": "Plain language — error messages",
      "not_this": "An unexpected error occurred.",
      "but_this": "Something went wrong. Try again in a moment.",
      "rationale": "Plain-language canon: empathetic, actionable.",
      "license": "CC0-1.0"
    }
  ]
}
```

Fields:
- **`pair_id`** — stable identifier `<system>-<standard>-<seq>`.
- **`standard_id`** — the ContentRX standard this pair illustrates.
- **`moment`** / **`content_type`** — the usage context.
- **`source_system`** — the design system or style guide (must match
  a system in the canonical list — see below).
- **`source_section`** — the part of the guide this comes from
  (optional but recommended — supports the `/ethics` attribution
  commitment).
- **`not_this`** / **`but_this`** — the paired example strings.
- **`rationale`** — one line; why `but_this` is better per the source.
- **`license`** — short-form license identifier of the source
  material (e.g., `CC-BY-4.0`, `MIT`, `all-rights-reserved` where
  applicable).

## Canonical source descriptors

Per ADRs
[`2026-05-06-corpus-license-trim.md`](../../decisions/2026-05-06-corpus-license-trim.md)
(license filter)
and
[`2026-05-06-source-name-anonymization.md`](../../decisions/2026-05-06-source-name-anonymization.md)
(brand-name removal), the canonical list contains anonymized
functional descriptors of sources with commercial-OK licenses
(CC-BY, OGL, CC0):

| Descriptor | License category | Notes |
|---|---|---|
| UK national-government style guide | OGL v3.0 | Plain-language canon |
| US federal content guide | CC0-1.0 | Public domain; plain language |
| US federal design system | CC0-1.0 | Federal UI; plain language |
| developer documentation style guide | CC-BY-4.0 | Technical writing |
| enterprise platform writing style guide | CC-BY-4.0 | Broad coverage |
| consumer-tech design system | CC-BY-4.0 | Visual + interaction conventions |

The descriptors are stable strings — they're matched verbatim by
`tools/check_close_paraphrase.py` against the `sources` field on
each standard, so consistency between this list, the
`source_system` field in `pairs.json`, the `source` field in
`evals/external_source_snippets.json`, and the `sources` field in
`standards_library.json` is load-bearing.

Re-adding any source outside this list requires:
1. A license check (CC-BY, Apache-2.0, MIT, OGL, CC0).
2. A new descriptor that doesn't name the brand.
3. A new ADR if either constraint is relaxed.

The pre-merge audit on `/ethics` Commitment 4 (Sources I have
rights to use) is load-bearing: every input has an MIT license, a
fair-use standing, or a public-style-guide convention behind it.
Anything that doesn't fit that envelope, or that names a brand
directly, should not enter the corpus.

## Disagreement map (deleted 2026-05-06)

The original Session 16 plan included a `disagreement_map.json` that
captured cases where canonical design systems gave conflicting
guidance. Every entry's positions came from sources that didn't
survive the 2026-05-06 license trim (NC-ND + all-rights-reserved
licenses), so the file was deleted with the trim. Re-instating a
disagreement map with license-compatible sources is a follow-up —
not committed today.

## Growth rules

- Add entries over time as Robert encounters them in review.
- Prefer pairs that demonstrate a principle **the source itself
  articulates** — cite the section.
- Never fabricate examples or attribute to a system where the
  mapping isn't documented. The ethics / attribution commitment
  (see `/ethics`) applies here.
- License check before adding: anything outside the canonical list
  above needs a confirmed commercial-OK license.
- When a source system opts out (via the `/ethics#no-stolen-content`
  path), delete its entries from the corpus.

## What this session seeds

The committed `pairs.json` ships with the post-trim set (12 entries)
covering the standards where commercial-OK sources articulate the
principle. Growth is intentional: standards with no
license-compatible source coverage stay uncovered until one is found.
