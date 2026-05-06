# ContentRX — Claude Code instructions

**Read this file first. Every session. No exceptions.**

The internal build plan lives at `_private/BUILD_PLAN_v2.md` (gitignored,
local only). The human-eval companion is at `_private/HUMAN_EVAL_BUILD_PLAN.md`.
Read whichever is relevant before touching the corresponding surface;
ask Robert for a fresh copy if your worktree doesn't have them. Public
contributors can ignore both — the ADRs in `decisions/` carry the
load-bearing rationale that the build plans expand on.

If a session involves a positioning-level decision (public/private boundary,
moat hypothesis, wire-format break), also read
[decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md)
and any newer ADR. The current positioning is locked by that ADR — sessions
that propose reversing it require a new ADR superseding it, not an
in-session pivot.

## What this repo is

One repo, one directory, one push cycle. Currently ships four things
from the same working tree (`thenewforktimes/contentRX`); two more
surfaces (MCP server, LSP server) land in BUILD_PLAN_v2 phases 1 and 5.

1. **Python evaluation engine** — `src/content_checker/` (the library)
2. **Figma plugin** — `figma-plugin/`
3. **Python CLI** — `cli/` (engine-side) and `cli-client/` (HTTP client
   shipped to PyPI as `contentrx-cli`)
4. **Next.js 15 backend app** — `src/app/`, `src/lib/`, `src/db/`,
   `src/middleware.ts`, `api/`, top-level `package.json` / `tsconfig.json`
   / `next.config.ts` / etc.
5. **GitHub Action** — `github-action/` (in-tree today, splits to its
   own public repo in v2 Phase 2)
6. **MCP server** — `mcp-server/` (Python, stdio, ships via `uvx`)
7. **LSP server** — `lsp-server/` (Python, stdio, ships via `uvx`) plus
   editor extensions in `editor-extensions/` (VS Code etc.)
8. **Docs site** — `docs-site/` (in-tree today, target deploy target is
   `docs.contentrx.app` — but the public surface is now `/accuracy`,
   `/calibration`, `/essays`, `/reports`, NOT a public taxonomy.
   See [decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md).)

The Next.js app imports the Python engine at runtime via a Vercel Python
function (`api/evaluate.py`); no vendored copy, no sync script — the
engine source at `src/content_checker/` IS the source Vercel bundles
into the Python function (see `vercel.json` → `functions.includeFiles`).

Engine tests live in `tests/`. App tests will land next to the code
(`*.test.ts` / `__tests__/`) as they get written — `testpaths = ["tests"]`
in `pyproject.toml` keeps pytest scoped to the Python side.

## Current positioning (locked by ADR 2026-04-25)

The taxonomy is **private**. The 47 standards, 13 moments, per-standard
versioning, `version_history`, the `influences` field, and the
`rationale_chain` detail are internal artifacts only. They live in
`src/content_checker/standards/standards_library.json` and the related
substrate modules; they are never rendered to product users.

The public surface — what customers and prospects actually see — is:

- `/accuracy` — measured system kappa with 95% CI, measured self-drift
  kappa with 95% CI, target ceiling stated separately. Generated nightly.
- `/calibration` — weekly calibration log entries (kappa movement, drift
  signals, override count, refinement-log activity). Generated automatically.
- `/essays` — monthly named-expert essays in Robert's voice. Hand-written.
- `/reports` — quarterly accuracy reports. Generated scaffold, hand-edited
  narrative.

The substrate (private taxonomy + override stream + refinement log) produces
the report (public artifacts) through scheduled generators in `reports/`.
Nothing outside reads substrate. This separation is the load-bearing
architectural choice; the substrate-vs-report contract is documented in
`_private/architecture.md` (gitignored), and
[decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md)
records the rationale and rejected alternatives.

**The moat is operational, not architectural.** If the calibration log goes
stale for a quarter, the moat decays in public. The `reports/` module's
staleness monitoring is P0 infrastructure, not marketing nice-to-have.

## Wire format — schema_version 3.0.0

Source of truth for the version constant: `SCHEMA_VERSION` in
`src/content_checker/models.py` (Python) and `src/lib/api-envelope.ts`
(TS). Both must stay in lockstep.

