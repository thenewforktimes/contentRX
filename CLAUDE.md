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
2. ~~**Figma plugin** — `figma-plugin/`~~ **REMOVED 2026-05-16** — Figma dropped as a surface (forced + affirmed); code retired in PR-A. Slot kept struck so the historical numbering below stays stable.
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
   `docs.contentrx.app` — but the public credibility surface is now
   `/accuracy` (with the calibration log + quarterly reports folded
   in as anchored sections), NOT a public taxonomy.
   See [decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md).)

The Next.js app imports the Python engine at runtime via a Vercel Python
function (`api/evaluate.py`); no vendored copy, no sync script — the
engine source at `src/content_checker/` IS the source Vercel bundles
into the Python function (see `vercel.json` → `functions.includeFiles`).

Engine tests live in `tests/`. App tests will land next to the code
(`*.test.ts` / `__tests__/`) as they get written — `testpaths = ["tests"]`
in `pyproject.toml` keeps pytest scoped to the Python side.

## Current positioning (locked by ADR 2026-04-25)

The taxonomy is **private**. The standards (49 as of 2026-05-07; the
canonical library is the source of truth — count grows as new
standards land), 13 moments, per-standard versioning,
`version_history`, the `influences` field, and the `rationale_chain`
detail are internal artifacts only. They live in
`src/content_checker/standards/standards_library.json` and the related
substrate modules; they are never rendered to product users.

The public surface — what customers and prospects actually see — is:

- `/accuracy` — measured system kappa with 95% CI, measured self-drift
  kappa with 95% CI, target ceiling stated separately. **Hand-maintained
  by Robert as a solo founder; not auto-generated.** Source artifact:
  `reports/accuracy/latest.json`. Hosts two anchored sections:
  - `#calibration-log` — weekly calibration log entries (kappa
    movement, drift signals, override count, refinement-log
    activity). The bare `/calibration` route 308s here. Source
    markdown: `reports/calibration/<YYYY-WW>.md`.
  - `#quarterly-reports` — quarterly accuracy reports.
    The bare `/reports` route 308s here. Source markdown:
    `reports/quarterly/<YYYY-Q>.md`. Rendered for the founder at
    `/admin/reports`.

The reports are **not automated**. Earlier rounds of this codebase
shipped nightly / weekly / quarterly generators + a staleness watchdog;
those were removed on 2026-05-11 because Robert maintains the artifacts
manually on his own time as a solo founder with a day job. The lib
loaders (`src/lib/accuracy-snapshot.server.ts`,
`src/lib/calibration-loader.server.ts`, `src/lib/admin-reports.server.ts`)
read the on-disk JSON/markdown as-is; if a file is stale, the loaders
say so in their fallback path. The `/accuracy` page is the source of
truth — keep it honest.

The substrate (private taxonomy + override stream + refinement log)
still produces the published artifacts through the founder's manual
workflow. Nothing outside `reports/` reads substrate. This separation
is the load-bearing architectural choice; the substrate-vs-report
contract is documented in `_private/architecture.md` (gitignored), and
[decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md)
records the rationale and rejected alternatives.

**The moat is operational, not architectural.** If the published
artifacts go stale, the moat decays in public — Robert's cadence
discipline (and not any automated guard) is what keeps it fresh.

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
them; product users do not. There is **no allowed exception** (the
prior `/dashboard/rules` carve-out was retired 2026-05-16; see the
addendum to [decisions/2026-04-25-private-taxonomy-pivot.md](decisions/2026-04-25-private-taxonomy-pivot.md)).
The line, precisely: category names are public; **standard IDs,
standards prose, and correct/incorrect exemplars are private substrate
and never reach any user-facing surface.** Every check surface emits
the same human-relatable flags (issue / suggestion / severity /
category) and nothing beneath them — the weekly agent digest included.
`/dashboard/rules` already display-labels IDs; its residual
prose/exemplar exposure is audit finding F3, tracked with the
custom-rules UX cluster.

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
(preview-before-publish gate).
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
- 25 preprocessor checks, 49+ standards, 13 moments, 8 content types
  (standards count is dynamic — read from
  `src/content_checker/standards/private/standards_library.json`)
