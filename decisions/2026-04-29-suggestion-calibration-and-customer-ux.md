# 2026-04-29 — Suggestion calibration substrate + customer-facing UX

**Status:** Accepted

**Extends:** [2026-04-25 — private taxonomy pivot](2026-04-25-private-taxonomy-pivot.md), [2026-04-28 — customer not product](2026-04-28-customer-not-product.md)

**Does not supersede:** any prior ADR.

---

## Context

Two product realities collided during the 2026-04-29 testing session:

1. **Suggestion quality is slop on real input.** Robert pasted *"Unable to complete operation. Please contact administrator."* into the dashboard's check panel. The engine returned three findings whose suggestions were 3x longer than the input, hedging filler ("Our support team can help", "for assistance"), em-dashed, and in trained generic-helpful-AI voice ("We've", "Don't worry"). ContentRX's own standards would have flagged the copy ContentRX generated.

2. **The customer dashboard offers no productive path after a check.** A user who sees a finding can't copy the suggestion, push back on the verdict, propose a better rewrite, or write a team rule from the moment of disagreement. The check panel is read-only.

Diagnosis on (1): the scan system prompt has no voice guidance for the `suggestion` field. The LLM defaults to its trained voice. Robert's annotation work — the held-out golden set, the override stream, the preference pairs, the rationale feedback — informs **verdict accuracy** (kappa measurement, standards refinement, moment weight calibration) but **does not feed the runtime LLM's suggestion phrasing**. Even after thousands of annotations, suggestion quality has been unmeasured and unimproved.

Diagnosis on (2): the customer surface stops at "here's what's wrong." The disagreement → override → rule → calibration loop exists in the substrate (the `violation_overrides` table, `team_rules`, `team_custom_examples`, `rationale_feedback`) but no customer-facing affordance reaches it.

PR #252 patches the immediate slop bug by hardcoding voice rules into the scan prompt. That is a **stopgap, not a durable fix.** This ADR defines the durable closure: a substrate path where Robert's annotations directly shape the runtime LLM's suggestion voice, and the customer-facing UX that feeds that path with high-volume signal.

The full scope is large enough that it must ship as a sequence of small PRs. This document captures the load-bearing decisions so that subsequent PRs inherit a single contract instead of re-litigating each decision per PR.

---

## Decision

Build a **suggestion calibration loop** as a first-class substrate-to-runtime path, paired with a **customer-facing dashboard UX** that exposes the four actions (Copy, Adjust, Make a rule, Ship anyway) across every product surface using a calmer language pattern.

The loop has two tiers — customer signal feeds **CANDIDATES**, founder review promotes them to **PRECEDENTS**, and only PRECEDENTS reach the runtime LLM context. The customer UX inherits the smart-filter pattern that makes verdict checks fast: bucketed retrieval, top-N cap, token budget, skip-on-high-confidence.

The customer-facing language pattern resets from the current "Violation"-in-red treatment to a calmer + productive vocabulary that aligns with [docs/copy-vocabulary.md](../docs/copy-vocabulary.md): **Findings**, severity ladder of *Don't ship / Worth adjusting / Quick polish*, color discipline that reserves red for ship-blockers only, and recommendation-first prose.

The whole closure is captured in a sequenced build plan at `_private/SUGGESTION_CALIBRATION_BUILD_PLAN.md` (gitignored — internal only). Public contributors read this ADR for the load-bearing decisions.

---

## Load-bearing decisions

### 1. Two-tier signal architecture: CANDIDATES → PRECEDENTS

Customer signals are noisy. Founder signals are curated. The architecture has to capture both, weigh them differently, and never let noise pollute the runtime LLM context.

```
Customer dashboard actions ──► CANDIDATES (low-trust, high-volume)
                                       │
                                       ▼
                               /admin/queue triage ──► PRECEDENTS (curated)
                                                              │
                                                              ▼
                                                  Runtime LLM prompt injection
```

- **CANDIDATES** = customer copies + customer-proposed rewrites + customer-created team rules. Stored, queryable, surfaced in `/admin/queue`. **Never injected directly into the runtime prompt.**
- **PRECEDENTS** = candidates Robert has reviewed and approved (or that Robert authored from scratch via `/admin`). **Only PRECEDENTS reach the runtime LLM.**

This protects the runtime against noise while still letting customer behavior drive the annotation queue. **No customer can ruin the model's voice — only Robert's curation does.**

### 2. Smart-filter retrieval at request time

