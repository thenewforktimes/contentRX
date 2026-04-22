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
- `GET /api/standards`
- `GET /api/standards/[id]`
- `GET /api/moments`
- `POST /api/dashboard/api-key`
- `POST /api/checkout`
- `POST /api/portal`

Routes that don't need an envelope:

- `POST /api/webhooks/clerk` — incoming webhook, response is just an
  ACK to Clerk
- `POST /api/webhooks/stripe` — same, for Stripe