- Anthropic SDK for LLM calls; `api_utils.py` is the single LLM boundary
- Tests are structural (no live API calls) — see `tests/`
- Current version: `4.7.6` (source of truth: `src/content_checker/__init__.py`)

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
`customer_flagged_reviews`.
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
   `audience`, `moment`.
6. Apply team's disabled-rule filter + overrides + added rules.
7. Log each violation into `violations` table with `sha256(text)`.
8. Increment `usage` counter for the current month.
9. Return result + usage metadata.

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

5. ~~`users.email` has no unique constraint.~~ Resolved: the column
   has `.unique()` in `src/db/schema.ts`. Adding it didn't require
   the deferred decision — the team invite flow lookups assume one
   row per email anyway. Doc updated in the 2026-05-11 audit cleanup.

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

9. ~~**Figma plugin outbound `postMessage` target origin (PLG-H-01).**~~
   **RESOLVED 2026-05-16 by deletion.** The entire `figma-plugin/`
   was retired (Figma dropped as a surface, forced + affirmed — see
   the amendment under "Surfaces, in order of primacy"). No plugin
   `postMessage` surface exists, so PLG-H-01 and PLG-C-01 are moot.

## Before every commit

- `python3 -m pytest tests/` — engine tests must stay green
- `npm test` — web-app vitest suite (pure-logic tests for lib helpers); must stay green
- `npm run lint` — app linter
- `npm run build` — catches typecheck + Next.js build errors together
- Run through the acceptance criteria from the current BUILD_PLAN_v2
  session

---

## Surfaces, in order of primacy (BUILD_PLAN_v2)