The public Violation envelope ships `issue`, `suggestion`, `severity`,
`confidence`, and (since 2.5.0) a customer-facing `category`. Top-level
envelope carries `schema_version`, `verdict`, `review_reason`,
`warnings`, plus the input-grounding fields (`content_type`, `moment`)
and the document-tier outputs (`suggested_rewrite`,
`suggested_diagnostic`). Removed entirely from the public envelope:
`docs_url`, `related_standards`, `rationale_chain`. Stripped from
user-visible surfaces but retained in internal substrate API responses
(founder-auth only): `standard_id`, `rule_version`.

Sessions that expose `standard_id` or `rule_version` to a user-facing
surface — web app cards, MCP response payload, CLI output, Figma plugin
UI, GitHub Action PR comment text, LSP diagnostic messages, editor
extension UI — are wrong. Internal logging and the `/admin` dashboard see
them; product users do not. The one allowed exception today is the
team-rule management UI at `/dashboard/rules`, which renders standard
IDs because users need an identifier to enable/disable rules — a
follow-up will add a `displayName` column so even that surface stops
leaking IDs.

Major-version cutovers (2.0.0 in the privacy pivot, 3.0.0 in the
metering collapse) land atomically — engine + all surfaces + snapshot
tests in a single PR. ContentRX has zero paying customers, so the wire
format can break cleanly with no deprecation window or migration email.

