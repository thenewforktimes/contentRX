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
      "pair_id": "mailchimp-clr-01-001",
      "standard_id": "CLR-01",
      "moment": "error_recovery",
      "content_type": "error_message",
      "source_system": "Mailchimp",
      "source_section": "Voice and tone — Error messages",
      "not_this": "An unexpected error occurred.",
      "but_this": "Something went wrong. Try again in a moment.",
      "rationale": "Mailchimp's voice principle: empathetic, actionable.",
      "license": "CC-BY-NC-ND-4.0"
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

## Canonical source systems

Post-2026-05-06 license trim (see ADR
[`decisions/2026-05-06-corpus-license-trim.md`](../../decisions/2026-05-06-corpus-license-trim.md)),
the canonical list contains only sources with commercial-OK licenses
(CC-BY, OGL, CC0). Anything more restrictive (NC, ND,
all-rights-reserved) is out of envelope:

| System | License | Notes |
|---|---|---|
| GOV.UK Style Guide | OGL v3.0 | Plain-language canon |
| 18F Content Guide | CC0-1.0 | Public domain; plain language |
| Google Developer Documentation Style Guide | CC-BY-4.0 | Technical writing |
| Microsoft Writing Style Guide | CC-BY-4.0 | Broad coverage |
| USWDS (US Web Design System) | CC0-1.0 | Federal UI; plain language |
| Material Design | CC-BY-4.0 | Visual + interaction conventions |

Re-adding any source outside this list requires a license check first.
The pre-merge audit on `/ethics` Commitment 4 (No stolen content) is
load-bearing: every pair has an MIT license, a fair-use standing, or
a public-style-guide convention behind it. Anything that doesn't fit
that envelope should not enter the corpus.

## Disagreement map (deleted 2026-05-06)

The original Session 16 plan included a `disagreement_map.json` that
captured cases where canonical design systems gave conflicting
guidance. Every entry's positions came from sources that didn't
survive the 2026-05-06 license trim (Mailchimp NC-ND + Apple HIG /
Atlassian / Shopify Polaris / GitHub Primer all-rights-reserved), so
the file was deleted with the trim. Re-instating a disagreement map
with license-compatible sources is a follow-up — not committed
today.

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
