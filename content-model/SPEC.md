# ContentRX Content Model — Specification

**Version:** 4.7.0
**Status:** public, versioned
**License:** CC BY 4.0 (see [LICENSE](LICENSE))

The ContentRX content model is a structured account of what good UI
copy looks like, in writing. It has three interlocking pieces:

1. **Moments** — the situation a user is in when copy addresses them
   (13 in the current model).
2. **Content types** — the structural form copy takes (8 in the
   current model).
3. **Standards** — the 47 rules that describe what the copy should do
   in a given (moment, content_type) cell.

A standard fires when a piece of copy violates its rule in a context
where the rule applies. ContentRX's engine runs standards through a
classify → filter → preprocess → scan → validate → merge pipeline,
and emits zero or more violations per evaluation.

This document is the human-readable specification. The machine-
readable form lives in
[`standards_library.json`](standards_library.json) and
[`moments_taxonomy.json`](moments_taxonomy.json). They are the
source of truth the engine consumes; this document explains them.

## 1. Moments

A **moment** is the situational context of a copy block — not its
format. "Error recovery" is a moment; so is "first encounter" and
"destructive action." Two buttons that both say "Delete" can live in
wildly different moments (destructive_action vs. task_execution for
a routine cleanup), and the right content-design call depends on the
moment more than on the format.

The 13 moments in v4.7.0:

| ID | Description |
|---|---|
| `first_encounter` | User meets the product or feature for the first time. |
| `browsing_discovery` | User is exploring, comparing, or browsing without a commitment. |
| `decision_point` | User is choosing between options. |
| `task_execution` | User is mid-action — the focused-work state. |
| `confirmation` | Positive outcome just happened; user is reading the receipt. |
| `celebration` | Non-trivial achievement or milestone. |
| `error_recovery` | Something went wrong; user needs to recover. |
| `destructive_action` | Irreversible action is about to happen. |
| `empty_state` | A surface has nothing to show — yet, or by design. |
| `interruption` | A modal, toast, or permission prompt interrupts flow. |
| `trust_permission` | Asking for data, money, or elevated access. |
| `wayfinding` | Navigation, labels, affordances that orient the user. |
| `compliance_disclosure` | Regulatory notice, consent, or disclosure. |

Each moment has a **weights map** in
[`moments_taxonomy.json`](moments_taxonomy.json) that lists which
standards get emphasized, relaxed, or suppressed when that moment is
active. `destructive_action` emphasizes standards about explicit
naming and irreversibility; `celebration` relaxes terseness
standards that would strip a moment of warmth.

## 2. Content types

Content types are the structural form. They matter because the same
rule applies differently to an 8-word button than to a 400-word help
article. The 8 content types:

| ID | Description |
|---|---|
| `button_cta` | Button labels, calls to action. 1-5 words, action verb. |
| `error_message` | Failure states that say what happened + what to do. |
| `confirmation` | Success messages, completion states. |
| `tooltip_microcopy` | Tooltips, helper text, hints. |
| `ui_label` | Nav items, section headings, tab labels, form labels. |
| `short_ui_copy` | General UI text that isn't a more specific type. |
| `long_form_copy` | Help articles, docs, onboarding flows, FAQs. |
| `heading` | Section headings, page titles, card headings. |

Each standard lists `relevant_content_types` — the subset of types it
fires on. A standard like "Use a specific verb" fires on `button_cta`
but not on `long_form_copy` where verb variety is expected.

## 3. Standards

A **standard** is a single named rule. Every standard has:

- **`id`** — stable identifier (e.g. `CLR-01`, `ACT-03`). Category
  prefix + sequence number. Never renumbered.
- **`rule`** — the prescription, in one or two sentences.
- **`correct`** / **`incorrect`** — example strings illustrating the
  rule.
- **`rule_type`** — `deterministic` (checkable via preprocessor
  regex) or `nuanced` (requires LLM judgment).