3.0.0 history: the schema bumped from 2.5.0 → 3.0.0 with the metering
collapse (PR #342). The breaking changes were the removal of the
`segment_type` request parameter and the rename
`metering.tier` → `metering.size_class`. The full per-version changelog
lives in the comment block above `SCHEMA_VERSION` in `models.py` and is
mirrored verbatim in `src/lib/api-envelope.ts`.

## /admin founder dashboard

`/admin/*` is the founder-authenticated substrate UI in `src/app/admin/`.
Auth is enforced via Clerk role check at the layout level — every page
under `/admin` redirects unauthenticated or non-founder requests to `/`.
Pages: `/admin/model` (browsable taxonomy), `/admin/calibration` (kappa
over time), `/admin/refinement-log` (refinement candidates UI),
`/admin/queue` (review queue with subtype filters), `/admin/reports`
(preview-before-publish gate), `/admin/essay-drafts` (cold-start scaffold).
Single-user by design — no multi-tenancy, no admin-of-admins recursion.

**Auth model — pages vs APIs.** The Clerk layout auth above gates
`/app/admin/*` page routes. APIs at `/api/admin/*` (e.g.
`/api/admin/refinement-signals`) sit OUTSIDE the layout tree and don't
inherit that auth — they use header-based authentication instead,
typically `Authorization: Bearer <CRON_SECRET>` enforced via
`requireCronAuth(req)`. Both modes are valid; the choice depends on
the consumer (browser session → layout auth; server-to-server cron
or GitHub Action → header auth). When adding a new admin-tier
endpoint, pick the auth model that matches the caller and document
it in the route's docstring.

Lands in Phase B of the post-pivot build plan.

## PUBLIC_TAXONOMY feature flag

`PUBLIC_TAXONOMY` is the single env-var-controlled boundary between the
private-taxonomy-default and the (preserved-but-off) public-taxonomy code
paths. Default `false` everywhere. Code paths gated by it stay in the
codebase even when off — they are reversibility insurance, not dead code.
**Don't delete them.** A CI smoke job runs the test suite with the flag
flipped to `true` so the path doesn't silently rot.

## Locked architectural decisions

**Engine side:**
- Python 3.10+ package in `src/content_checker/`
- Pipeline: classify → filter → preprocess + LLM scan → validate → merge
- 25 preprocessor checks, 47 standards, 13 moments, 8 content types
- Anthropic SDK for LLM calls; `api_utils.py` is the single LLM boundary
- Tests are structural (no live API calls) — see `tests/`
- Current version: `4.6.1` (source of truth: `src/content_checker/__init__.py`)

**App side:**
- Next.js 15 App Router, TypeScript, Tailwind v4, React 19
- Auth: Clerk v7 (do not consider alternatives)
- Database: Supabase Postgres (BUILD_PLAN originally said Neon; swapped
  because Robert had a Supabase account. Both are Postgres, Drizzle is
  identical.)
- DB driver: `postgres` (postgres.js) + `drizzle-orm/postgres-js`
- Billing: Stripe Checkout + Customer Portal + webhooks (no custom UI)
- Rate limiting: Upstash Redis + `@upstash/ratelimit`
- Email: Resend
- Errors: Sentry
- Analytics: Plausible
- Charts: Recharts
- No UI component libraries. Tailwind only.

## Database schema

Source of truth: `src/db/schema.ts`. Core tables: `users`, `usage`,
`subscriptions`, `team_members`, `team_rules`, `violations`, `ditto_syncs`,
`violation_overrides`, `graduation_status`, `rationale_feedback`,
`team_custom_examples`.
Always use Drizzle — never raw SQL. Schema pushes run via `npm run db:push`
(wraps `drizzle-kit push` with `.env.local` loaded via `dotenv-cli`,
because `drizzle-kit` does not auto-load `.env.local` the way Next.js does).

`src/db/index.ts` exports `getDb()` which is **lazy-initialized**, not a
module-level singleton. This avoids throwing at build time when
`DATABASE_URL` is not yet provisioned, and it avoids the `Proxy`-wrapper
pitfall that silently breaks auth adapters.

## API route conventions

- All routes under `src/app/api/`
- Auth check at the top of every handler — `auth()` from Clerk is
  **async** in v7 (`const { userId } = await auth()`)
- Return types: JSON, standard error shapes
- Always validate request bodies with zod
- Validate engine-facing strings (`content_type`, `moment`, `audience`)
  against `src/lib/engine-taxonomy.ts` to prevent prompt injection
- Never log PII. `violations` table stores sha256 hashes only.

## /api/check request flow (locked)

1. Auth via Clerk session OR `Authorization: Bearer cx_...` API key
2. Load team rules (only matters when user is on Team plan)
3. Check monthly quota — 402 if exhausted
4. Rate limit check — 429 if exceeded (60/min per user, sliding window)
5. **Custom-example short-circuit** (Team plan only — human-eval
   Session 30): if `normalizeText(text)` matches a
   `team_custom_examples` row scoped to the team and its optional
   moment/content_type context, skip the LLM entirely and use the
   stored verdict. Quota still decrements; LLM token cost goes to
   zero for the match.
6. Otherwise call `/api/evaluate` (Python) with validated `text`,
   `content_type`, `audience`, `moment`.
7. Apply team's disabled-rule filter + overrides + added rules
   (runs in both paths — admins can still strip standards from a
   custom-example violation-verdict row).
8. Log each violation into `violations` table with `sha256(text)`.
9. Increment `usage` counter for the current month.
10. Return result + usage metadata.

## Python engine in the Vercel deployment

`api/evaluate.py` is a Vercel Python function. At runtime it
`sys.path.insert(0, <repo_root>/src)` so it can `from content_checker
import check`. Vercel bundles `src/content_checker/**` into the function
via the `includeFiles` directive in `vercel.json`. There is no separate
vendored copy to sync.

**Internal secret:** `/api/evaluate` checks `x-internal-secret` against
`INTERNAL_EVAL_SECRET` using `hmac.compare_digest` (constant time). Fails
closed when the env var is unset or empty. Both runtimes read the same
env var. `/api/check` is the only public surface; `/api/evaluate` is an
internal helper.

## What not to do

- Don't port Python engine logic to TypeScript. Call the Python function.
- Don't add new dependencies without checking bundle size.
- Don't build custom UI for billing — Stripe Portal handles everything.
- Don't store plaintext strings in the `violations` table.
- Don't add features not in BUILD_PLAN_v2.md — scope creep kills the ship.
- Don't commit `.env.local`; commit `.env.local.example` instead.
- Don't wrap the Drizzle `db` object in a JavaScript `Proxy` for lazy
  init — it silently breaks libraries that inspect adapter shape. Use
  the `getDb()` pattern that's already in place.
- Don't expose `/api/evaluate` as a public surface; it's an internal
  helper guarded by `INTERNAL_EVAL_SECRET`. All real clients call
  `/api/check`.
- Don't edit `src/content_checker/` and forget to run the engine tests
  (`python3 -m pytest tests/`). The Next.js app calls this code in prod.
- Don't use raw Tailwind shade classes (`text-stone-700`, `bg-stone-50`,
  `border-stone-200`, `bg-emerald-700`, etc.) outside `src/components/ui/`.
  See "Design system" below — the shades are the underlying material;
  callers reach for semantic tokens (`text-default`, `bg-raised`,
  `border-line`, `<Button>`, `<Pill>`). The ESLint rule warns on
  violations.

