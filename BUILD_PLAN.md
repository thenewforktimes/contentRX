# ContentRX build plan: three-week ship

Target: public Figma plugin + paid Pro tier + Team tier with custom
rules + Ditto integration + open content model spec, all live within
21 days.

---

## ⚠️ BEFORE EVERY SESSION: READ CLAUDE.md

Every Claude Code session begins with `view /CLAUDE.md` in the relevant
repo. No exceptions. The file contains the locked architectural
decisions, naming conventions, and non-negotiables for this build.
Re-reading is cheap. Re-litigating stack choices at 10pm on Saturday is
not.

Each session's "Claude Code opener" below starts with this instruction
explicitly. Keep it there. If a session ever begins without CLAUDE.md
being read, stop and read it.

The CLAUDE.md template for each repo is in **Appendix E**. Copy it to
the repo root on day 1 and keep it updated as decisions evolve.

---

## What three weeks actually costs

70–100 focused hours. PTO plus a weekend push, or nights + weekends
across the full 21 days. No perfectionism. Hosted UI everywhere it
exists. Every architectural decision in this file is locked — do not
re-litigate.

Figma Community review is 3–7 days of uncontrollable wait time. The
plugin submission must land by end of day 3. Everything else flexes.

## Locked architectural decisions (do not re-litigate)

| Concern | Choice | Why |
|---|---|---|
| Backend framework | Next.js 15 App Router on Vercel | Best-documented stack for this shape; Claude Code handles it fluently |
| Database | Neon Postgres (serverless) | Free tier covers first 300 users; native Clerk + Drizzle integration |
| ORM | Drizzle | Lighter than Prisma; SQL-first; ships fast |
| Auth | Clerk | Hosted sign-in + Figma OAuth flow is a solved path; 10k MAU free |
| Billing | Stripe Checkout + Customer Portal + webhook | Zero custom billing UI |
| Rate limiting | Upstash Redis (Vercel integration) | Free tier covers launch |
| Transactional email | Resend | 3k/mo free; simple API |
| Errors | Sentry (free tier) | 5k events/mo is enough |
| Analytics (product) | Plausible ($9/mo) | No cookie banner needed |
| Charts (team analytics) | Recharts | Already in the ecosystem; React-native |
| JSX/TSX parser (GH Action) | @babel/parser + @babel/traverse | Standard; battle-tested |
| HTML parser (GH Action) | htmlparser2 | Fast, streaming, no DOM |
| Docs site | Nextra (Next.js docs) | Same stack as app; deploys to Vercel |
| Legal | Iubenda ($30/mo for ToS + PP) | Template-generated, lawyer-reviewed |
| Domain | contentrx.app (buy on day 1) | .com likely taken or expensive |
| Marketing site | Same Next.js app, `/` route | One repo, one deploy |

## Session structure

Each session is 3–6 hours of focused work. Stop when the acceptance
criteria pass, even if there's polish you want to add. Polish is v1.1.

Session format:
- **Objective** (one sentence)
- **Prereqs** (what must be done first)
- **Files** (exact paths)
- **Acceptance** (testable)
- **Claude Code opener** (paste to start the session)

---

## Week 1: engine cleanup + public plugin

### Session 1 — JS parity + patch queue (3 hrs)

**Objective.** Bring Figma plugin JS to Python parity; apply P1–P5 from
the 4/2 eval session; apply fix group 4 from APPLY_SESSION_FIXES.md;
bump version to 4.5.0 everywhere.

**Prereqs.** None. This is the build opener.

**Files modified.**
- `figma-plugin/ui.html` (apply JS_PARITY_v450.md in full)
- `src/content_checker/standards_library.json` (P1–P3 content_type_notes)
- `src/content_checker/filter.py` (P4 CON-02 nav label exemption)
- `src/content_checker/moments.py` (P5 PRF-03 browsing_discovery relax)
- `tests/test_moments_pipeline.py`, `test_v442_patches.py`,
  `test_v450_patches.py`, `test_filter.py` (fix group 4)
- `pyproject.toml` (version → 4.5.0)
- `src/content_checker/__init__.py` (add `__version__ = "4.5.0"`)

**Acceptance.**
- `python3 -m pytest tests/ -v` → all green (~1010+ tests)
- JS preprocessor check count = 24 (matches Python)
- Plugin LIBRARY_VERSION = 4.5.0
- Manually run one string through plugin and CLI — identical violations

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Read JS_PARITY_v450.md, APPLY_SESSION_FIXES.md, and
> eval_session_analysis_2026-04-02.md. Apply all patches in that order.
> Run pytest after each file group. Bump pyproject.toml and
> __init__.py to 4.5.0. Report the final test count and any skips.

---

### Session 2 — Backend scaffold (6 hrs)

**Objective.** Stand up the Next.js app with Neon + Drizzle + Clerk.
Deploy to Vercel. Create users, usage, subscriptions, team_members,
team_rules, violations, and ditto_syncs tables.

**Prereqs.** Domain purchased. Vercel, Neon, Clerk, Upstash, Resend,
Sentry, Stripe, and Iubenda accounts created. Anthropic API key with a
budget cap set.

**Files created.**
- New repo: `contentrx-app/` (separate from the engine repo)
- `contentrx-app/CLAUDE.md` (copy from Appendix E, app variant)
- `contentrx-app/package.json`, `tsconfig.json`, `next.config.ts`
- `contentrx-app/drizzle.config.ts`
- `contentrx-app/src/db/schema.ts`
- `contentrx-app/src/db/index.ts`
- `contentrx-app/.env.local` (Clerk, Neon, Anthropic, Upstash, Stripe,
  Resend, Sentry keys)
- `contentrx-app/src/app/layout.tsx` (Clerk provider + Sentry)
- `contentrx-app/src/app/page.tsx` (placeholder landing)
- `contentrx-app/src/middleware.ts` (Clerk protect routes)
- `contentrx-app/src/app/api/webhooks/clerk/route.ts` (create user row)