Calibration retrieval inherits the verdict pipeline's filter pattern. A 2-word button never sees long-form-copy precedents.

Retrieval rules at request time, in order:

1. **Read what filter already decided.** The pipeline already knows which standards survived the filter. Precedent retrieval ONLY runs for those standards.
2. **Bucket-first lookup.** Get precedents by `(moment, content_type, standard_id)`. With proper indexing, sub-millisecond regardless of corpus size.
3. **Top-N hard cap = 3.** Never inject more than 3 precedents per request. Sorted by relevance score (sample_size + recency).
4. **Skip injection on high-confidence cases.** If the standards alone will give the LLM ≥0.95 confidence (obvious matches), skip precedent injection entirely.
5. **Token budget.** Hard ceiling (500 tokens) for the precedent block. Drop lowest-relevance first if exceeded.
6. **Cache the bucket.** `unstable_cache` keyed on `(moment, content_type, standard_id, precedents_version)`. New approval bumps `precedents_version`; cache invalidates on tag.

Result: a 2-word button check pulls maybe 1 precedent (or zero) and adds <100 tokens to the prompt. A long-form error message check pulls 3 precedents and adds ~300 tokens. **Neither check sees the entire corpus.**

### 3. Customer surface vocabulary: Adjust / Make a rule / Ship anyway / Copy

Each finding card carries up to four actions, each with one verb-shaped label:

| Label | What clicking does | Substrate signal |
|---|---|---|
| **Copy suggestion** | Client-side clipboard copy + lightweight `cx-suggestion-copied` event | Positive signal to `suggestion_candidates` (low weight) |
| **Adjust** | Opens inline modal with two checkable dimensions: verdict and/or suggestion | Up to two signals: `violation_overrides` row (verdict-disagreement) + `suggestion_candidates` row (rewrite proposal) |
| **Make a rule** | Modal pre-filled with finding context (Team plan); upsell on Free/Pro | `team_rules` row (Team plan); upsell-clicked metric (others) |
| **Ship anyway** | Surface-dependent affordance to override the gate | `violation_overrides` row with `accepted` reason |

**"Disagree" was rejected.** Stance not action; adversarial framing breaks the colleague positioning.

### 4. The Adjust modal handles two dimensions in one save

```
What needs adjusting?

[ ] The verdict (this isn't a violation)
    Reason: [picker — 3 codes from override-reasons.ts:
             not_applicable_here, standard_too_strict,
             confusing_need_more_context]
    Notes: [optional]

[ ] The suggestion (better rewrite below)
    [textarea, pre-filled with current suggestion]

[ ] Share with the ContentRX model    (default OFF, per ADR 2026-04-28)

                              [Cancel]    [Save adjustment]
```

The user checks whichever dimension(s) apply. Clean separation of substrate signals: verdict-disagreement → `violation_overrides`, suggestion-rewrite → `suggestion_candidates`. Both can fire from one save click.

After save, the card collapses with the user's rewrite (if any) shown inline labeled "Your version." If the user disagreed with the verdict, an escalation offer follows: *"Want to write a rule so ContentRX doesn't flag this for your team?"* → opens the **Make a rule** modal pre-filled.

### 5. Cross-surface uniformity: one vocabulary, surface-native affordances

Same words on every surface. Same substrate signal contract. Only the affordance changes per surface.

| Action | Web dashboard | MCP | CLI | GitHub Action | LSP | Figma plugin |
|---|---|---|---|---|---|---|
| Copy suggestion | Button | Tool result text | stdout | (in PR comment) | Default code action | Button |
| Adjust | Inline modal | `adjust_finding` tool | `--adjust` opens editor | PR comment `/contentrx adjust` | Code action | Per-finding panel |
| Make a rule | Modal (Team plan) | `create_team_rule` tool | `contentrx rule create` | PR comment `/contentrx rule` | Code action | "Save as rule" button |
| Ship anyway | (not present — no gate) | Tool param `accept: true` | `--ship-anyway` flag | PR comment `/contentrx ship-anyway` | Code action | Per-finding affordance |

**The substrate doesn't care which surface emitted the signal** — only the `(moment, content_type, standard_id, signal_type, payload)` shape. `/admin/queue` treats them all identically.

### 6. Ship anyway gated by surface gate

The Ship anyway affordance exists where a gate exists.