> **AMENDMENT 2026-05-16 (forced — Figma killed paid Community
> plugins).** The Figma plugin is DROPPED as a surface entirely; the
> plugin can never ship. The locked canonical *customer-facing*
> surface list + order is now: **1) MCP  2) GitHub Action  3) CLI
> 4) LSP  5) ContentRX dashboard** ("GitHub Action" is the label,
> not bare "GitHub"; Dashboard is the no-install paste path).
> Marketing leads with this set (PR #588 + #589). The dead plugin
> code (`figma-plugin/`, `src/app/auth/figma{,-callback}/`,
> `lib/figma-handoff`, the Figma CORS-allowlist entry, the `plugin`
> source-enum value + its label fallbacks) was RETIRED 2026-05-16
> ("roots and all", Robert's explicit go). Figma is affirmatively
> dead: a future Figma policy reversal is NOT a reactivation
> trigger. The numbered list below is the original BUILD_PLAN_v2
> primacy framing, kept for history; item 5 is struck.

1. **MCP server** (Python, stdio, via `uvx contentrx-mcp`) — engineers in
   Claude Code / Cursor / Claude desktop. **Lands in v2 Phase 1.**
2. **LSP server** (Python, stdio, via `uvx contentrx-lsp`) — engineers
   typing in any LSP client. **Lands in v2 Phase 5.** Editor extensions
   in `editor-extensions/` consume this surface.
3. **GitHub Action** — engineers on PRs. (In-tree today; publishes to
   Marketplace in v2 Phase 2.)
4. **CLI** — engineers in terminals and CI. (`contentrx-cli` on PyPI.)
5. ~~**Figma plugin** — designers and PMs working in Figma.~~ **DROPPED 2026-05-16 (forced) — see amendment above.**
6. **Customer web dashboard** — `/dashboard` for paying customers (usage,
   API keys, team rules if/when teams ship).
7. **Founder `/admin` dashboard** — substrate UI for the daily review
   rhythm, accuracy snapshots, calibration log, refinement-log, and
   report publication gate. Single-user. **Critical-path post-pivot.**

The MCP server is the headline. The privacy boundary applies to the
developer-facing surfaces that render to product users (MCP, LSP,
GitHub Action, CLI) — they must never expose `standard_id` or
`rule_version`. The customer web dashboard and founder `/admin`
dashboard are allowed to render those fields under appropriate auth.

## Non-negotiables (additions per BUILD_PLAN_v2 + ADR 2026-04-25)

These join the existing rules in "What not to do" above. They apply to
every API change, every new surface, every code review going forward.

**From the original v2 plan (still live):**

- `schema_version` on every API response, semver'd. Currently `3.0.0`
  (post-metering-collapse, PR #342). Source of truth: `SCHEMA_VERSION`
  in `src/content_checker/models.py` and `src/lib/api-envelope.ts`.
- All LLM JSON parses go through `parse_llm_json` in `api_utils.py`. (Lands in v2 Session 3.)
- All Anthropic clients have `max_retries=2`. (Lands in v2 Session 3.)
- JS/Python parity is CI-gated; divergence blocks merge. (Lands in v2 Session 2.) **2026-05-16: the JS-preprocessor sub-gate (`tools/parity_check.py`, figma-plugin/ui.html vs Python) was RETIRED with the Figma plugin (#590) — no JS preprocessor exists anymore. The display-labels, humanize, and engine-taxonomy-mirror parity gates remain CI-blocking. This non-negotiable stands, narrowed in scope, not removed.**
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
  through Robert's manual founder workflow (no scheduled generators
  as of 2026-05-11; see "Current positioning" above). Nothing outside
  reads substrate.
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
  *overrides*, *team owner* not *admin*,
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
  `/api/violations/override`, `/api/violations/adjust`, and
  `/api/customer-flag`. Add a new public route that takes a string →
  wire the pre-screen too.
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

**The Flag-for-Review consent flow** (per ADR 2026-05-11). Customer
strings enter the calibration corpus only via the Flag-for-Review CTA
plus modal-consent confirmation. The `customer_flagged_reviews` table
is the only writer; the row's existence implies explicit per-row
consent. The customer-facing `/dashboard/shared` page lists every
shared string. Revocation runs by email to `privacy@contentrx.io` at
v1; the operator deletes the row and any downstream substrate.

**The Anthropic ZDR commitment** (operational, not code). Customer
strings transit Anthropic's API. Anthropic's default 30-day API-log
retention is the largest gap the engineering layer can't close. ZDR
(zero data retention) is enabled at the account level via Anthropic
support. Don't claim "your strings never leave the request lifecycle"
in any user-facing copy until ZDR is confirmed live on the account.

## Legal launch state (2026-05-12)

The legal artifacts for paid customers landed on this date. Five
surfaces are involved. Future sessions: read this section before
touching anything in `src/app/(marketing)/{privacy,terms,disclaimer,
waitlist}`, `src/middleware.ts`, `src/components/site-footer.tsx`,
`src/app/api/waitlist/`, `src/emails/waitlist-signup.tsx`, or
`public/legal/`.

### Entity

Operating entity is **ContentRX LLC** (California limited liability
company), formed via ZenBusiness on 2026-05-12. Registered agent
address: 2520 Venture Oaks Way, Suite 120, Sacramento, CA 95833.
This is the entity named on every public legal page and in customer
contracts. The earlier plan in the BUILD_PLAN was Abstract Nonsense
LLC (a pre-existing entity) operating as "ContentRX" via DBA; this
was pivoted on 2026-05-12 to a separate, dedicated LLC. Abstract
Nonsense LLC still exists but is not the ContentRX operator. Two
"Abstract Nonsense LLC" references remain in code, both in file
header comments (`src/components/site-footer.tsx`,
`src/app/(marketing)/terms/page.tsx`) as historical documentation
of the pivot — intentional, keep them.

The first Statement of Information (Form LLC-12) is due within 90
days of formation. Reminder target date: 2026-08-10. Filing fee $20
via `bizfileOnline.sos.ca.gov`.

### Public legal pages

- `/privacy` is **hand-crafted in voice** ("Path A" — see the
  2026-05-12 update note in the file header). Termageddon was used
  to drive the audit but its generated content is NOT embedded
  here; the existing voice work is the canonical text. 2026-05-12
  added four sections: CCPA category translations, sale/share
  statement, expanded data subject rights (portability, objection,
  withdrawal of consent, right to lodge a complaint with a
  supervisory authority), and "Regional availability" (names the
  geo-block scope, PIPEDA coverage for English Canada, deferred
  Article 27 representative slot). Voice rules in the file header
  are enforced.
- `/terms` is **Common Paper CSA v2.1 in voice** (CC BY 4.0).
  11 numbered sections covering: subscription agreement,
  acceptable use, AI output disclaimers and ownership,
  Flag-for-Review opt-in carve-out, no-training default, refunds
  and cancellation (cancel anytime, no pro-rated refunds), warranty
  disclaimer + 12-month liability cap, privacy + DPA reference,
  changes notice, California governing law (Sacramento County
  venue), entity disclosure (ContentRX LLC). Voice rules apply
  except where legal precision requires unavoidable structural
  exceptions (§7 warranty disclaimer's term-of-art phrasing).
- `/disclaimer` is a **Termageddon-embedded** auto-updating page.
  Two topics: not-legal-advice, testimonials. This is the one
  legal page where generic legal voice is accepted in exchange for
  auto-update value. Embed ID is held in a single
  `TERMAGEDDON_DISCLAIMER_ID` constant.
- `/waitlist` is a custom page that geo-blocked visitors are
  redirected to. Personalises message based on the `?region=`
  query param the middleware passes. Form posts to
  `/api/waitlist`. Marked `robots: { index: false }` so it doesn't
  surface in search.

### DPA artifact

`public/legal/dpa.pdf` is a 9-page Common Paper-derived starter
DPA. Generated by `scripts/generate_dpa.py` using reportlab —
re-run the script if entity details, subprocessor list, or
technical measures change. Header carries a prominent "starter
template, requires legal review for material reliance" warning
box. SCCs (Exhibit D) auto-incorporate when EU/UK access opens.
Referenced from `/terms` §8 as a downloadable PDF.

### Geo-block (`src/middleware.ts`)

Allowed countries: US + 6 territories (PR, VI, GU, AS, MP, UM) +
CA. Quebec is specifically blocked via region check
(`country === "CA" && region === "QC"`). All other countries
redirect to `/waitlist`. The check reads Vercel edge headers
(`x-vercel-ip-country`, `x-vercel-ip-country-region`) — Next.js
15 removed `req.geo`. Missing headers (local dev) no-op the check
so localhost works.

Always-allowed paths (no geo, no auth check): `/waitlist`,
`/api/waitlist`, `/privacy`, `/terms`, `/ethics`, `/disclaimer`,
`/security`, `/accuracy`, `/legal/*`, `/sign-in`. The matcher
also excludes `.pdf` so `public/legal/dpa.pdf` is served raw
without middleware running.

Authenticated visitors (Clerk session OR `Bearer cx_` API key)
bypass the geo-block entirely. Reasoning: existing customers can
travel; the geo-block exists to gate new signups from regions
that haven't been operationally cleared. API routes that are
blocked return 451 JSON; page routes return a 307 redirect to
`/waitlist?region=...`.

### Waitlist intake

`src/app/api/waitlist/route.ts` accepts POST `{email, region?}`,
validates with zod, and sends a Resend notification to
`FOUNDER_EMAIL` (falls back to `hello@contentrx.io`) using the
`WaitlistSignupEmail` template in `src/emails/waitlist-signup.tsx`.
Deduped per `(email, day)` via the existing Redis dedupe helper
in `src/lib/email.ts`. No DB write — replace with a proper
`waitlist_signups` table when volume justifies it.

### Termageddon state ($119/yr, active)

- **Embedded:** Disclaimer at `/disclaimer` (auto-updating).
- **Generated but NOT embedded:** Privacy Policy. Path A means
  the hand-crafted `/privacy` is canonical; Termageddon is a
  reference / compliance-alert service.
- **Toggles set:** all 50 state privacy laws + DC + territories
  YES, PIPEDA YES, GDPR NO, UK DPA NO, Quebec Law 25 NO, cookie
  consent not generated (cookieless analytics).
- If `/privacy` is ever switched to embed-driven, add Custom
  Clauses to Termageddon: Flag-for-Review carve-out, no-training
  default, Anthropic LLM disclosure. The hand-written canonical
  versions of those clauses live in
  `src/app/(marketing)/privacy/page.tsx`.

### Footer (`src/components/site-footer.tsx`)

Legal column now has three links: Terms of Service, Privacy
Policy, Disclaimer. Bottom-row entity disclosure: "© 2026
ContentRX LLC. A California limited liability company. ContentRX™
is a trademark of ContentRX LLC." Robert's personal name is no
longer in the footer; if a personal touch is needed it lives on
`/ethics` as a signed commitment.

### Outstanding launch-readiness work

Before paid customers land:

1. **Verify `privacy@contentrx.io` deliverability.** DNS/MX, send
   a test email from a non-ContentRX account, confirm receipt.
   This mailbox is the endpoint for GDPR/CCPA rights, DPA requests,
   Flag-for-Review revocation, and subprocessor inquiries.
2. **Verify Stripe Dashboard statement descriptor reads
   `CONTENTRX`**, not "Abstract Nonsense LLC" and not "ContentRX
   LLC". Settings → Public details. Descriptor max 22 chars.
3. **ContentRX LLC formation completes** (in flight via
   ZenBusiness, expected 2026-05-13). Then: get EIN from IRS, open
   dedicated bank account, re-onboard Stripe under the LLC name,
   update any vendors paying ContentRX-as-Robert today.
4. **1–2 hour attorney review** ($300–$800). Scope: AI clauses in
   `/terms` §3 + §5, IP allocation §3, Flag-for-Review carve-out
   §4 + matching modal copy in
   `src/components/flag-for-review.tsx`, entity disclosure §11,
   DPA at `/legal/dpa.pdf`. Andrew Bosin LLC or any Cooley GO
   startup lawyer.
5. **Rewrite the ZDR hedge in `/terms` §5 paragraph 3 and `/privacy`
   "Where the data lives".** ZDR pursuit was decided against on
   2026-05-12 (PM). Both surfaces currently say the ZDR posture is
   "in progress" — that's now misleading. Replace with a plain
   statement of the actual position: customer strings transit
   Anthropic's API and are subject to Anthropic's standard
   retention policy; ContentRX does not have a Zero Data Retention
   agreement with Anthropic. Also update the "Customer data —
   non-negotiables" section in this file (the subsection titled
   "The Anthropic ZDR commitment") so the policy statement matches
   the decision. Must land before paid signups open.
6. **Set `FOUNDER_EMAIL` env var in Vercel.** Currently falls back
   to `hello@contentrx.io`. Set explicitly to wherever waitlist
   notifications should land.
7. **File LLC-12 within 90 days of ContentRX LLC formation.** Set
   reminder for 2026-08-10. Subsequent SOIs are biennial.

Separate from launch but in the same problem space:

8. **File the overdue Abstract Nonsense LLC Statement of
   Information** ($20 + $250 late penalty). The SOS dashboard shows
   it 9 months overdue as of 2026-05-12. Doesn't affect ContentRX
   LLC's standing but the late-penalty meter is running.

### Triggers for future legal expansion

Don't act on these until the trigger fires:

- **First EU/UK customer signed:** appoint DataRep (€150/yr EU +
  £120/yr UK), flip GDPR + UK DPA YES in Termageddon, name the
  Article 27 rep in `/privacy` "Regional availability" section,
  remove EU/UK from the geo-block in `src/middleware.ts`.
- **First Quebec customer demand:** build a French-language
  privacy notice, designate a Quebec privacy officer, complete an
  automated-decision PIA covering Flag-for-Review, then remove
  the `country === "CA" && region === "QC"` check from the
  middleware.
- **First enterprise customer with DPA redlines:** budget
  $1,500–$3,000 for the first MSA negotiation; the redlined
  result becomes the reusable enterprise contract.
- **First $10K+ ARR customer or contract with stated liability
  cap >$50K:** add E&O/Cyber insurance ($500–$2,000/yr — Vouch,
  Coalition, or Embroker).
- **Raising a priced fundraise > $250K:** convert ContentRX LLC
  to a Delaware C-corp via statutory conversion (~$293 DE filing
  + $500–$2,500 attorney). Don't preemptively flip — wait for the
  fundraise calculus to change.
