# ContentRX API versioning policy

Adopted in v2 Session 9. Every public API response now carries a
`schema_version` field so clients can detect breaking changes before
deserializing the rest of the payload.

## The envelope

Every public API response is wrapped by `envelope()` from
`src/lib/api-envelope.ts`. The envelope adds two metadata fields to
every response:

```jsonc
{
  "schema_version": "1.0.0",   // semver string — see policy below
  "warnings": [],              // free-form deprecation notices

  // ...the route's original payload follows
  "result": { /* ... */ },     // for /api/check
  "rule":   { /* ... */ },     // for /api/team-rules POST
  // etc.
}
```

### Why backward-compatible (not strict-wrap)

The BUILD_PLAN_v2 spec sketched the envelope as
`{schema_version, result: <existing payload>, warnings}` — i.e. the
existing payload is wrapped in a `result` key. We deliberately chose
the lighter additive form: `schema_version` and `warnings` are added
as **siblings** of the existing top-level fields, not as a wrapping
parent.

Two reasons:

1. **Existing clients keep working without code changes.** The Figma
   plugin, CLI, MCP server, GitHub Action, and dashboard UI all read
   their existing fields by name (`data.result`, `data.rules`,
   `data.totals`, etc.). A wrapping envelope would break every one
   of them on the same release.
2. **The Session 9 acceptance criteria explicitly call for "deprecation
   test: add a field, bump minor, verify old client still works."**
   Backward compat is the contract.

The cost is that response shapes aren't uniform across endpoints
(every route's data fields differ at the top level). New endpoints
SHOULD adopt the strict `result: <payload>` shape so they're uniform
from day one — see `/api/check` for the precedent (`result` is the
EvaluationResult, with metadata as siblings).

## Semver policy

`schema_version` follows semantic versioning:

| Bump | When | Examples |
|---|---|---|
| **Patch** (1.0.0 → 1.0.1) | Bug fix that doesn't change the response shape; new error message text | Renaming an internal field (oxymoron — internal fields aren't observable; usually a no-op) |
| **Minor** (1.0.0 → 1.1.0) | Additive change: new optional field, new enum variant, new endpoint | Session 10 adding `confidence` + `review_reason` to violation results |
| **Major** (1.0.0 → 2.0.0) | Breaking change: field removed, field renamed, type narrowed | Removing the legacy `audience` field; renaming `overall_verdict` |

Whenever the version bumps, append a deprecation entry to the
`warnings` array on every response that ships with the change.
Clients should log + display warnings; future versions may turn them
into errors.

## Changelog

### 1.6.0 (human-eval build plan Session 13)

**Additive bump** — old clients reading `review_reason` as an opaque
string keep working. Clients that switch on the value should add
an arm for `ensemble_disagreement`.

- **`CheckResult.review_reason`** gains a new enum variant:
  `ensemble_disagreement` — scan/validate disagreement (first-pass
  ensemble disagreeing with itself). Previously conflated with
  `standards_conflict`; Session 13 disentangles them and establishes
  precedence (`standards_conflict` > `ensemble_disagreement` >
  `situation_ambiguity` > `out_of_distribution` > `novel_pattern` >
  `low_confidence`).
- **`Violation.validate_rejection_reason`** (string, optional) —
  when a scan-proposed violation was rejected by validate, this field
  preserves validate's reasoning so the review queue can show both
  sides of the ensemble disagreement. Null on confirmed violations
  and on preprocessor-source violations.
- **Semantic change to `verdict`:** `ensemble_disagreement` flips the
  verdict to `review_recommended` even when `violations` is empty —
  a validate-rejection with nothing surviving is still worth Robo's
  review. Previously the verdict stayed `pass` when the violations
  list was empty.

### 1.5.0 (human-eval build plan Session 4)

**Additive bump** — pre-Session-4 clients keep working without
supplying any of the new fields.

`POST /api/violations/override` gains two optional fields:

- **`override_reason_code`** (one of `"not_applicable_here"` /
  `"standard_too_strict"` / `"fix_is_worse"` / `"shipping_anyway"` /
  `"confusing_need_more_context"`) — the user-facing five-item
  vocabulary. Distinct from Robo's `triage_category` vocabulary
  (from `EVAL_PROTOCOL.md`). The mapping between the two is a
  judgment call captured during review, not a mechanical translation.
  Typical mappings are documented in `src/lib/override-reasons.ts`.
- **`session_id`** (free-form string up to 64 chars) — client-supplied
  grouping key. Figma plugin uses one per scan (`fig-<ts>-<rand>`);
  CLI/CI can use the run ID; dashboard can use a per-tab UUID. Three+
  overrides on the same standard inside one session collapse into a
  single `standard_pushback` row in the review queue (see
  `src/lib/session-aggregation.ts`). Rows without a `session_id`
  fall back to a `(user_id, 10-minute-window)` pseudo-session.

### 1.4.0 (human-eval build plan Session 3)

**Additive bump** — pre-Session-3 clients keep working without
supplying any of the new fields.

`POST /api/violations/override` now accepts the richer override signal:

- **`override_stance`** (optional, one of `"agree"` / `"disagree"` /
  `"agree_but_overriding"`) — the three-button verdict. Captures the
  user's opinion alongside the action-oriented `override_type`.
- **`actor_role`** (optional, one of `"designer"` / `"engineer"` /
  `"pm"` / `"other"`) — weights the signal. Default inferred from
  `source` via `src/lib/actor-role.ts`; clients can override.
- **`rationale_expanded`** (optional, boolean) — did the user click to
  expand the rationale before acting? Feeds the four-quadrant
  behavior model.
- **`time_to_action_ms`** (optional, integer, 0–3,600,000) — elapsed
  ms from verdict surfaced to user action. Below 2000ms + not
  expanded ≈ reflex.
- **`suggested_text`** / **`applied_text`** (optional, strings, same
  100k cap as `text`) — the counterfactual triple. Hashed
  server-side to `suggested_text_hash` / `applied_text_hash`. Raw
  text never persists.

Stored rows include the new columns in the `returning()` response.
Behavior-quadrant derivation lives in `src/lib/behavior-quadrant.ts`
(pure function; surfaced in the `/dashboard/overrides` report).

### 1.3.0 (human-eval build plan Session 2)

**Additive bump** — old clients reading `review_reason` as an opaque
string keep working. Clients that switch on the value should add arms
for the four new subtypes.

- **`CheckResult.review_reason`** gains four new enum variants beyond
  the existing `low_confidence`:
  - `standards_conflict` — scan/validate disagreed (validate rejected
    at least one scan candidate). Richest signal for taxonomy refinement.
  - `situation_ambiguity` — moment classifier confidence below the
    `MOMENT_CONFIDENCE_THRESHOLD` (0.6). Routes to moment-classifier
    backlog, not standards backlog.
  - `out_of_distribution` — input doesn't resemble training data.
    Constant reserved; full emission logic pending later sessions.
  - `novel_pattern` — classifier confident but override rate on
    similar strings climbing. Reserved; requires override-rate history
    from later sessions.
- **`RationaleHop.confidence`** on the `detect_moment` hop is now
  populated with the moment-classifier's confidence (0.5 fallback,
  0.9 pattern-matched). `output.ambiguous` on the same hop is `true`
  when the confidence falls below threshold.
- When multiple review signals fire, precedence order decides the
  subtype: `standards_conflict` > `situation_ambiguity` >
  `out_of_distribution` > `novel_pattern` > `low_confidence`.

### 1.2.0 (human-eval build plan Session 1)

**Additive bump** — old clients keep working.

- **`Violation.related_standards`** (list of string, default `[]`):
  standard IDs the LLM considered as adjacent candidates and either
  rejected or applied. Gives reviewers context on overlapping rules.
- **`Violation.ambiguity_flag`** (string, optional): typed reason for
  uncertainty on this specific violation. One of
  `voice_mismatch_with_moment`, `standards_conflict`,
  `insufficient_context`, `situation_uncertain`, or null.
- **`Violation.rule_version`** (string, optional): per-standard version
  of the standard in effect when this violation was emitted. Sourced
  from the new per-standard `version` field in
  `standards_library.json` (also added in Session 1).