| Surface | Has gate? | Ship anyway shown |
|---|---|---|
| Web dashboard | No (the panel tests copy; nothing to ship) | **Not shown** |
| MCP | Yes (LLM clients pause on review_recommended) | Yes |
| CLI | Yes (exit code 1 on violation) | Yes |
| GitHub Action | Yes (`fail-on: review` blocks merge) | Yes |
| LSP | Yes (diagnostics block save actions / fail CI) | Yes |
| Figma plugin | Yes (per-string banner) | Yes |

Adding Ship anyway to surfaces without gates is vestigial UI. Remove rather than carry it.

### 7. Privacy default OFF on upstream contribution

Every customer-emitted signal that could reach the upstream model carries a default-OFF opt-in checkbox: *"Share with the ContentRX model."*

Policy alignment with [ADR 2026-04-28](2026-04-28-customer-not-product.md):

- **OFF (default):** the signal is private to the customer's account/team. Adjustments still record to `violation_overrides` for the team's own pattern memory; rewrites still write to `suggestion_candidates` scoped to the team's `team_owner_user_id`. Nothing crosses the team boundary.
- **ON (explicit opt-in per save):** the signal becomes eligible for `/admin` triage. Robert can review it and promote to PRECEDENT.

The PII pre-screen (`src/lib/pii-screen.ts`) runs on every text field a customer submits — rewrite, notes, rule descriptions — regardless of opt-in state. Defense-in-depth: even an opted-in rewrite gets PII-scrubbed before persistence.

### 8. /admin clustering by `(moment, content_type, standard_id)`

47 teams will disagree with the same standard on similar inputs. The `/admin` triage view cannot ask Robert to triage 47 individual rows — that destroys the daily review rhythm.

Triage view groups candidates by:

1. **`(moment, content_type, standard_id)` bucket** (the load-bearing axis)
2. **Within bucket, by input similarity** — Jaccard token similarity over hashed inputs
3. **Within cluster, candidate rewrites** sorted by frequency (most-frequent first)

Robert sees clusters, not rows. *"47 teams disagreed with `standard_too_strict` on CLR-01 × error_recovery, here are the 5 distinct rewrites they proposed."* One triage decision moves dozens of candidates.

### 9. Customer-facing language pattern

The current dashboard renders the badge **"Violation"** in red. This violates `docs/copy-vocabulary.md` ("Violations stays in API + DB. Findings is what customers see.") and reads as accusatory.

Reset, in three pieces:

#### 9a. Verdict-level wording

| Substrate state | Customer label | Tone |
|---|---|---|
| `verdict: pass` | **All clear** (or **Ships clean**) | emerald |
| `verdict: review_recommended` | **Worth a look** | amber |
| `verdict: violation` (default) | **N findings to adjust** | amber |
| `verdict: violation` with hard-rule finding | **Adjust before shipping** | red, used sparingly |

#### 9b. Severity ladder

Three tiers, language scaled by stakes, color reserved by stakes:

| Substrate | Customer label | Tone | Trigger |
|---|---|---|---|
| `severity: high` + hard rule (profanity, trademark, security) | **Don't ship** | red | Rare. Earned. |
| `severity: high` (everything else) | **Worth adjusting** | amber | The bulk |
| `severity: medium` | **Worth adjusting** | amber | Collapses with high — most users don't need to distinguish |
| `severity: low` | **Quick polish** | stone | Easy wins, quiet color |

The 3 → 2 visible tiers collapse is intentional. "Worth adjusting" covers anything where a thoughtful designer would change the copy. "Don't ship" is reserved for genuine ship-blockers.

#### 9c. Sentence-level pattern

Lead with the recommendation, not the diagnosis. **Pattern A** is the default:

> *Error messages land warmer when they own the failure and point somewhere. Try acknowledging what happened and naming a next step.*

Verb choices, repo-wide:

| Avoid | Prefer |
|---|---|
| violates | doesn't yet meet |
| blames | reads as blaming |
| fails to | could (do X) |
| missing | benefits from |
| should | lands better when |
| wrong | worth adjusting |

#### 9d. Color rule, locked

| Color | Reserved for |
|---|---|
| **Red** | Hard ship-blockers only (`Don't ship` tier). Rare. |
| **Amber** | The bulk: `Worth a look` verdict + `Worth adjusting` findings |
| **Stone** | `Quick polish` findings |
| **Emerald** | `Ships clean` verdict |

#### 9e. Where this lands in code