**Database schema (Drizzle, locked — full schema including week-3 needs).**
```typescript
users:         id (cuid), clerk_id (unique), email, plan ('free'|'pro'|'team'),
               team_owner_user_id (fk, nullable), api_key (unique, nullable),
               ditto_api_key_encrypted (nullable), created_at
usage:         id, user_id (fk), month (YYYY-MM), count, updated_at
               unique index on (user_id, month)
subscriptions: id, user_id (fk), stripe_customer_id, stripe_sub_id,
               status, plan, seats, current_period_end
team_members:  id, team_owner_user_id (fk), member_user_id (fk),
               role ('admin'|'member'), invited_at, accepted_at
team_rules:    id, team_owner_user_id (fk), standard_id, action
               ('disable'|'override'|'add'), rule_json (jsonb),
               created_at, updated_at
               unique index on (team_owner_user_id, standard_id, action)
violations:    id, user_id (fk), team_id (fk, nullable), created_at,
               content_type, moment, standard_id, severity,
               text_hash (sha256, no plaintext stored),
               source ('plugin'|'cli'|'action'|'ditto')
               index on (user_id, created_at), (team_id, created_at)
ditto_syncs:   id, user_id (fk), project_id, last_synced_at,
               last_status, created_at
```

**Note.** The `violations` table is logged for team analytics (week 3).
It never stores plaintext — only a hash of the evaluated string. This
is the privacy story for Team-tier customers.

**Acceptance.**
- `npm run dev` — app loads at localhost:3000
- Sign-up via Clerk creates a row in `users` table via webhook
- Deployed to Vercel, accessible at contentrx.app
- All 7 tables exist in Neon, verified via drizzle-studio

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Create a new Next.js 15 App Router project in ./contentrx-app with
> TypeScript, Tailwind, Clerk, Drizzle + Neon Postgres, Stripe
> (skeleton only), Upstash Redis, Resend, and Sentry. Use the full
> schema in BUILD_PLAN.md session 2 — all 7 tables. Wire the Clerk
> webhook to create a user row on signup. Deploy to Vercel and confirm
> the webhook fires on first signup. Copy the CLAUDE.md template from
> BUILD_PLAN Appendix E (app variant) to the repo root.

---

### Session 3 — API proxy + rate limiting + violation logging (5 hrs)

**Objective.** Ship `/api/check` that authenticates the caller, enforces
the monthly quota, merges team_rules into the evaluation, forwards to
Anthropic, increments usage, and logs violations.

**Prereqs.** Session 2 deployed.

**Files created.**
- `contentrx-app/src/app/api/check/route.ts`
- `contentrx-app/src/lib/auth.ts` (Clerk session OR API key lookup)
- `contentrx-app/src/lib/ratelimit.ts` (Upstash fixed-window, per-user)
- `contentrx-app/src/lib/usage.ts` (increment + quota check)
- `contentrx-app/src/lib/quotas.ts` (plan → monthly limit map)
- `contentrx-app/src/lib/evaluate.ts` (invoke Python via Vercel Python runtime)
- `contentrx-app/src/lib/team-rules.ts` (load + merge team rules)
- `contentrx-app/src/lib/log-violations.ts` (hash string, insert rows)
- `contentrx-app/python/` (copy of the Python engine, invoked by runtime)

**Quota map (locked).**
```typescript
free: 25/month
pro: 5000/month (effectively unlimited for individual use)
team: 5000/seat/month
```

**Request flow (locked).**
1. Auth (Clerk session OR `CONTENTRX_API_KEY` header)
2. Load user's team + team_rules (if on Team plan)
3. Check quota; return 402 if exhausted
4. Rate-limit check (per-user, 60/min)
5. Run evaluation with merged standard library (base + team_rules)
6. Log violations to `violations` table (hashed)
7. Increment usage counter
8. Return result

**Acceptance.**
- Authenticated request with quota remaining: returns evaluation
- Authenticated request over quota: returns 402 with upgrade URL
- Unauthenticated request: returns 401
- Team-plan user with a disabled rule: that rule doesn't fire
- Violation rows appear in `violations` table after each check
- Rate limit triggers on rapid requests

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Build /api/check endpoint per BUILD_PLAN session 3. Accept either a
> Clerk session token (web/plugin) or a CONTENTRX_API_KEY header (CLI).
> Use Vercel Python runtime to call the existing pipeline.py directly
> — do NOT port Python logic to TypeScript. Copy the engine source
> into contentrx-app/python/ and invoke via the Python runtime.
> Merge team_rules before evaluation. Log every violation to the
> violations table with a sha256 hash of the input string. Return
> results in the same shape the current ui.html expects.

---

### Session 4 — Figma plugin auth + backend swap (4 hrs)

**Objective.** Replace direct Anthropic calls in the plugin with calls
to `/api/check`. Add Clerk auth flow via `figma.openExternal` and
clientStorage token.

**Prereqs.** Sessions 1–3 complete.

**Files modified.**
- `figma-plugin/ui.html` (replace callAnthropicAPI; add auth flow)
- `figma-plugin/code.js` (handle auth-complete message)
- `figma-plugin/manifest.json` (add `networkAccess` for contentrx.app)

**Files created.**
- `contentrx-app/src/app/auth/figma/route.ts` (Clerk sign-in + token back)
- `contentrx-app/src/app/auth/figma-callback/page.tsx`

**Auth flow (locked).**
1. Plugin checks clientStorage for `cx_token`
2. Missing → render "Sign in" button → `figma.openExternal(contentrx.app/auth/figma?plugin=1)`
3. User signs in via Clerk → callback page posts token to plugin via
   `postMessage` (polling fallback if popup blocked)
4. Plugin stores `cx_token` in clientStorage, swaps UI to signed-in state
5. All `/api/check` calls include `Authorization: Bearer <cx_token>`