- **`checkable_from`** — input needed: `plain_text` (just the copy)
  or `with_context` (also needs surrounding markup or layout).
- **`relevant_content_types`** — array of content type IDs.
- **`content_type_notes`** — per-content-type guidance the LLM reads
  as part of the scan prompt. `_global` notes apply to every type.
- **`version`** — per-standard semantic version. Bumped independently
  of the library version when the rule text, examples, or
  content-type notes change.
- **`version_history`** — append-only log of per-standard changes.
- **`sources`** — external style guides or references that influenced
  the standard (populated on a rolling basis — not every standard
  has sources attribution yet).
- **`influences`** — relation annotations: `aligns_with`,
  `diverges_from`, `synthesizes`. Documents how this standard relates
  to named external standards (e.g. "diverges from Material in
  preferring specific verbs over OK/Cancel"). Populated on a rolling
  basis.

The current library has 47 standards across these categories:

| Prefix | Category | Purpose |
|---|---|---|
| `CLR` | Clarity | Plain language, unambiguous phrasing |
| `PRF` | Precision | Name the specific thing; avoid vague nouns |
| `ACT` | Action | Verb-first, specific, present-tense |
| `TN` | Terminology | Consistent naming, standard industry terms |
| `GRM` | Grammar | Tight prose, no filler |
| `HLP` | Helpfulness | Tell the user what to do next |
| `TRA` | Transparency | Honest statements, named commitments |
| `PRM` | Permission | Informed consent on prompts |
| `CON` | Consistency | Cross-surface parallelism |
| `ACC` | Accessibility | Structural patterns that aid AT users |
| `STR` | Structure | Scannable layout, heading hierarchy |

Specific standard IDs and their current text are in
[`standards_library.json`](standards_library.json). Each is documented
inline with rule, examples, applicability, and version history.

## 4. Pipeline flow

A single evaluation flows through five stages:

1. **Classify** — determine content_type. Optional — caller can
   supply.
2. **Filter** — narrow standards to those applicable for
   (content_type, audience).
3. **Preprocess** — run deterministic checks (regex-based,
   scales with O(standards)).
4. **Scan + validate** (LLM) — two-pass LLM check with a structured
   response shape.
5. **Merge** — apply moment weights, de-dupe, compute the final
   verdict.

The verdict is one of three states:

- **`pass`** — no violations fired above the confidence floor.
- **`violation`** — at least one violation fired with high confidence.
- **`review_recommended`** — violations fired with ambiguity flags,
  OR the pipeline classified the input as out-of-distribution or
  standards-conflicting. Carries a typed `review_reason` subtype.

## 5. Extending the model

Changes to the model follow the **two-source rule**: a new standard,
a new moment, or a rule modification needs evidence from at least two
independent external sources (style guides, OSS repos, production
design systems) before it ships. This keeps the taxonomy from
overfitting to any one design language.

Proposed changes land in
[`taxonomy_refinement_log.md`](../taxonomy_refinement_log.md) (in
the main repo today) as candidates. Robo triages them during the
quarterly cadence review. Approved refinements bump the library
version and the affected standards' per-standard versions with
`version_history` entries explaining what changed and why.

## 6. Versioning

- **Library version** (top-level `version` in `standards_library.json`)
  bumps on any change to the contents.
- **Per-standard version** bumps only when that specific standard's
  rule text, examples, or `content_type_notes` change. A library-
  version bump doesn't automatically bump every standard.
- **Semantic versioning**:
  - `major` — a standard is retired, renamed, or its rule changes
    meaning. Clients should re-read affected rules.
  - `minor` — a new standard ships, examples or content_type_notes
    are added, or metadata like `sources` / `influences` grows.
  - `patch` — typo fixes, formatting-only changes.

## 7. Citing the model

```
ContentRX Content Model, v4.7.0
https://docs.contentrx.io/model
```

See [LICENSE](LICENSE) for attribution requirements under CC BY 4.0.
