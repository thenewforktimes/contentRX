# ContentRX app — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

Next.js 15 App Router app deployed to Vercel. Backend for the ContentRX
Figma plugin, CLI, and GitHub Action. Landing page lives at `/`.

## Locked architectural decisions

- Framework: Next.js 15 App Router, TypeScript, Tailwind v4
- Auth: Clerk (do not consider alternatives)
- Database: Supabase Postgres (was Neon in BUILD_PLAN v1; swapped to
  Supabase because Robo already had the account — both are Postgres, so
  Drizzle and the schema are identical)
- Driver: `postgres` (postgres.js) + `drizzle-orm/postgres-js`
- Billing: Stripe Checkout + Customer Portal + webhooks (no custom UI)
- Rate limiting: Upstash Redis
- Email: Resend
- Errors: Sentry
- Analytics: Plausible
- Evaluation engine: Python (invoked via Vercel runtime) — do NOT port to TS
- Charts: Recharts
- No component libraries. Tailwind only.

## Database schema

Source of truth: `src/db/schema.ts`. Seven tables: `users`, `usage`,
`subscriptions`, `team_members`, `team_rules`, `violations`,
`ditto_syncs`. Always use Drizzle — never raw SQL. Schema pushes run via
`npm run db:push` (wraps `drizzle-kit push` with `.env.local` loaded).

The `db` client in `src/db/index.ts` is **lazy-initialized via
`getDb()`**, not a module-level export. This avoids throwing at build
time when `DATABASE_URL` is not yet provisioned, and it avoids the
`Proxy`-wrapper pitfall that breaks auth adapters.

## API route conventions

- All routes under `src/app/api/`
- Auth check at the top of every handler (Clerk's `auth()` is **async** in v7)
- Return types: JSON, standard error shapes
- Always validate input with zod
- Never log PII; violations table stores sha256 hashes only

## /api/check request flow (locked)

1. Auth via Clerk session OR `Authorization: Bearer cx_...` API key
2. Load team rules (only matters when user is on Team plan)
3. Check monthly quota — 402 if exhausted
4. Rate limit check — 429 if exceeded (60/min per user, sliding window)
5. Call `/api/evaluate` (Python) with `text`, `content_type`, `audience`, `moment`
6. Apply team's disabled-rule filter (post-processing; full merge ships in Session 16)
7. Log each violation into `violations` table with sha256 of text
8. Increment `usage` counter for the current month
9. Return result + usage metadata

## Python engine

The evaluation pipeline lives in `python/content_checker/` as a **vendored copy** of
the engine repo. `api/evaluate.py` is a Vercel Python function that imports from
there. The TS `/api/check` calls the Python function over internal HTTP via
`src/lib/evaluate.ts`.

**Sync policy:** the vendored copy is manually synced from the engine repo
(`contentRX` on GitHub) until Session 7 publishes `contentrx-cli` to PyPI.
After Session 7, switch `api/requirements.txt` to `contentrx-cli>=X.Y.Z` and
delete `python/content_checker/`. Do not edit the vendored copy in place —
fix it upstream and re-sync.

**Internal secret:** `/api/evaluate` checks `x-internal-secret` against
`INTERNAL_EVAL_SECRET`. Both runtimes read the same env var. Without this,
anyone on the internet could hit `/api/evaluate` directly and burn our
Anthropic budget.

## What not to do

- Don't add new dependencies without checking bundle size
- Don't port Python engine logic to TypeScript — call the Python runtime
- Don't build custom UI for billing — Stripe Portal handles everything
- Don't store plaintext strings in the `violations` table
- Don't add features not in BUILD_PLAN.md — scope creep kills the ship
- Don't commit `.env.local`; commit `.env.local.example` instead
- Don't wrap the Drizzle `db` object in a JavaScript `Proxy` for lazy
  init — it silently breaks libraries that inspect adapter shape. Use
  the `getDb()` pattern that's already in place.
- Don't edit files under `python/content_checker/` directly — it's a
  vendored copy. Fix the upstream engine and re-sync.
- Don't expose `/api/evaluate` as a public surface; it's an internal
  helper guarded by `INTERNAL_EVAL_SECRET`. All real clients call
  `/api/check`.

## Running locally

1. Copy `.env.local.example` → `.env.local` and fill in the keys.
2. `npm install`
3. `npm run db:push` (after `DATABASE_URL` is set)
4. `npm run dev`

Environment variables required: see `.env.local.example`. The bootstrap
workflow once Vercel is linked:

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

## Known limitations (deferred audit findings)

Things the post-Session-3 audit flagged that we consciously chose NOT to
fix immediately. Track these so they don't get forgotten.

1. **API keys are stored plaintext on `users.api_key`.** Lookups via
   Drizzle's `eq(users.apiKey, apiKey)` on the unique b-tree index have
   a timing signal in theory — tree descent terminates on first ordering
   divergence. Over the public internet jitter dominates, but best
   practice is hash-storage: store `sha256(key)`, look up by hash.
   **Target:** Session 9 (dashboard key generation + rotation). Use
   `cuid2` for the key body; SHA-256 the stored form.

2. **`getCurrentUsage` → `incrementUsage` race.** A user can fire up to
   their rate-limit ceiling (60/min) of concurrent requests through the
   quota gate before any of them increment. On a free plan (25/mo) the
   overshoot is bounded. Correct fix is an atomic "claim a slot" upsert
   with a conditional `WHERE count < quota`. **Target:** Session 10
   when we add plugin-side quota UX.

3. **Webhook idempotency.** `svix.Webhook.verify` enforces a 5-minute
   timestamp tolerance but within that window the same payload can
   replay. `user.created` is protected by `onConflictDoNothing`;
   `user.updated` is a raw `.set({ email })` that can roll an email
   backwards. **Fix:** track `svix-id` in a dedupe table (or a Redis
   set) before processing. **Target:** whenever we harden against
   abuse, not blocking launch.

4. **No DB-level CHECK constraints on enum columns.** `text("plan", {
   enum: [...] })` and friends in `schema.ts` are TS-only. A direct SQL
   write can set `plan = 'enterprise'` and the app silently accepts it.
   Use `pgEnum` if DB-level protection matters. Low priority — we
   control every writer.

5. **`users.email` has no unique constraint.** Clerk prevents duplicate
   verified primary emails per instance, but allows unverified
   duplicates, and a `user.updated` webhook could collide. Decision
   deferred: do we want two Clerk accounts → one logical user, or
   reject the second at the webhook? Revisit when we have a team
   invite flow (Session 9) since email-based lookup starts mattering
   there.

6. **No unique constraint on `subscriptions.userId`.** Historical rows
   (upgrade, downgrade, re-sub) are legitimate. Proper fix is a partial
   unique index on `(user_id) WHERE status = 'active'`. **Target:**
   Session 8 when Stripe lands.

7. **`check_batch` has no aggregate size ceiling** (engine-side). A CLI
   caller can concatenate up to `MAX_BATCH_FILE_SIZE` worth of strings
   into a single consistency prompt. Cost DoS, not a security breach.
   **Target:** before CLI ships broadly (Session 11).

8. **Standards-library prompt-injection surface.** Engine's
   `build_system_prompt` embeds `content_type` and user text directly.
   `/api/check` now validates `content_type` against the 8-member enum
   from `engine-taxonomy.ts`, which closes the injection at this
   boundary. Engine-side hardening (sentinel delimiters around user
   text) is still worth doing when engine-level test coverage for it
   exists.

## Before every commit

- `npm run lint`
- `npm run build` (catches typecheck + build errors together)
- Run through the acceptance criteria from the current BUILD_PLAN session
