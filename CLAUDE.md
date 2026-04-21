# ContentRX — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

One repo, one directory, one push cycle. Ships four things that share
the same GitHub repo (`thenewforktimes/contentRX`) and the same working
tree:

1. **Python evaluation engine** — `src/content_checker/` (the library)
2. **Figma plugin** — `figma-plugin/`
3. **Python CLI** — `cli/`
4. **Next.js 15 backend app** — `src/app/`, `src/lib/`, `src/db/`,
   `src/middleware.ts`, `api/`, top-level `package.json` / `tsconfig.json`
   / `next.config.ts` / etc.

The Next.js app imports the Python engine at runtime via a Vercel Python
function (`api/evaluate.py`); no vendored copy, no sync script — the
engine source at `src/content_checker/` IS the source Vercel bundles
into the Python function (see `vercel.json` → `functions.includeFiles`).

Engine tests live in `tests/`. App tests will land next to the code
(`*.test.ts` / `__tests__/`) as they get written — `testpaths = ["tests"]`
in `pyproject.toml` keeps pytest scoped to the Python side.

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

Source of truth: `src/db/schema.ts`. Seven tables: `users`, `usage`,
`subscriptions`, `team_members`, `team_rules`, `violations`, `ditto_syncs`.
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
5. Call `/api/evaluate` (Python) with validated `text`, `content_type`,
   `audience`, `moment`
6. Apply team's disabled-rule filter (post-processing; full merge ships
   in Session 16)
7. Log each violation into `violations` table with `sha256(text)`
8. Increment `usage` counter for the current month
9. Return result + usage metadata

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
- Don't add features not in BUILD_PLAN.md — scope creep kills the ship.
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

## Known limitations (deferred audit findings)

Things the post-Session-3 audit flagged that we consciously chose NOT
to fix immediately. Track these so they don't get forgotten.

1. **API keys are stored plaintext on `users.api_key`.** Lookups via
   `eq(users.apiKey, apiKey)` on the unique b-tree index have a
   theoretical timing signal. Best practice is hash storage: store
   `sha256(key)`, look up by hash. **Target:** Session 9 (dashboard key
   generation + rotation). Use `cuid2` for the key body.

2. **`getCurrentUsage` → `incrementUsage` race.** A user can fire up to
   their rate-limit ceiling of concurrent requests through the quota
   gate before any of them increment. Correct fix is an atomic
   "claim a slot" upsert with a conditional `WHERE count < quota`.
   **Target:** Session 10.

3. **Webhook idempotency.** `svix.Webhook.verify` enforces a 5-min
   timestamp tolerance but within that window the same payload can
   replay. **Fix:** track `svix-id` in a dedupe table (or Redis set)
   before processing.

4. **No DB-level CHECK constraints on enum columns.** Drizzle's
   `text("plan", { enum: [...] })` is TS-only. Use `pgEnum` if DB-level
   protection matters. Low priority.

5. **`users.email` has no unique constraint.** Decision deferred:
   revisit when the team invite flow (Session 9) makes email-based
   lookup matter.

6. **No unique constraint on `subscriptions.userId`.** Historical rows
   are legitimate. Proper fix is a partial unique index on
   `(user_id) WHERE status = 'active'`. **Target:** Session 8.

7. **`check_batch` has no aggregate size ceiling** (engine-side).
   Cost DoS, not a security breach. **Target:** before CLI ships
   broadly (Session 11).

8. **Standards-library prompt-injection surface.** `/api/check`
   validates `content_type` and `moment` against `engine-taxonomy.ts`,
   closing the injection at this boundary. Engine-side hardening
   (sentinel delimiters around user text) is still worth doing when
   engine-level test coverage for it exists.

## Before every commit

- `python3 -m pytest tests/` — engine tests must stay green
- `npm run lint` — app linter
- `npm run build` — catches typecheck + Next.js build errors together
- Run through the acceptance criteria from the current BUILD_PLAN
  session
