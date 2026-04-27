# ContentRX — Claude Code instructions

**Read this file first. Every session. No exceptions.**

After this file, read [BUILD_PLAN_v2.md](BUILD_PLAN_v2.md) for the
current canonical build plan (v5.0.0). The historical v1 plan is at
[docs/build-plan-v1-archive.md](docs/build-plan-v1-archive.md).

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
- `/essays` — monthly named-expert essays in Robo's voice. Hand-written.
- `/reports` — quarterly accuracy reports. Generated scaffold, hand-edited
  narrative.

The substrate (private taxonomy + override stream + refinement log) produces
the report (public artifacts) through scheduled generators in `reports/`.
Nothing outside reads substrate. This separation is the load-bearing
architectural choice; see [ARCHITECTURE.md](ARCHITECTURE.md) for the
substrate-vs-report contract and [decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md)
for the rationale and rejected alternatives.

**The moat is operational, not architectural.** If the calibration log goes
stale for a quarter, the moat decays in public. The `reports/` module's
staleness monitoring is P0 infrastructure, not marketing nice-to-have.

## Wire format — schema_version 2.0.0

The public Violation envelope ships only `issue`, `suggestion`, `severity`,
and `confidence`. Top-level envelope carries `schema_version`, `verdict`,
`review_reason`, and `warnings`. Removed entirely from the public envelope:
`docs_url`, `related_standards`, `rationale_chain`. Stripped from
user-visible surfaces but retained in internal substrate API responses
(founder-auth only): `standard_id`, `rule_version`.

Sessions that expose `standard_id` or `rule_version` to a user-facing
surface — web app cards, MCP response payload, CLI output, Figma plugin
UI, GitHub Action PR comment text, LSP diagnostic messages, editor
extension UI — are wrong. Internal logging and the `/admin` dashboard see
them; product users do not.

The schema 2.0.0 cutover lands atomically (engine + all surfaces + snapshot
tests in one PR) since ContentRX has zero paying customers at the time of
the bump. No deprecation window; no email migration needed.

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
  because Robo had a Supabase account. Both are Postgres, Drizzle is
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

- `schema_version` on every API response, semver'd. (Lands in v2 Session 9.
  Bumps to `2.0.0` at the post-pivot atomic cutover.)
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
  See [BUILD_PLAN_v2.md](BUILD_PLAN_v2.md) for the deferred-section index.

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
