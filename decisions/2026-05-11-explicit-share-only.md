# ADR: Explicit-share calibration. Flag-for-Review is the only path.

**Date:** 2026-05-11
**Status:** Proposed
**Owner:** Robert
**Amends:** [2026-04-28 Customer-not-product](2026-04-28-customer-not-product.md), specifically the "Team-plan custom-example contribution toggle is the only path" framing in that ADR's Decision §3 and on `/ethics` Commitment 3.

## Context

A 2026-05-11 audit on the `/about` and `/ethics` pages surfaced a contradiction between what the public-facing copy claimed and what the actual code did, both of which had drifted from the original product intent.

The original product model, as Robert described it from the start:

> ContentRX never sees a single string for calibration unless someone shares that string with us. Full stop. They have to explicitly give us content on every single string. ContentRX can use the strings that someone explicitly opts in to share so we can improve the outcomes of future suggestions. That's the honest and simple path.

What had been built instead:

1. **Two paths** to the calibration corpus, not one:
   - `team_custom_examples.contributeUpstream` — a Team-plan-only opt-in toggle on each custom-example row
   - `violation_overrides.contribute_upstream` — a per-override "share with calibration" boolean attached to flag dismissals
2. **Tier-gating**: calibration contribution required Team plan, narrowing the universal-consent model to a paid feature.
3. **Pairwise preferences** (`/api/preferences/session`) — a separate calibration mechanism using customer choices between candidate rewrites. Independent of any "Flag for review" share.
4. **Schema-level "anonymized signal" feedback** — even without explicit string-level consent, anonymized override metadata (counts, standard IDs, moments) flowed into the calibration log.

Public-facing copy (`/ethics` Commitment 3) compressed all of this into "the Team-plan custom-example contribution toggle is the only path," which was wrong twice over: it invented Team-plan gating that shouldn't exist, and it claimed a single path while the code had multiple.

## Decision

### One share path. Two CTAs. One consent record per string.

The only way a customer string ever enters ContentRX's calibration corpus is through the **Flag for Review** flow:

1. Every finding card surfaces a `Flag for Review` CTA.
2. Clicking it opens a modal that names the consent. Plain language to the effect of "You are sharing this string with ContentRX. We can use it to make the model better."
3. The customer confirms in the modal.
4. Only on confirmation does the plaintext string land in `shared_strings` (or whatever the table ends up named) along with a per-row consent record.

**Two CTAs** before any string is captured: the in-card Flag-for-Review button and the modal's affirmative confirm. Plus the act of submitting the string for review in the first place.

### Universal, not tier-gated

Flag for Review is available to every paying customer, on every paid surface where findings render. No Team-plan gating. No per-tier feature differentiation on the share path.

(Free-tier handling is open. Most likely Free customers retain access to Flag for Review since it is the consent path the rest of the privacy contract assumes.)

### One consent ledger per string

The schema records, per shared string:

- `user_id` (the customer who consented)
- `text` (PII-screened plaintext, populated only on consent)
- `text_hash` (sha256, recorded regardless)
- `consent_at` (timestamp)
- `consent_version` (which iteration of the modal language they agreed to)
- `source_surface` (Dashboard, MCP, LSP, CLI, GitHub Action, Figma plugin)
- Other context (moment, content_type) needed for downstream calibration

Every shared string maps to exactly one consent event. No bulk opt-ins. No account-wide toggles. No "we already have your consent for this category" inferences.

### Email-based revocation, no in-app un-share at v1

If a customer wants a previously shared string deleted, they email `privacy@contentrx.io`. Lookup is by `user_id` + identifying detail (rough timestamp, surface, etc.). Deletion is operator-side at v1.

A future ADR can add an in-app "withdraw consent" flow when product priorities allow; it is not required for the v1 explicit-share contract.

### What gets cut

Three things in the current codebase are inconsistent with this model and get removed:

1. **`team_custom_examples` table.** Cut entirely. The Team-plan-only contribution toggle was the load-bearing mistake. The dashboard's "examples" surface goes away with it.
2. **`violation_overrides.contribute_upstream` field** (and any related `text` / `exportedAt` / `addressed_corpus` plumbing). Overrides remain a private-to-the-customer record of their own dismissals; they no longer feed calibration. Override-driven calibration has to come back through Flag for Review explicitly.
3. **Pairwise preferences (`/api/preferences/session` and the `preference_pair` source enum).** Cut entirely. Pairwise was the second backdoor — too many gotchas for any v1 implementation. If pairwise calibration is valuable later, it requires a new ADR explicitly describing how consent works on pairs (which side counted as "shared," whether the unselected option is also retained, etc.).

