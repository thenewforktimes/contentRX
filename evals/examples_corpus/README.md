# Examples corpus

Human-eval build plan Session 16. A distinct artifact holding
"this, not that" copy pairs extracted from the 10+ canonical design
systems, keyed by `(moment, standard_id, source_system)`.

**Not** part of `standards_library.json`, **not** a CI gate, **not**
the training data. It's a reference artifact — a test set as a
byproduct of attribution work — that supports the plan's "guidance
separate from examples" principle.

## Why this matters

Robo's decision: standards carry their prescriptions
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

Per Session 16 plan:

| System | License category | Notes |
|---|---|---|
| Mailchimp Content Style Guide | CC-BY-NC-ND-4.0 | Voice & tone source |
| GOV.UK Style Guide | OGL v3.0 | Plain-language canon |
| 18F Content Guide | CC0-1.0 | Public-domain; plain language |
| Google Developer Documentation Style Guide | CC-BY-4.0 | Technical writing |
| Microsoft Writing Style Guide | CC-BY-4.0 | Broad coverage |
| Atlassian Design System | all-rights-reserved (doc) / code is various | Voice principles |
| Shopify Polaris | all-rights-reserved (doc) | Empty-state + composition |
| IBM Carbon Writing | all-rights-reserved (doc) | Technical audiences |
| Apple Human Interface Guidelines | all-rights-reserved (doc) | Buttons + alerts |
| Salesforce Lightning Writing | all-rights-reserved (doc) | Enterprise UI copy |
| GitHub Primer | MIT (code) / all-rights-reserved (doc) | Accessibility + consistency |
| USWDS (US Web Design System) | CC0-1.0 | Federal UI; plain language |
| Intuit Content Design Principles | all-rights-reserved (doc) | |

When `source_system` is specified, the entry lives under the source's
license. Fair-use short quotations for illustrative comparison are
what power this corpus; pairs never reproduce long passages.

## Disagreement map — `disagreement_map.json`

```jsonc
{
  "entries": [
    {
      "disagreement_id": "destructive-confirm-button-labels",
      "topic": "What label should sit on a destructive-confirmation button?",
      "positions": [
        {
          "source_system": "Apple HIG",
          "position": "Use a specific verb naming what happens (e.g., 'Delete', 'Discard')."
        },
        {
          "source_system": "Material Design",
          "position": "OK / Cancel is acceptable when the question is clear."
        }
      ],
      "contentrx_resolution": "Specific verbs. CLR-01 + ACT-01 both pull toward specificity on destructive moments.",
      "related_standards": ["ACT-01", "CLR-01"]
    }
  ]
}
```

The map documents where canonical systems give conflicting guidance
and where ContentRX's synthesis lands. This feeds Session 35's
`influences` sub-field work on standards.

## Growth rules

- Add entries over time as Robo encounters them in review.
- Prefer pairs that demonstrate a principle **the source itself
  articulates** — cite the section.
- Never fabricate examples or attribute to a system where the
  mapping isn't documented. The ethics / attribution commitment
  (see `/ethics`) applies here.
- When a source system opts out (via the `/ethics` path), delete
  its entries from the corpus.

## What this session seeds

The committed `pairs.json` ships with an initial set to prove the
format works. Not all 47 standards are covered; growth is
intentional. The disagreement map ships with a few entries that
demonstrate the shape. Both grow as the attribution audit
continues.
