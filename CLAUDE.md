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

## Before every commit

- `npm run lint`
- `npm run build` (catches typecheck + build errors together)
- Run through the acceptance criteria from the current BUILD_PLAN session