### What gets surfaced

The `/dashboard` already has a home for shared strings. That surface becomes the public window into "what has ContentRX seen of mine." It must:

- Show every string the customer has flagged for review
- Show the consent text version they agreed to
- Show timestamps and source surfaces
- Be bulletproof: no off-list strings ever appear here, no aggregate stats that could leak content, no admin-tier echoes that surface the plaintext to anyone but the customer themselves

The dashboard's job is to make the explicit-share model legible. If a customer can't see what they shared, the consent contract is hollow.

## Consequences

### What this changes

- **`/ethics` Commitment 3** — rewrite to describe the single-path model. Drop "Team-plan custom-example contribution toggle is the only path." Replace with "ContentRX uses customer strings only when the customer explicitly shares them via Flag for Review."
- **`/about` Calibration section** — same. Drop "Your strings stay out of training pipelines" framing (which technically allowed an "anonymized signal" carve-out). Replace with the explicit-share narrative.
- **`/privacy`** — the data-handling section needs to match. Audit and align.
- **Schema migration** — drop the cut tables/fields. Add the new `shared_strings` table (or similar). PII-screen at write time, same as the existing `/api/check` path.
- **Dashboard UI** — the "shared strings" surface gets the bulletproof treatment.
- **Finding card UI** — every finding gets the `Flag for Review` CTA and the consent modal.
- **API routes** — `/api/check` response shape may need a `flag_for_review_url` or equivalent so non-dashboard surfaces (CLI, MCP, LSP, etc.) can route their users to the consent flow.

### What this does not change

- The `/api/check` request/response contract for evaluation itself. ContentRX still sees the customer's string at request time, evaluates, returns a verdict, and discards the plaintext. That's the existing privacy contract. Flag for Review is a separate, explicit, post-hoc act.
- The PII-screen on every public route. That stays — it's the regex pre-screen that refuses obvious credentials and PII before the engine sees them.
- The customer-not-product position established in the prior ADR. Strengthens it; doesn't replace it.
- The /accuracy and /calibration measurement surfaces. Calibration math runs on the corpus that explicit-share builds; it doesn't change how kappa is computed or published.

### Migration

The migration is non-trivial because the schema changes are touching customer-facing tables. Existing rows in `team_custom_examples` need to either:

- Get auto-migrated to the new `shared_strings` table if they have valid `contributeUpstream = true` consent (and a recoverable `text` plaintext), or
- Get pseudonymized/dropped if consent isn't recoverable.

Existing `violation_overrides.contribute_upstream = true` rows need similar handling — most likely just dropping the contribution-side fields since the override row itself remains valid as a private user record.

Pre-pilot: ContentRX has zero paying customers as of 2026-05-11. Migration risk is correspondingly low. The schema change can be a clean cutover with no compatibility shim.

### Voice for the public-facing rewrite

ContentRX framing (no "I"). Short declarative. No em dashes, no semicolons, no colons. Per the docs/copy-vocabulary.md voice rules.

The `/ethics` Commitment 3 rewrite needs to be legally rigorous AND match the engineering layer. Both at once. The honest model is also the simple one: Flag for Review → modal → consent → corpus.

## Alternatives considered

- **Status quo (Team-plan toggle as the path).** Rejected. Tier-gating consent is brittle and makes the privacy contract a paid feature, which contradicts the customer-not-product position.
- **Anonymized-signal-by-default.** The current schema's `violation_overrides.contribute_upstream = false` flow technically retains anonymized metadata that feeds calibration. Rejected as the public-facing model. Even hash-only metadata creates a "we used your data implicitly" surface a careful customer would object to. The simpler honest model wins.
- **Pairwise preferences as a parallel consent path.** Rejected. Robert's call: too many pitfalls, too many edge cases. The product can ship without it.
- **In-app un-share button at v1.** Deferred. Email revocation is sufficient for v1; in-app revocation is a follow-up that doesn't gate the launch.

## Open items for the implementation session

- Sequence: copy-first or code-first? Copy-first is faster but creates a window where the page describes a future state. Code-first is more rigorous but takes longer.
- The dashboard "shared strings" surface — does it already exist and just need wiring, or is it a new build?
- Free-tier handling for Flag for Review — same flow, or restricted (and if restricted, why)?
- The legal language in the modal — Robert is going through legal review; the language should be drafted with that in mind (consent, withdrawal-by-email, retention, what "use to make the model better" means in plain terms).

This ADR captures the model. The next session implements it.