The substrate `verdict` / `severity` enums stay unchanged. The customer rendering goes through `src/lib/humanize.ts` per the existing rule in `docs/copy-vocabulary.md` ("Engine snake_case enums are humanized at the rendering boundary").

Add:

```ts
humanizeVerdict(v: Verdict, findings: Finding[]): { label: string; tone: "emerald" | "amber" | "red" }
humanizeSeverity(s: Severity, kind: StandardKind): { label: string; tone: "amber" | "red" | "stone" }
```

The web dashboard, MCP response, CLI output, GitHub Action comment, LSP diagnostic, and Figma plugin all call through these. The cross-surface uniformity rule (decision 5) means the same labels everywhere.

---

## Alternatives rejected

### A. "Just patch the prompt forever"

Approach: add voice guidance to the scan prompt (PR #252), call it done.

Why rejected: PR #252 is a stopgap. The prompt is hardcoded by Claude (the AI), not learned from Robert's annotations. Every voice tweak becomes a code change Robert has to ask for. The substrate-to-runtime gap remains: Robert's annotation work still doesn't feed the LLM's suggestion phrasing dynamically. The calibration loop is the durable closure.

PR #252 ships as the stopgap and is acknowledged as such in its commit history. The build plan retires the hardcoded prompt rules once the calibration loop is live.

### B. Single "Disagree" button with sub-picker

Approach: one button labeled "Disagree" → modal with three sub-intents (Wrong call, Wrong fix, Ship anyway).

Why rejected:
- "Disagree" is a stance, not an action. Buttons should describe what HAPPENS when clicked.
- "Disagree" is adversarial framing. ContentRX's positioning is "the staff content designer in the room with you" — a colleague's verdict isn't disagreed with, it's adjusted.
- The umbrella verb hides the user's actual intent and forces an extra click.

Adopted: **Adjust** as the umbrella verb (covers verdict and suggestion in one modal); **Make a rule** as the durable-team-change verb; **Ship anyway** as the override-the-gate verb. The Adjust modal exposes the two dimensions inline so the user picks both at once when they apply.

### C. Three separate intent buttons (Push back / Rewrite / Ship anyway)

Approach: skip the umbrella, surface three intent-specific buttons.

Why rejected:
- Visual density. With Copy + Make a rule, that's five buttons per finding card.
- Ship anyway has no payoff on the web dashboard (no gate to bypass), creating one vestigial button.
- The verdict-disagreement and suggestion-disagreement signals are usually correlated. Forcing the user to pick one at a time loses the connection.

Adopted: **Adjust** (one button) opens a modal with verdict + suggestion checkboxes. Two signals captured in one save. **Ship anyway** moves to gated surfaces only.

### D. Ship anyway always-on

Approach: surface Ship anyway on every surface for consistency.

Why rejected: on the web dashboard, the check panel tests copy — nothing to ship. Ship anyway has no effect there. Surfacing it anyway is dishonest UI.

Adopted: Ship anyway exists where a gate exists. Cross-surface consistency is preserved at the **vocabulary + signal contract** level (decision 5), not the affordance level.

### E. Skip the language pattern reset

Approach: ship the calibration loop and the customer UX with the existing "Violation"-in-red treatment.

Why rejected: the dashboard violates `docs/copy-vocabulary.md` today. Adding more surfaces under the existing pattern compounds the inconsistency. A vocabulary reset is cheap and the right time is now, before the surface count grows.

Adopted: humanize.ts mappings + color rule lock + recommendation-first prose pattern, applied across all customer surfaces in the same wave.

### F. Customer rewrites become precedents directly

Approach: when a Team-plan customer rewrites a suggestion via Adjust + opt-in upstream, the rewrite becomes a PRECEDENT immediately (no Robert review).

Why rejected: protecting the model's voice is the named-expert positioning. If anyone can shape the model, the moat decays. Robert's curation is the load-bearing constraint.

Adopted: customer rewrites → CANDIDATES; Robert review → PRECEDENTS. (Team-plan customers also get an exact-match short-circuit at the team boundary via `team_custom_examples`, but that doesn't cross the team line — it's the customer's own pattern memory.)

### G. Use vector embeddings for input similarity in /admin clustering

Approach: embed each candidate's input string with a sentence-transformer; cluster by cosine similarity.

Why rejected (for now): adds a dependency, an embedding service, and ongoing inference cost for an offline review surface. Jaccard token similarity over hashed inputs is good enough at the cluster sizes Robert operates at (~1500 rows after a year). Revisit if cluster volume hits 50K+.

Adopted: Jaccard. Index by `(moment, content_type, standard_id)` first; similarity within bucket is a small N.

---

## Consequences

### Storage

- New table: `suggestion_precedents` (curated). Indexed on `(moment, content_type, standard_id)`.
- New table: `suggestion_candidates` (raw signal). Indexed on `(moment, content_type, standard_id, status)` where `status` is `pending | approved | rejected | merged`.
- Existing tables unchanged: `violation_overrides`, `team_rules`, `team_custom_examples`, `rationale_feedback`, `preferences` all keep their current shapes and roles.

Storage scales linearly with annotation volume. After a year of weekly review (~50 sessions × ~30 approvals), `suggestion_precedents` carries ~1500 rows. Sub-millisecond bucket lookup remains.

### Latency

Per-check latency is unchanged. Bucketed retrieval is sub-ms. Top-N=3 cap and 500-token budget keep prompt growth bounded. The skip-on-high-confidence rule means most checks (button labels, simple labels) skip precedent injection entirely.

### Engineering

The build plan in `_private/SUGGESTION_CALIBRATION_BUILD_PLAN.md` sequences this as ~10 PRs over 4 blocks. Each PR is independently shippable and reversible.

### Substrate boundary

Maintained. Customers never see counts, kappa, standard IDs, sample sizes, or the precedent corpus. `/admin` exposes everything for Robert. The `PUBLIC_TAXONOMY=false` flag (the single configurable boundary) is unaffected.

### Privacy

- ADR 2026-04-28 alignment: every customer-text field PII-screened; opt-in default OFF; per-team scoping by default.
- The contributeUpstream flag pattern (existing on `team_custom_examples`) extends to the Adjust modal's "Share with the ContentRX model" checkbox. Same default, same review flow.

### Customer surfaces

- Web dashboard: gains four actions per finding card (Copy / Adjust / Make a rule / Ship anyway is N/A).
- MCP / CLI / GitHub Action / LSP / Figma: gain matching affordances per the cross-surface uniformity table.
- Language pattern: every customer surface adopts the new vocabulary in the same wave.

### Engine

Engine version bump may not be required. The calibration loop adds a precedent block to the scan prompt at request time — that's a behavior change, but it's data-driven (varies per request based on retrieval). The static prompt structure stays identical when the precedent block is empty.

If the precedent injection materially changes verdict distribution, a version bump per `CLAUDE.md`'s "if standards or preprocessor changed" rule would apply. Decide at the time of the runtime PR (Block 2c).

---

## Validation

### How we'll know the loop works

1. **Re-run Robert's test case** *("Unable to complete operation. Please contact administrator.")* on `/dashboard` after Block 2c lands. Verify the suggestion is approximately the input length, plain language, no em dashes, no hedging filler. The PR #252 stopgap will pass this; the durable test is whether new annotations Robert adds via `/admin` then improve the suggestion further on subsequent checks for the same `(moment, content_type, standard)` cell.
2. **Coverage view** at `/admin/calibration` shows cells populating as Robert annotates. Cells without precedents fall back to standards-only LLM prompting (today's behavior).
3. **Latency monitoring**: per-check p95 stays within 10% of pre-launch baseline. Token usage per check tracked in admin dashboard; precedent block usage capped at 500 tokens.
4. **Customer adoption** of the Adjust flow visible in `/admin` — daily candidate count + approval rate per cell.

### How we'll know the customer UX works

1. **Smoke test** every surface after Block 1 lands: web, MCP, CLI, GitHub Action, LSP, Figma. Confirm Copy / Adjust / Make a rule / Ship anyway (where applicable) appear with the right labels and the same substrate signal contract.
2. **Vocabulary regression**: a copy-pin test on the rendered dashboard fails if "Violation" appears in customer-facing copy. Same test on the email templates and the Figma plugin UI.
3. **Color audit**: snapshot test on the Findings card with a hard-rule violation (red) vs. a default violation (amber) confirms the color rule is enforced.

### Rollback

Each PR is independently reversible:

- Block 1 (customer UX): revert the per-action PR; the dashboard returns to today's read-only state.
- Block 2 (substrate calibration): revert the prompt-injection PR; the engine returns to the PR #252 stopgap state. The new tables stay in place (no data lost) but go unread.
- Block 3 (connect): revert the wiring PR; customer signals stop flowing to CANDIDATES but every other piece keeps working.

The calibration loop is additive; it doesn't break the existing pipeline if turned off.