**Acceptance.**
- Fresh install → sign-in button → external browser → Clerk flow → back in plugin, authenticated
- Evaluations call backend, not Anthropic directly
- Sign-out clears token, returns to signed-in state
- Quota displayed in UI: "12 of 25 this month"

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> In figma-plugin/ui.html, replace every direct Anthropic API call
> with a call to https://contentrx.app/api/check. Add a sign-in flow
> using figma.openExternal per the spec in BUILD_PLAN session 4. Keep
> the existing UI layout; just swap the network layer. Add a quota
> indicator below the results panel.

---

### Session 5 — Landing page + legal (4 hrs)

**Objective.** One-page marketing site with the positioning statement,
pricing, and a Figma install CTA. Iubenda ToS and Privacy Policy live.

**Prereqs.** Session 2 deployed. Domain DNS pointed at Vercel.

**Files modified/created.**
- `contentrx-app/src/app/page.tsx` (full marketing page)
- `contentrx-app/src/app/pricing/page.tsx`
- `contentrx-app/src/app/legal/terms/page.tsx` (Iubenda embed)
- `contentrx-app/src/app/legal/privacy/page.tsx` (Iubenda embed)

**Page structure (locked — do not redesign).**
1. **Hero.** Positioning statement from strategy memo, verbatim. Primary
   CTA: "Install for Figma" → plugin URL (placeholder until Figma approves).
2. **30-second demo video.** Loom embed, unlisted, re-record later.
3. **How it works.** Three-step: write copy → select in Figma → see violations with citations.
4. **What makes it different.** Three cards: moment-aware, rule-cited, runs in Figma + code.
5. **Pricing.** Four tiers per strategy memo. "Contact us" for Enterprise.
6. **Email capture.** Resend-backed, "get the launch announcement."
7. **Footer.** Terms, Privacy, Twitter, GitHub (content model repo).

**Acceptance.**
- Page loads in under 1s on 4G
- All CTAs wired (install is a placeholder link until Figma approves)
- Email capture adds to Resend audience
- Legal pages render Iubenda content

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Build the landing page per BUILD_PLAN session 5. Use Tailwind only,
> no component library. Copy is locked — use the positioning statement
> from the strategy memo verbatim. Do not redesign the page structure.
> Stop when all six sections render correctly and CTAs work.

---

### Session 6 — Figma Community submission (3 hrs)

**Objective.** Submit plugin for Figma Community review. Must happen by
end of day 3 to allow for review time.

**Prereqs.** Sessions 1 and 4 complete. Plugin works end-to-end on staging.

**Deliverables.**
- 5 plugin screenshots (1920×1080) showing: before, selecting, results panel with violations, results panel with pass, settings
- 30-second screen-recording demo (Loom → download → edit in iMovie → export as mp4)
- Plugin description (150 words, sentence case, positioning statement as lede)
- Plugin tagline (65 chars max)
- Tags: `content`, `writing`, `ux-writing`, `accessibility`, `linting`
- Privacy policy URL (Iubenda from Session 5)
- Support contact (hello@contentrx.app — set up in Resend)

**Acceptance.**
- Submitted via Figma Community publish flow
- "In review" status confirmed in Figma dashboard
- Calendar reminder set for day 10 to follow up if not approved

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> N/A — this is a human-in-the-loop submission session. Claude Code
> can help draft the description and check screenshot sizing but
> cannot submit.

---

### Session 7 — CLI to PyPI + open content model repo (4 hrs)

**Objective.** Publish `pip install contentrx-cli` and the public
content model spec repo.

**Prereqs.** Session 1 complete. PyPI account with 2FA. GitHub account.

**Files created/modified.**
- `cli/pyproject.toml` (entry point: `contentrx = cli.main:main`)
- `cli/cli/main.py` (already exists; add CONTENTRX_API_KEY env handling)
- `cli/README.md` (install, auth, usage, CI examples)
- `cli/LICENSE` (MIT)
- `cli/CLAUDE.md` (copy from Appendix E, CLI variant)
- New public repo: `contentrx-standards/`
  - `README.md` (taxonomy overview, versioning policy, contribution)
  - `standards/standards_library.json` (symlink/copy from engine)
  - `docs/moments.md` (the 13 moments with descriptions)
  - `docs/standards.md` (all 47 standards with rationale + examples)
  - `CHANGELOG.md` (v4.5.0 release notes)
  - `LICENSE` (MIT)
  - `CLAUDE.md` (copy from Appendix E, standards variant)

**Acceptance.**
- `pip install contentrx-cli` works from a clean venv
- `contentrx --help` shows usage
- `CONTENTRX_API_KEY=xxx contentrx "Click here"` hits backend, returns violations
- GitHub repo is public, has a description, has a pinned tweet-ready README

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Package the existing CLI as a pip-installable module per BUILD_PLAN
> session 7. Publish to PyPI under the name contentrx-cli. Create the
> contentrx-standards GitHub repo with the standards library and docs
> extracted from the JSON schema. README must explain the taxonomy
> and invite contributions. Do not include the Python engine source
> in the standards repo.

---

## Week 2: monetization + team tier foundation

### Session 8 — Stripe Checkout + webhooks (5 hrs)

**Objective.** Paid signup end-to-end. User clicks Upgrade → Stripe
Checkout → returns signed in with Pro or Team plan active.

**Prereqs.** Sessions 2–3 complete. Stripe account with products created.

**Stripe products (create in dashboard first).**
- Pro Monthly: $24/mo
- Pro Annual: $18/mo billed yearly ($216/yr)
- Team Monthly: $35/seat/mo, 3-seat min
- Team Annual: $29/seat/mo billed yearly, 3-seat min

**Files created.**
- `contentrx-app/src/app/api/checkout/route.ts` (create Checkout session)
- `contentrx-app/src/app/api/portal/route.ts` (Customer Portal session)
- `contentrx-app/src/app/api/webhooks/stripe/route.ts`
- `contentrx-app/src/lib/stripe.ts`