## Design system — token-based UI

The web app uses a three-tier semantic token system defined in
`src/app/globals.css` and mirrored in `src/lib/design-tokens.ts` (for
emails). Dark mode is the canonical experience. Every token pairing is
WCAG 2.1 AAA verified. See ADR-tier history in PRs #308, #309, #310,
#311, #312, #313, and #314 for the rationale.

**Tokens (the only colors callers should reach for):**

```
Surfaces:  bg-canvas / bg-raised / bg-sunken / bg-overlay
Text:      text-strong / text-default / text-quiet
Borders:   border-line / border-line-strong
Focus:     focus-visible:ring-ring
Accents:   {bg|text|border}-accent-{primary|affirm|caution|concern|info}-{solid|on|soft|text|border}
```

Every accent has a `solid` (filled button bg), `on` (text on solid),
`soft` (subtle alert bg), `text` (text on canvas/soft), and `border`
slot. So `bg-accent-caution-soft text-accent-caution-text border-accent-caution-border`
makes a warm-orange callout that meets AAA in both modes automatically.

**Primitives (use these instead of inlining classes):**

| Primitive | Path | Use for |
|---|---|---|
| `<Button>`, `buttonStyles()` | `src/components/ui/button.tsx` | All buttons; `buttonStyles()` for `<Link>` styled-as-button |
| `<Pill>` | `src/components/ui/pill.tsx` | Status tags, badges with semantic tone |
| `<Card>` | `src/components/ui/card.tsx` | Bordered card containers |
| `<Alert>` | `src/components/ui/alert.tsx` | Callout boxes (caution/concern/info/affirm) |
| `<Input>`, `<Textarea>`, `<Select>` | `src/components/ui/input.tsx` | All form fields |
| `<Heading level={1|2|3|4}>` | `src/components/ui/heading.tsx` | Page/section/subsection titles |
| `<Eyebrow>` | `src/components/ui/eyebrow.tsx` | Mono uppercase pre-heading |
| `<Section>` | `src/components/ui/section.tsx` | Eyebrow + h2 + body block |
| `<Divider>` | `src/components/ui/divider.tsx` | Horizontal rule (semantic `<hr>` or decorative) |

**The rule:** if you find yourself writing `text-stone-X dark:text-stone-Y`
or `bg-{color}-{X} dark:bg-{color}-{Y}`, stop and ask whether a token
or primitive covers it. Almost always one does.

**The ESLint rule** (`no-restricted-syntax` in `eslint.config.mjs`)
warns on raw `(bg|text|border|ring|...)-stone-N` outside
`src/components/ui/` and `src/emails/`. Existing warnings represent
incremental cleanup work, not a build-failure gate. New code should
ship token-clean.

**Email templates** (`src/emails/`) use `src/lib/design-tokens.ts`
directly because Resend renders to inline-styled HTML — Tailwind classes
don't reach the recipient. Shared style primitives live in `_shell.tsx`
(`primaryButton`, `headingStyle`, `bodyStyle`, `cautionBox`, etc.) so
templates compose, never inline hex.

## Running locally

Engine only (Python, no backend app):
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/
```

Full stack (Python engine + Next.js app):
```bash
npm install                          # TS/JS deps for the app
cp .env.local.example .env.local     # fill in secrets
npm run db:push                      # once DATABASE_URL is set
npm run dev                          # localhost:3000
```

Once a Vercel project is linked, the secrets workflow is:
```bash
vercel link
vercel env pull .env.local --yes
npm run db:push
npm run dev
```

Note: `vercel env pull` replaces the entire `.env.local` — keep any
manually added local-only variables in `.env.development.local` so they
survive pulls.

## Clerk v7 Core 3 notes

- `auth()` is async: `const { userId } = await auth()`
- `auth.protect()` is called directly: `await auth.protect()`
- `clerkClient()` is async
- `authMiddleware()` is removed — we use `clerkMiddleware()`
- Minimum Node 20.9.0 (we target Node 24 LTS on Vercel)

## Secret rotation ceremony

When rotating a shared secret (`INTERNAL_EVAL_SECRET`,
`ANTHROPIC_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLERK_SECRET_KEY`,
`CLERK_WEBHOOK_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, etc.):