- **`CheckResult.rationale_chain`** (list of hop objects, default
  `[]`): ordered list of the hops the pipeline executed (classify,
  detect_moment, filter, preprocess, scan, validate, merge). Each hop
  carries `step`, `inputs`, `output`, `confidence` (optional),
  `rule_versions` (standard_id → version map for rules consulted at
  this hop), and `ambiguity_flag` (optional). Lets reviewers pinpoint
  which hop produced a bad verdict without re-running the pipeline.

Clients that weren't reading any of these fields keep working. Clients
that want the new capabilities should read them and tolerate absence
(for pre-1.2.0 responses).

### 1.1.0 (v2 Session 10)

**Additive bump** — old clients keep working.

- **`Violation.confidence`** (float, 0–1): engine self-rating for each
  finding. Preprocessor violations get 1.0; LLM violations get 0.85
  by default. When the LLM scan response includes its own confidence
  per violation, that value overrides the default.
- **`CheckResult.verdict`** (string, one of
  `"pass" | "violation" | "review_recommended" | "error"`): the
  calibrated three-state verdict. `overall_verdict` stays on
  `"pass" | "fail" | "error"` for backward compat.
- **`CheckResult.review_reason`** (string, optional): non-null only
  when `verdict == "review_recommended"`. Current values: `"low_confidence"`.

Clients that were reading `overall_verdict` keep working. Clients that
want the three-state verdict should read `verdict` and fall back to
`overall_verdict` if absent (for pre-1.1.0 responses).

### 1.0.0 (v2 Session 9)

Initial envelope: every public response carries `schema_version` and
`warnings`. See [the envelope section](#the-envelope) above.

## Adding a field (minor bump example)

When v2 Session 10 landed, every violation got a new `confidence`
field. The pattern:

1. Add the field to `Violation.to_dict()` in
   `src/content_checker/models.py` — the field is OPTIONAL on the
   client side (clients that don't read it must continue to work).
2. Bump `SCHEMA_VERSION` in `src/lib/api-envelope.ts` and the mirror
   in `src/content_checker/models.py` (e.g. `1.0.0` → `1.1.0`).
3. Add a `warnings` entry only if the change affects existing fields
   (a pure addition typically doesn't need one).
4. Run the parity gate (`python3 tools/parity_check.py`) to confirm
   the JS side is in lock-step.
5. Update the Changelog section above.

## Removing a field (major bump example — hypothetical)

If we ever drop `audience` from CheckResult:

1. **First release** — minor bump (1.X.Y → 1.X+1.0). Keep the field;
   add a `warnings` entry: `["audience field deprecated; will be
   removed in 2.0.0"]`. Update README + this doc.
2. **Wait at least one release cycle** so existing clients see the
   warning.
3. **Next major release** — bump to 2.0.0. Remove the field.
   Old-version clients fail loudly (missing field) rather than
   silently get wrong behavior.

## Where SCHEMA_VERSION lives

Two mirror constants:

- TS: `src/lib/api-envelope.ts` — used by the `envelope()` helper that
  wraps every Next.js API response.
- Python: `src/content_checker/models.py` — used by `EvaluationEnvelope`
  for any future Python harness that emits API-shaped responses
  directly (e.g., a CLI or Python evaluator that bypasses the Next.js
  layer).

Keep them in lock-step. There's no automated check today; treat
mismatches the same way you'd treat any other source-of-truth drift.

## Endpoint list

Routes that return an envelope as of 1.0.0:

- `POST /api/check`
- `GET /api/team-rules`
- `POST /api/team-rules`
- `PATCH /api/team-rules/[id]`
- `DELETE /api/team-rules/[id]`
- `GET /api/team-analytics`

Routes that **will** envelope when their next change ships:

- `POST /api/classify`
- `POST /api/dashboard/api-key`
- `POST /api/checkout`
- `POST /api/portal`

Routes that don't need an envelope:

- `POST /api/webhooks/clerk` — incoming webhook, response is just an
  ACK to Clerk
- `POST /api/webhooks/stripe` — same, for Stripe