**Webhook events handled (locked).**
- `checkout.session.completed` → create subscription row, set user.plan
- `customer.subscription.updated` → update plan, seats, period_end
- `customer.subscription.deleted` → downgrade user.plan to 'free'
- `invoice.payment_failed` → email user, keep plan until period_end

**Acceptance.**
- Test mode: upgrade Pro → Stripe Checkout → redirect back → user.plan = 'pro'
- Test mode: upgrade Team 5 seats → subscription row shows seats=5, plan='team'
- Cancel via Customer Portal → webhook fires → user downgraded at period end
- Quota jumps from 25 → 5000 on upgrade

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Wire Stripe Checkout and Customer Portal per BUILD_PLAN session 8.
> Use Stripe's official webhook signature verification. Test every
> event type in Stripe test mode before marking done. The Checkout
> success URL returns to /dashboard?upgraded=1.

---

### Session 9 — Dashboard + team membership UX (4 hrs)

**Objective.** Signed-in dashboard: plan, usage, API key, manage
subscription, team members.

**Prereqs.** Session 8 complete.

**Files created.**
- `contentrx-app/src/app/dashboard/page.tsx`
- `contentrx-app/src/app/dashboard/api-key/route.ts` (rotate key)
- `contentrx-app/src/app/dashboard/team/page.tsx` (gated on plan=team)
- `contentrx-app/src/app/dashboard/team/invite/route.ts`
- `contentrx-app/src/app/team/accept/[token]/page.tsx` (invite acceptance)

**Page sections (locked).**
1. Current plan + usage bar (X of Y this month, resets on date)
2. "Upgrade" button (free) or "Manage subscription" (paid → Portal)
3. API key block: masked, copy button, rotate button
4. Team members table (Team plan only): invite by email, remove, role
5. "Connect Ditto" placeholder (live after Session 18)

**Acceptance.**
- All five sections render correctly per plan
- Rotating API key invalidates old one immediately
- Team invite sends an email via Resend with a signed token
- Accepting an invite joins the team and consumes a seat
- Invite acceptance fails cleanly if seats are full

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Build the /dashboard page per BUILD_PLAN session 9. Keep it boring.
> Use Tailwind, no component library. Stripe Customer Portal handles
> all billing UI — your page just links to it. Team invite emails use
> Resend; token signing uses jose (already in Next.js ecosystem).

---

### Session 10 — Quota enforcement in plugin (2 hrs)

**Objective.** Plugin UX around quota: progress bar, warning at 20, hard
block at 25 with upgrade CTA.

**Prereqs.** Sessions 4 and 8 complete.

**Files modified.**
- `figma-plugin/ui.html` (quota component + paywall modal)

**UX states (locked).**
- 0–19 used: show small counter "12 of 25 this month"
- 20–24 used: show amber banner "Approaching limit — upgrade for 5,000/mo"
- 25 used: hard-block evaluate button, show modal "You've hit your free
  limit. Upgrade to keep going." → opens contentrx.app/pricing in browser

**Acceptance.**
- All three states render on staging with a test account
- Upgrade CTA opens Stripe Checkout directly (query param: `plan=pro`)

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Add quota UX to figma-plugin/ui.html per BUILD_PLAN session 10. Do
> not add client-side quota math — rely on the backend's quota
> response. Show warning and block states based on API response
> fields.

---

### Session 11 — CLI API key auth (2 hrs)

**Objective.** CLI authenticates with a dashboard-generated API key.

**Prereqs.** Sessions 7 and 9 complete.

**Files modified.**
- `cli/cli/main.py` (CONTENTRX_API_KEY → Authorization header)
- `cli/README.md` (add auth section)

**Acceptance.**
- `CONTENTRX_API_KEY=xxx contentrx "Click here"` hits backend
- Missing key prints helpful error with dashboard URL
- Invalid key returns 401 with clear message

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Add CONTENTRX_API_KEY authentication to the CLI per BUILD_PLAN
> session 11. Keep the CLI interface unchanged — only the auth layer
> is new. Update README with the auth instructions.

---

### Session 12 — GitHub Action v1 with regex extraction (4 hrs)

**Objective.** Ship a working GitHub Action that runs the CLI against
changed files in a PR and comments with violations. Regex extraction
for now; AST upgrade in Session 15.

**Prereqs.** Session 11 complete.

**Files created.**
- New public repo: `contentrx-action/`
  - `action.yml`
  - `Dockerfile` (python:3.11-slim + contentrx-cli)
  - `entrypoint.sh`
  - `src/extract.py` (regex-based string extraction — placeholder)
  - `src/report.py` (format PR comment)
  - `README.md`
  - `CLAUDE.md`

**Action behavior (v1).**
- Triggers on pull_request with path filter `**/*.{tsx,jsx,html}`
- Extracts strings via regex (JSXText between tags, string literals in specific attrs)
- Runs `contentrx --json` on each string
- Posts a single PR comment with violations grouped by file
- Fails the check only if `strict: true` in action input

**Action inputs (locked).**
```yaml
inputs:
  api-key:
    description: ContentRX API key
    required: true
  strict:
    description: Fail the PR on violations
    default: 'false'
  content-type:
    description: Default content type
    default: 'short_ui_copy'
  paths:
    description: Glob for files to check
    default: '**/*.{tsx,jsx,html}'
```

**Acceptance.**
- Published to GitHub Marketplace in draft mode
- Test repo PR → action runs → comment appears with 3+ violations
- `strict: true` fails the check

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Package a GitHub Action per BUILD_PLAN session 12. Use a Dockerfile
> that pip-installs contentrx-cli. Regex extraction only in this
> session — Session 15 upgrades to AST. Publish to Marketplace in
> draft mode.

---

### Session 13 — Launch prep 1: email, analytics, transactional (3 hrs)

**Objective.** Wire every non-launch-day piece: transactional email
flows, analytics events, error alerting, support inbox.

**Prereqs.** All week 1 and week 2 sessions complete.