1. **Update Vercel project env first.** `vercel env rm <NAME> production
   && vercel env add <NAME> production` (paste new value), or use the
   Vercel Dashboard. The current production deployment keeps running on
   the old value until the next deploy — there is no in-place secret
   reload.
2. **Trigger a redeploy.** `vercel --prod` from a clean working tree, or
   push an empty commit to main. Vercel rebuilds with the new secret.
3. **Verify the new deploy is live.** Hit a route that uses the secret
   (e.g. `/api/check` for Anthropic / internal eval, a Stripe test webhook
   for Stripe). Check Vercel runtime logs for any auth-mismatch errors.
4. **Pull the new secret locally if needed.** `vercel env pull
   .env.local --yes`. Note this overwrites `.env.local` entirely —
   localhost-specific overrides belong in `.env.development.local`.
5. **Retire the old secret at the source.** Only after step 3 verifies
   the new deploy is healthy. Stripe / Clerk / Anthropic dashboards
   typically let you delete or disable the old key.

Order matters. Rotating at the source first (step 5 before step 1)
breaks production until the new secret reaches Vercel — which can be
several minutes if a deploy is in flight. The order above keeps
production live throughout.

If a secret was already rotated at the source before step 1
(emergency credential leak, etc.), accept that production will fail
auth checks for the duration of one Vercel deploy (~2 min) and
prioritize step 1 → step 2 → step 3 immediately.

## Known limitations (deferred audit findings)

Things the post-Session-3 audit flagged that we consciously chose NOT
to fix immediately. Track these so they don't get forgotten.

1. ~~API keys are stored plaintext on `users.api_key`.~~ Resolved in
   Session 9: keys are now sha256-hashed at `users.api_key_hash` (unique)
   with a short display prefix at `users.api_key_prefix`. Raw `cx_...`
   values are shown to the user exactly once at mint/rotate time via
   `/dashboard` or the Figma sign-in callback. `resolveAuth` hashes the
   incoming bearer before the DB lookup. The key body is a cuid2.

2. ~~`getCurrentUsage` → `incrementUsage` race.~~ Resolved: `src/lib/usage.ts`
   exposes `claimQuotaSlot(userId, quota)` which does an atomic upsert
   with `setWhere: count < quota` on the update branch. Returns
   `{granted: false, count}` when the guard rejects, so `/api/check`
   can 402 without touching the engine. `getCurrentUsage` is now a
   read-only helper for the dashboard.

3. ~~Webhook idempotency.~~ Resolved for Clerk webhooks: `src/app/api/webhooks/clerk/route.ts`
   dedupes by `svix-id` via `redis.set(key, "1", { nx: true, ex: 24h })`
   immediately after signature verification. Stripe webhooks have the
   same pattern. Retries return `{ok: true, deduplicated: true}` without
   re-applying side effects.

4. **No DB-level CHECK constraints on enum columns.** Drizzle's
   `text("plan", { enum: [...] })` is TS-only. Use `pgEnum` if DB-level
   protection matters. Low priority.

5. **`users.email` has no unique constraint.** Decision deferred:
   revisit when the team invite flow (Session 9) makes email-based
   lookup matter.

6. ~~No unique constraint on `subscriptions.userId`.~~ Resolved in
   Session 8: partial unique index `subscriptions_user_active_idx` on
   `(user_id) WHERE status = 'active'`. Historical canceled rows stay.
   `stripe_sub_id` also got a uniqueness constraint so webhook upserts
   can target it deterministically.

7. **`check_batch` has no aggregate size ceiling** (engine-side).
   Cost DoS, not a security breach. **Target:** before CLI ships
   broadly (Session 11).

8. **Standards-library prompt-injection surface.** `/api/check`
   validates `content_type` and `moment` against `engine-taxonomy.ts`,
   closing the injection at this boundary. Engine-side hardening
   (sentinel delimiters around user text) is still worth doing when
   engine-level test coverage for it exists.