**Deliverables.**
- Transactional emails (Resend templates):
  - Welcome email on signup
  - Quota warning at 20/25 used
  - Quota exhausted
  - Subscription confirmation
  - Team invite
  - Invite accepted (to inviter)
- Plausible installed, goal events set (signup, upgrade, plugin_install, cli_install, github_action_install)
- Sentry alerts wired to Robo's email (errors + performance)
- `hello@contentrx.app` forwarding to Robo's real inbox (Resend domain setup)
- Stripe in live mode, not test mode

**Acceptance.**
- Dry-run: sign up with a new email, confirm welcome email arrives
- Dry-run: trigger a 500 error, confirm Sentry email
- Dry-run: complete a Stripe Checkout in live mode, confirm subscription email

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Wire all transactional email flows, analytics events, and error
> alerting per BUILD_PLAN session 13. Use Resend for all email. Use
> Plausible for analytics. Verify each dry-run acceptance criterion
> passes.

---

### Session 14 — Launch prep 2: content, video, HN draft (3 hrs)

**Objective.** Every launch artifact drafted and queued.

**Prereqs.** Session 13 complete.

**Deliverables.**
- Re-recorded demo video (2 min, shows Free + Pro + Team features)
- "Show HN: ContentRX — a content-design linter for Figma and code" draft
- Product Hunt listing queued
- Twitter thread (8 tweets) drafted
- LinkedIn post drafted
- Email to personal network (content designers Robo knows), BCC list
- Blog post: "Why I built ContentRX (three-week retrospective)"

**Acceptance.**
- Every artifact reviewed once and saved in /launch folder
- Show HN opener has been read aloud — if it doesn't sound natural, rewrite

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Not a coding session. Draft all launch copy per BUILD_PLAN session
> 14. The Show HN title and first paragraph matter most. Reference
> the strategy memo's positioning statement.

---

## Week 3: team tier completion + Ditto + spec + launch

### Session 15 — GitHub Action v2: AST extraction (5 hrs)

**Objective.** Replace regex extraction with proper AST parsing.

**Prereqs.** Session 12 complete.

**Files modified.**
- `contentrx-action/src/extract.py` → replaced with Node script
- `contentrx-action/Dockerfile` (add Node.js)
- `contentrx-action/src/extract.mjs` (new — Babel parser)
- `contentrx-action/entrypoint.sh` (invoke Node then Python)

**Extraction rules (locked).**

For JSX/TSX via `@babel/parser` + `@babel/traverse`:
- `JSXText` nodes with length > 3, not whitespace-only
- String literals in JSX attributes: `alt`, `aria-label`, `placeholder`,
  `title`, `label`, `description`, `helperText`, `errorMessage`, `children`
- Template literals in JSX expressions (static parts only)
- Skip: strings matching URL, path, CSS class, identifier patterns

For HTML via `htmlparser2`:
- Text nodes between tags
- Attribute values for same attribute set as JSX

Each extracted string carries a source location (file:line:column) that
flows through to the PR comment.

**Acceptance.**
- Test file with 10 strings in various JSX contexts: all 10 extracted
- Test file with CSS classes and URLs in string form: none flagged as content
- Existing regex-based tests still pass (reuse test fixtures)
- PR comment now includes file:line for each violation

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Upgrade contentrx-action to AST-based extraction per BUILD_PLAN
> session 15. Use @babel/parser + @babel/traverse for JSX/TSX and
> htmlparser2 for HTML. Write a Node.js extractor that emits
> JSON-lines to stdin for the Python CLI. Source locations must flow
> through to the PR comment.

---

### Session 16 — Custom team rules (6 hrs)

**Objective.** Team-plan admins can disable, override, or add custom
rules for their team. The pipeline honors team_rules when evaluating.

**Prereqs.** Sessions 3 and 9 complete.

**Files created.**
- `contentrx-app/src/app/dashboard/team/rules/page.tsx`
- `contentrx-app/src/app/dashboard/team/rules/[id]/page.tsx` (edit)
- `contentrx-app/src/app/api/team-rules/route.ts` (list, create)
- `contentrx-app/src/app/api/team-rules/[id]/route.ts` (update, delete)
- `contentrx-app/src/lib/team-rules.ts` (already stub from session 3;
  now fleshed out)

**Rule action types (locked).**
- `disable` — standard_id never fires for this team
- `override` — replace rule text, severity, or both for an existing standard
- `add` — new custom standard; must have unique ID like `TEAM-01`,
  `TEAM-02`, etc.

**Rule authoring UX.**
- List view: all 47 standard library rules, each with toggle + override indicator
- Add custom: form with ID (auto-assigned TEAM-NN), title, rule text, severity, content types, moment weights
- Preview: paste a string, see how it evaluates against current team rules

**Pipeline changes.**
- `/api/check` loads team_rules once per team per request
- Rules merge with standard library BEFORE preprocessing
- Merged library passed to Python engine as JSON
- `disable` actions produce a filter set
- `override` actions replace the matching standard
- `add` actions append to the library

**Acceptance.**
- Admin disables GRM-03 (exclamation marks) for their team
- Team member runs plugin against "Welcome!" — no violation
- Admin adds TEAM-01 (e.g., "never use the word 'revolutionary'")
- Team member runs plugin against "A revolutionary new feature" — violation
  with TEAM-01 cited
- Non-admin team member cannot edit rules (gated UI)

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Build custom team rules per BUILD_PLAN session 16. This is the
> biggest feature in week 3 — pace yourself. Start with the backend
> (team_rules CRUD + pipeline merge), then the admin UI. Use the
> existing engine's JSON schema for standards — team rules mirror it
> exactly with an extra `action` field. Do not allow non-admin team
> members to modify rules.

---

### Session 17 — Team analytics dashboard (4 hrs)

**Objective.** Team-plan admins see violation trends, top standards
violated, and team activity over time.

**Prereqs.** Session 16 complete. `violations` table has been logging
for at least a week of activity (or seed test data).

**Files created.**
- `contentrx-app/src/app/dashboard/team/analytics/page.tsx`
- `contentrx-app/src/app/api/team-analytics/route.ts`

**Dashboard panels (locked).**
1. **Usage this period.** Total evaluations, total violations, violation
   rate (percentage).
2. **Violations by standard.** Horizontal bar chart, top 10 standards
   most violated in last 30 days. Recharts BarChart.
3. **Violations over time.** Line chart, daily violations for last 30
   days. Recharts LineChart.
4. **Top files.** Table of file paths with most violations (from
   source='action' entries).
5. **Member activity.** Table of team members with their eval counts.

**Data model.**
- All queries scoped to `team_id` matching the admin's team
- Time window: default 30 days, selector for 7/30/90
- Aggregations run server-side via Drizzle

**Acceptance.**
- Admin loads /dashboard/team/analytics → all 5 panels render
- Empty team (no violations logged): panels show "No data yet" states
- Date range selector changes data
- Non-admin team member: 403

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Build team analytics per BUILD_PLAN session 17. Use Recharts. All
> queries hit the violations table, scoped to team_id. Do not query
> external services — this is pure Drizzle + Postgres. Implement
> empty states for every panel.

---

### Session 18 — Ditto API integration (5 hrs)

**Objective.** Users enter a Ditto API key. ContentRX fetches strings
from Ditto projects and evaluates them with moment-aware rules.

**Prereqs.** Session 9 complete. Ditto developer account with API access.

**Files created.**
- `contentrx-app/src/app/dashboard/integrations/ditto/page.tsx`
- `contentrx-app/src/app/api/integrations/ditto/connect/route.ts`
- `contentrx-app/src/app/api/integrations/ditto/sync/route.ts`
- `contentrx-app/src/app/dashboard/integrations/ditto/report/[id]/page.tsx`
- `contentrx-app/src/lib/ditto.ts` (API client)

**Integration UX (locked).**
1. `/dashboard/integrations/ditto` — connect screen
2. User pastes Ditto API key
3. ContentRX tests connection, lists projects
4. User selects projects to sync
5. "Run evaluation" button — fetches strings, evaluates, displays report
6. Report shows: total strings, violations by standard, violations by
   moment, exportable CSV

**Scope for v1 (locked).**
- One-way read from Ditto (no write-back)
- Manual sync only (no scheduled)
- Ditto API key stored encrypted at rest (AES-256; key from Vercel KV)

**Acceptance.**
- Connect a real Ditto account, list projects successfully
- Run eval on a project with 50+ strings, report renders
- API key is never logged; only decrypted in memory during sync
- Disconnect removes the key from DB

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Build the Ditto integration per BUILD_PLAN session 18. v1 scope is
> read-only manual sync — no write-back, no scheduling. Encrypt the
> Ditto API key at rest using AES-256 with a key from Vercel KV.
> Report UI uses the same Recharts components as team analytics.

---

### Session 19 — Content model spec site + whitepaper (4 hrs)

**Objective.** Nextra docs site at docs.contentrx.app that documents
the content model as an executable spec. Whitepaper PDF linked.

**Prereqs.** Session 7 complete.

**Files created.**
- `contentrx-docs/` (new repo, Nextra-based)
  - `pages/index.mdx` (overview)
  - `pages/spec/_meta.json`
  - `pages/spec/v4.5.0.mdx` (versioned spec page)
  - `pages/spec/moments.mdx` (each moment detailed)
  - `pages/spec/standards.mdx` (each standard detailed)
  - `pages/spec/content-types.mdx`
  - `pages/whitepaper.mdx` (or linked PDF)
  - `pages/contributing.mdx`
  - `theme.config.tsx`
  - `CLAUDE.md`

**Content requirements.**
- Every moment: description, when-to-use, 2 pass examples, 2 fail
  examples, related standards
- Every standard: rule text, rationale, 2 pass examples, 2 fail
  examples, related moments, severity
- Versioning policy: semantic versioning rules for the library
- Contribution guide: how to propose a new standard or moment

**Whitepaper (2–3 pages).**
- Why content types need moment awareness
- The 13 moments as universal UX primitives
- Case: how moment-aware evaluation catches context that general
  linting misses
- Reference: link to standards repo, GitHub Action, Figma plugin

**Acceptance.**
- Site deployed to docs.contentrx.app
- Every page renders; navigation works
- Whitepaper downloadable as PDF
- `pages/spec/v4.5.0.mdx` is the canonical spec; future versions get
  their own pages

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Build the Nextra docs site per BUILD_PLAN session 19. Pull content
> from standards_library.json and moments.py to generate the spec
> pages — do not hand-write them. Use a build script that regenerates
> the MDX from the engine JSON. Whitepaper is hand-written in MDX.

---

### Session 20 — Launch prep 3: final QA + messaging update (3 hrs)

**Objective.** Full regression test. Update launch copy to reflect the
expanded scope (Team tier with custom rules, Ditto integration, spec
site).

**Prereqs.** Sessions 15–19 complete.

**QA checklist (locked).**
- Free user full flow: sign up → install plugin → evaluate → hit quota → upgrade prompt
- Pro user full flow: sign up → upgrade → install plugin → 5000 quota → manage subscription
- Team user full flow: sign up → upgrade Team → invite 2 members → add a custom rule → evaluate → see analytics
- CLI full flow: install → auth → evaluate → check output format
- GH Action full flow: add to test repo → open PR → see comment
- Ditto flow: connect → sync → report
- Landing page loads in all three browsers (Chrome, Safari, Firefox)
- Stripe in live mode, one real $1 test transaction + refund

**Messaging updates.**
- Landing page: add "Custom team rules" and "Ditto integration" to
  differentiators section
- Pricing page: clarify Team tier now includes custom rules + analytics
  + Ditto
- Show HN post: mention the spec site and whitepaper as the "why this
  exists beyond a tool" story
- Twitter thread: add a tweet about the spec/whitepaper