9. **Figma plugin outbound `postMessage` target origin (PLG-H-01).**
   Every `parent.postMessage()` in `figma-plugin/ui.html` uses `"*"`
   as the target origin, including the `save-token` message that
   carries the `cx_...` token. Defense-in-depth says set an explicit
   target. Not fixed yet because changing to `"https://www.figma.com"`
   risks silently breaking Figma Desktop (Electron's parent frame may
   not match the target and the browser drops the message with no
   error). **Fix:** test with both Figma web and Figma Desktop in a
   live session, then change the `save-token` call (only — other
   messages carry no secret). The incoming-message origin check at
   `ui.html:3367` already closes the higher-severity PLG-C-01.

## Before every commit

- `python3 -m pytest tests/` — engine tests must stay green
- `npm test` — web-app vitest suite (pure-logic tests for lib helpers); must stay green
- `npm run lint` — app linter
- `npm run build` — catches typecheck + Next.js build errors together
- Run through the acceptance criteria from the current BUILD_PLAN_v2
  session

---

## Surfaces, in order of primacy (BUILD_PLAN_v2)

1. **MCP server** (Python, stdio, via `uvx contentrx-mcp`) — engineers in
   Claude Code / Cursor / Claude desktop. **Lands in v2 Phase 1.**
2. **LSP server** (Python, stdio, via `uvx contentrx-lsp`) — engineers
   typing in any LSP client. **Lands in v2 Phase 5.** Editor extensions
   in `editor-extensions/` consume this surface.
3. **GitHub Action** — engineers on PRs. (In-tree today; publishes to
   Marketplace in v2 Phase 2.)
4. **CLI** — engineers in terminals and CI. (`contentrx-cli` on PyPI.)
5. **Figma plugin** — designers and PMs working in Figma.
6. **Customer web dashboard** — `/dashboard` for paying customers (usage,
   API keys, team rules if/when teams ship).
7. **Founder `/admin` dashboard** — substrate UI for the daily review
   rhythm, accuracy snapshots, calibration log, refinement-log, and
   report publication gate. Single-user. **Critical-path post-pivot.**

The plugin is no longer the headline. The MCP server is. The privacy
boundary applies to surfaces 1–5 (which render to product users) — they
must never expose `standard_id` or `rule_version`. Surfaces 6 and 7 are
allowed to render those fields under appropriate auth.

## Non-negotiables (additions per BUILD_PLAN_v2 + ADR 2026-04-25)

These join the existing rules in "What not to do" above. They apply to
every API change, every new surface, every code review going forward.

**From the original v2 plan (still live):**