**Acceptance.**
- Every checklist item passes
- Final launch artifacts saved in /launch
- Sleep before launch day

**Claude Code opener.**
> READ CLAUDE.md FIRST.
>
> Full regression QA per BUILD_PLAN session 20. Walk through every
> checklist item. Update launch copy to reflect week-3 additions. No
> new features — only QA and messaging.

---

### Session 21 — Launch day (4–8 hrs, calendar-dependent)

**Objective.** Ship. Respond to feedback. Patch crashers.

**Prereqs.** Everything above.

**Order of operations (locked).**
1. 06:00 PT — Post Show HN (sleepy HN front page is easier to land on)
2. 08:00 PT — Product Hunt goes live (scheduled previous day)
3. 09:00 PT — Twitter thread, LinkedIn post
4. 09:30 PT — Email to personal network
5. All day — triage HN comments, Twitter replies, signup errors
6. 18:00 PT — First-day metrics post-mortem

**Do not ship new code on launch day.** If something breaks, roll back.
If nothing breaks, ship fixes on day 22.

**Acceptance.** Anything north of 150 signups + 5 paid conversions is a
green launch (the bar is higher than the two-week plan because the scope
is higher). Below that, the post-mortem addresses distribution, not
product.

---

## Appendix A: what's IN (vs the original two-week plan)

The three-week plan adds back:

✓ AST-based string extraction in GitHub Action (session 15)
✓ Custom team rules with admin UI (session 16)
✓ Team analytics dashboard (session 17)
✓ Ditto API integration with encrypted key storage (session 18)
✓ Content model spec site + whitepaper (session 19)

Still deferred to v1.1+:
- MCP server (v2.0)
- Slack integration (never)
- VS Code extension (v1.2 — wraps the CLI)
- Write-back to Ditto (v1.1 — one-way for now)
- Audit log for team rule changes (v1.2)
- SSO / SAML (Enterprise, sold-before-built)
- Scheduled Ditto syncs (v1.1)
- Storybook integration (v1.3)
- i18n (month 6+)

## Appendix B: risk registry

| Risk | Likelihood | Mitigation |
|---|---|---|
| Figma review rejects plugin | Medium | Submit day 3. Have a fix window before launch day 21. |
| Stripe flags account for high-risk category | Low | Register as "business software." Include website screenshots in application. |
| Anthropic API costs blow past budget | Medium | Set $300 monthly cap on Anthropic console. Backend refuses requests if user-month spend exceeds cap. |
| Clerk webhook doesn't fire reliably | Low | Add idempotent "create user on first request" fallback in /api/check. |
| HN launch flops | Medium | Product Hunt + LinkedIn + personal network are parallel channels. Don't rely on HN. |
| Ditto API changes mid-build | Low | Ditto API is stable per their docs; pin to current version. |
| Custom team rules pipeline breaks engine | Medium | Session 16 includes regression testing. If rule merge breaks evaluation, fall back to base library and log the error. |
| Solo capacity misjudged | High | Sessions 15 (AST), 18 (Ditto), and 19 (docs) are the cuttable ones in week 3. Launch without them if slipping. |
| Launch day bug breaks signup | Low | Pre-launch QA (session 20). Sentry on call. Vercel instant rollback. |

## Appendix C: what to bring to each Claude Code session

1. **CLAUDE.md** at repo root (see Appendix E for templates) — read FIRST every session
2. The current session's "Claude Code opener" pasted as the first message
3. Acceptance criteria pasted as a checklist at session start
4. A 90-minute timer — if a session runs over 2× its estimate, stop and
   reread the scope
5. BUILD_PLAN.md open in a side tab for reference

## Appendix D: 30-day post-launch priorities

Not in scope for the three weeks but pre-decided:

- Week 4: Ship the top 3 user-requested fixes, publish "what I built in
  three weeks" retrospective, pitch Button 2026 speaker form
- Week 5: Ditto write-back (v1.1), Storybook integration spike
- Week 6: First design-system-team outbound — three targeted emails to
  design-system leads at fintech/healthtech companies with mature
  systems but thin content practice
- Week 7: Content model v4.6.0 release with community-contributed
  standards
- Week 8: VS Code extension spike (wraps the CLI)

---

## Appendix E: CLAUDE.md templates

Copy the relevant one to the root of each repo on day 1. Update as
decisions evolve. **Every Claude Code session reads this file first.**

### E.1 contentrx-app (Next.js app) CLAUDE.md

```markdown
# ContentRX app — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

Next.js 15 App Router app deployed to Vercel. Backend for the ContentRX
Figma plugin, CLI, and GitHub Action. Landing page lives at /.

## Locked architectural decisions

- Framework: Next.js 15 App Router, TypeScript, Tailwind
- Auth: Clerk (do not consider alternatives)
- Database: Neon Postgres + Drizzle ORM
- Billing: Stripe Checkout + Customer Portal + webhooks (no custom UI)
- Rate limiting: Upstash Redis
- Email: Resend
- Errors: Sentry
- Analytics: Plausible
- Evaluation engine: Python (via Vercel Python runtime) — do NOT port to TS
- Charts: Recharts
- No component libraries. Tailwind only.

## Database schema

Source of truth: `src/db/schema.ts`. Seven tables: users, usage,
subscriptions, team_members, team_rules, violations, ditto_syncs.
Always use Drizzle — never raw SQL. Migrations run via `drizzle-kit`.

## API route conventions

- All routes under `src/app/api/`
- Auth check at the top of every handler (`auth()` from Clerk)
- Return types: JSON, standard error shapes
- Always validate input with zod
- Never log PII; violations table stores sha256 hashes only

## What not to do

- Don't add new dependencies without checking bundle size
- Don't port Python engine logic to TypeScript — call Python runtime
- Don't build custom UI for billing — Stripe Portal handles everything
- Don't store plaintext strings in the violations table
- Don't add features not in BUILD_PLAN.md — scope creep kills the ship

## Running locally

```
npm install
npm run db:push
npm run dev
```

Environment variables required: see `.env.local.example`.

## Before every commit

- `npm run lint`
- `npm run typecheck`
- Run through the acceptance criteria from the current session
```

### E.2 Engine repo CLAUDE.md

```markdown
# ContentRX engine — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

The evaluation engine: Python pipeline that combines a deterministic
preprocessor with LLM-based evaluation. Includes the standards library,
moment detection, audience gating, and eval tooling.

Also contains the Figma plugin source (figma-plugin/).

## Current version

4.5.0 (bumped from 4.0.0). See `src/content_checker/__init__.py` for
the canonical version string. `pyproject.toml` must match.

## Architecture overview

See ARCHITECTURE.md for the full story. Key concepts:
- Preprocessor: VIOLATION/PASS/DEFER outcomes per standard
- Pipeline: classify → filter → preprocess → LLM → merge
- Merge stage: single point of suppression policy (audience + moment)
- Moments: 13 canonical experiential contexts
- Standards: 47 rules in the library

## Non-negotiables

- Every function returns typed dataclasses from models.py
- Preprocessor never judges — only mechanical checks
- LLM never sees standards that don't apply (filter gates first)
- Suppression happens in ONE place (the merge stage)
- Every preprocessor check has tests in `tests/`
- Always use `python3`, never `python`

## Session workflow

1. Read this CLAUDE.md
2. Read ARCHITECTURE.md if touching pipeline/moments/filter
3. Read the relevant session block from BUILD_PLAN.md
4. Make changes
5. Run `python3 -m pytest tests/ -v` — must be green before commit
6. Bump version if standards or preprocessor changed

## JS/Python parity

The Figma plugin's JS preprocessor in `figma-plugin/ui.html` must stay
in parity with `src/content_checker/preprocess.py`. When changing the
Python preprocessor, update the JS in the same PR.

## Taxonomy refinement

Only split a content type when the distinction changes downstream
behavior (different standards apply, different moment detection).
Never split for semantic accuracy alone. Each new content type
multiplies classifier + filter + test surface area.
```

### E.3 CLI repo CLAUDE.md

```markdown
# ContentRX CLI — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

The Python CLI. Installed via `pip install contentrx-cli`. Calls the
ContentRX API backend for evaluation.

## Invariants

- Entry point: `contentrx` command (defined in pyproject.toml)
- Auth: `CONTENTRX_API_KEY` environment variable, nothing else
- Output formats: human-readable (default) and `--json`
- Exit codes: 0 = pass, 1 = violations found (when --strict), 2 = error
- Never ship: user data in logs, API key in logs

## Backwards compatibility

The CLI output format is consumed by the GitHub Action. Any change to
`--json` output requires a corresponding update in contentrx-action.

## Session workflow

1. Read this CLAUDE.md
2. Read BUILD_PLAN.md session block
3. Make changes
4. Test against a local backend (contentrx-app running on localhost:3000)
   before testing against production
5. Bump version in `pyproject.toml`
6. Test `pip install .` from a clean venv before publishing
```

### E.4 GitHub Action repo CLAUDE.md

```markdown
# ContentRX GitHub Action — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

A GitHub Action that runs the ContentRX CLI against changed files in a
PR and comments with violations.

## Runtime

- Docker-based action (not JavaScript or composite)
- Base: python:3.11-slim + Node.js 20 (for AST extractor)
- Dependencies: contentrx-cli (pip), @babel/parser + @babel/traverse
  + htmlparser2 (npm)

## Extraction pipeline

1. Detect changed files from GitHub context (pull_request payload)
2. Filter by `paths` glob input
3. Node AST extractor (`src/extract.mjs`) emits JSON-lines:
   `{file, line, column, text, attr}`
4. Python entrypoint (`src/report.py`) reads JSONL, calls contentrx-cli
   per string, aggregates by file, posts PR comment via GitHub API

## Acceptance invariants

- Never post more than one comment per PR (update existing if present)
- Always include file:line in each violation row
- `strict: true` fails the action only when violations exist AND
  severity >= 'high'
- API errors don't fail the action (warn in log, continue)

## Publishing

- Draft releases for testing
- Publish to GitHub Marketplace only after full dogfooding
- Versioning: semver, tags like `v1.0.0`
```

### E.5 contentrx-standards CLAUDE.md

```markdown
# ContentRX standards — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

The open-source content model: standards library, moments taxonomy,
content types. Published under MIT license. This is the spec people
cite.

## What goes here

- `standards/standards_library.json` (canonical source)
- `docs/*.md` (human-readable explanations, generated from JSON)
- `CHANGELOG.md` (semantic versioning)

## What does NOT go here

- Python engine source (that's in the engine repo)
- Figma plugin source
- Any commercial code or keys

## Versioning

Semantic versioning. Breaking changes (renamed standards, removed
moments) require a major bump. Additive changes (new standards, new
moments) are minor. Documentation-only changes are patch.

## Contributing

External contributions via GitHub Discussions first, then PRs. Robo
reviews all PRs personally. Rule: a proposed standard must include
rationale, 2+ pass examples, 2+ fail examples, and a proposed severity.
```

### E.6 contentrx-docs CLAUDE.md

```markdown
# ContentRX docs — Claude Code instructions

**Read this file first. Every session. No exceptions.**

## What this repo is

The docs site at docs.contentrx.app. Nextra-based. Documents the
content model, standards, moments, and whitepaper.

## Source of truth

The `contentrx-standards` repo is the canonical source for standards
and moments. This repo GENERATES MDX pages from that JSON. Never
hand-edit spec pages — edit the standards repo and re-run the build
script.

## Build script

`scripts/generate-spec.mjs` reads `../contentrx-standards/standards/`
and generates `pages/spec/`. Run before every deploy.

## Whitepaper

Hand-written in `pages/whitepaper.mdx`. When updating, also update the
linked PDF in `public/whitepaper.pdf`.
```