- `schema_version` on every API response, semver'd. Currently `3.0.0`
  (post-metering-collapse, PR #342). Source of truth: `SCHEMA_VERSION`
  in `src/content_checker/models.py` and `src/lib/api-envelope.ts`.
- All LLM JSON parses go through `parse_llm_json` in `api_utils.py`. (Lands in v2 Session 3.)
- All Anthropic clients have `max_retries=2`. (Lands in v2 Session 3.)
- JS/Python parity is CI-gated; divergence blocks merge. (Lands in v2 Session 2.)
- Every verdict is one of `violation | review_recommended | pass`. (Lands in v2 Session 10.)
- Override dismissals write to the `violation_overrides` table — never
  silently discarded. (Lands in v2 Session 11.)

**Added by ADR 2026-04-25 (private-taxonomy pivot):**

- The public Violation envelope contains only `issue`, `suggestion`,
  `severity`, `confidence`. **Never** `docs_url`, `related_standards`,
  `rationale_chain`.
- `standard_id` and `rule_version` are returned in internal substrate API
  responses (founder-auth) but **never rendered** on user-facing surfaces
  (web dashboard cards, MCP response, CLI output, Figma plugin UI, GitHub
  Action PR comment, LSP diagnostic messages, editor extension UI).
  Snapshot tests on each surface enforce this.
- The `PUBLIC_TAXONOMY=false` feature flag is the single configurable
  boundary between private and public taxonomy code paths. Default `false`
  everywhere; CI exercises both modes. Code paths gated by it stay in the
  codebase as reversibility insurance — don't delete them.
- The substrate-vs-report split is structural. Substrate (private,
  `standards_library.json`, override stream, refinement log) lives in
  `src/content_checker/`, `evals/`, `src/db/`. Report (public, kappa
  numbers, narrative) lives in `reports/`. Substrate produces report
  through scheduled generators. Nothing outside reads substrate.
- BUILD_PLAN_v2 sessions 7, 19, 20 (and Phase 6 in full) are DEFERRED.
  Don't re-activate them without an ADR superseding the 2026-04-25 pivot.
  Deferred-section index lives in the internal build plan
  (`_private/BUILD_PLAN_v2.md`).

## Banned shortcuts

- **No new surfaces that bypass the engine.** Every surface calls the
  same `/api/check` (or, in-process, the same underlying pipeline). One
  source of truth for verdicts; no per-surface drift.
- **No silently-swallowed errors.** Fail-closed, log, surface. Every
  `except`/`catch` either re-raises, returns an explicit error, or
  logs to stderr — never `pass`.
- **No "contact sales" gating on self-serve-appropriate tiers.** Free
  and Pro must be self-serve end to end. Team can require a one-step
  upgrade flow but not a sales call.
- **No accuracy claims without a link to the accuracy page.** Once
  `/accuracy` lands (Phase C of the post-pivot plan), every
  customer-facing surface that mentions accuracy links to it.
- **No publishing the standards library.** The taxonomy is private per
  ADR 2026-04-25. Don't add public routes that render standards or
  moments by name; don't add a `docs_url` field to violations; don't
  reactivate `scripts/generate-spec.mjs` or the `contentrx-standards`
  repo without a new ADR superseding the pivot.
- **No inventing customer-facing vocabulary.** Read
  [docs/copy-vocabulary.md](docs/copy-vocabulary.md) before writing
  any string a customer sees. *Findings* vs *violations* vs
  *overrides*, *team owner* not *admin*, *Figma plugin* not *Figma*,
  *monthly limit* not *quota* — these are settled calls, diverging
  in a new surface is a regression.

## Customer data — non-negotiables

ContentRX is a customer-not-product business. The subscription is the
entire revenue model; we don't sell, repackage, profile, or train
on customer strings. The full position is at `/ethics` (Commitment 3),
the contract is in [decisions/2026-04-28-customer-not-product.md](decisions/2026-04-28-customer-not-product.md),
and the engineering layer that backs it lives in three files. None of
this is aspirational — every public route handling a string already
behaves this way.

**The three guard files (don't bypass them):**
- `src/lib/pii-screen.ts` — regex pre-screen that refuses obvious
  credentials and PII (credit cards via Luhn, SSNs, AWS / Stripe /
  OpenAI / Anthropic / GitHub keys) on every text-accepting route.
  Wired into `/api/check`, `/api/classify`, `/api/suggest-fix`,
  `/api/violations/override`, and `/api/team-custom-examples`. Add
  a new public route that takes a string → wire the pre-screen too.
- `src/lib/sentry-scrub.ts` — Sentry `beforeSend` handler. Drops
  request bodies, auth headers, cookies, query strings; truncates
  exception messages at 200 chars; redacts text-shaped extras /
  tags / breadcrumb data. Don't disable, don't loosen.
- `src/lib/safe-error-log.ts` — `logSafeError(label, err)` replaces
  `console.error(label, err)` in user-text routes. Hand-shapes the
  log payload to `{kind, message, status?}` so Vercel function logs
  never get the err object's transitive properties (SDK errors
  sometimes serialise the request body into their own subclasses).
  Use it in any new route that handles user content.

**Behaviours that violate the position (don't ship):**
- A surface that aggregates customer strings into a profile, score,
  or "intent signal" product, even if anonymised.
- Telemetry that goes beyond {monthly check counts, crash reports}
  on how individual customers use ContentRX.
- A subprocessor added without updating the `/privacy` subprocessor
  table within 30 days.
- Removing or weakening any of the three guard files above without
  a new ADR superseding 2026-04-28.

**The contributeUpstream review surface** (when you build it). Today
no admin route reads `teamCustomExamples WHERE contributeUpstream =
true`. When that admin queue ships, the rules: per-entry display
only, never aggregated, never default-on, with a "this is the team's
own opt-in contribution" banner so the surface can't be mistaken for
implicit harvesting.

**The Anthropic ZDR commitment** (operational, not code). Customer
strings transit Anthropic's API. Anthropic's default 30-day API-log
retention is the largest gap the engineering layer can't close. ZDR
(zero data retention) is enabled at the account level via Anthropic
support. Don't claim "your strings never leave the request lifecycle"
in any user-facing copy until ZDR is confirmed live on the account.
