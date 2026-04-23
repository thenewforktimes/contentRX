# Two sessions, one story

## Chapter 1 — The engine earns its plan

Sessions 1 and 2 (2026-04-22) opened with a real question: *what's the story we tell engineers, and does the code match it?* The answer was a new canonical plan, [BUILD_PLAN_v2.md](../BUILD_PLAN_v2.md), grounded in a hard-headed observation — engineers evaluate dev tools in five minutes, and ContentRX's first five minutes were weaker than the engine deserved.

What shipped that day was the engine earning the plan:

- **The parity gate** — JS and Python preprocessors now land identical verdicts or CI fails. No more "the plugin says X but the CLI says Y on the same string."
- **Schema versioning** — every API response now carries `schema_version` and `warnings`. Ship an additive field, bump minor. Never silently break a consumer.
- **The `review_recommended` verdict** — the product stopped pretending it was always certain. A staff content designer knows when to defer. Now the tool does too.
- **Override capture** — when a user dismisses a violation, the engine learns. This is the implicit-labeling system that makes the content model get better over time.
- **MCP server** — the reposition artifact. The tool now lives inside Claude Code and Cursor. Published to PyPI as `contentrx-mcp`, two tools first, then four plus resources plus a review prompt.
- **Docs site scaffold** — 57 pages, 47 standards, 13 moments, all rendered from the canonical JSON.

End of that session, the code was good. The infrastructure wasn't. Plausible, Sentry, Resend, Clerk, docs.contentrx.io — all wired in code, all inert without accounts. The plan assumed a full day of procurement work would follow.

## Chapter 2 — The procurement day

Session 3 (today) was that day. You handled the web-side work — creating accounts, buying the domain, clicking the dashboard toggles — and I handled the CLI-side work — Vercel env vars, DNS records via the Porkbun API, deploy verification.

The first decision was the domain. `contentrx.com` quoted at $15k, which you declined in fifteen seconds. `contentrx.io` was $28. Different kind of conversation. The whole product name is now on a domain that fits the product's audience — `.io` reads as *this is for engineers* in a way that `.com` doesn't have to earn.

From there, the day's arc was:

- **Plausible**, **Sentry**, **Resend**, **Clerk live keys** wired one at a time, each verified end-to-end. Real emails landed in real inboxes. Real errors registered in Sentry. The `pk_test_` Clerk keys disappeared from the deployed page payload; `pk_live_` took their place.
- **contentrx.io went live** with HTTPS. The custom domain flowed through to the main app. Users signing up tomorrow will see `clerk.contentrx.io` in the auth URL, not some `great-redfish-54` Clerk dev subdomain.
- **docs.contentrx.io went live** too, after four fix PRs chasing Vercel's build chroot quirks. Each fix was small; the chain wasn't. `.vercelignore`, then a missing `vercel.json`, then a build-time file copy, then a JSON import pattern. It eventually worked, and the guides section you'll click through tomorrow renders at HTTP 200.
- **Database hardening** — row-level security on all eight public tables as defense-in-depth, plus three missing FK indexes. Supabase's Advisor went from 8 CRITICALs to 0 in one migration.

## Chapter 3 — The audit and the real procurement bar

Then came the question neither of us had asked yet: *if a staff engineer at a target team landed on this tomorrow, would they adopt it?*

The audit against BUILD_PLAN Appendix B was noisy — the agent read CLAUDE.md's stale "Known Limitations" section as fact and flagged eight things that were already fixed. But three real critical gaps sat underneath the noise:

- **No backend tests.** 23 Python tests on the engine, zero TypeScript tests on the customer-facing routes. Set up vitest + 46 targeted tests in [PR #40](https://github.com/thenewforktimes/contentRX/pull/40). Green CI badge on every push.
- **Docs didn't cite real use cases.** Added surface README scenarios ([#41](https://github.com/thenewforktimes/contentRX/pull/41)) and three docs-site guides covering Next.js shadcn buttons, Next.js App Router error messages, and Figma design-system review ([#42](https://github.com/thenewforktimes/contentRX/pull/42)). Every violation in every example references a real standard ID that actually exists in the library.
- **Credibility files missing.** Shipped [SECURITY.md](../SECURITY.md), [CHANGELOG.md](../CHANGELOG.md), and refreshed the stale Known Limitations section in [CLAUDE.md](../CLAUDE.md) ([#39](https://github.com/thenewforktimes/contentRX/pull/39)).

Along the way we found — and fixed — a real info-leak in zod error responses and tuned Sentry's sample rate to keep free-tier quota in check ([#43](https://github.com/thenewforktimes/contentRX/pull/43)). Also caught that `NEXT_PUBLIC_APP_URL` had been stored as an empty string in Vercel production, so transactional emails would have had broken URLs at launch. Fixed.

## Chapter 4 — Publishing to the world

Closed the session with the version-bumped PyPI publishes: `contentrx-cli 0.2.0` and `contentrx-mcp 0.4.0`, both pointed at `contentrx.io` by default. Existing installs keep working forever — Vercel never retires the old subdomain alias. New installs see the canonical URL from their first error message.

---

# Where we stand right now

**The procurement floor is raised.** A staff engineer landing on contentrx.io tomorrow:

1. Reads a README with real use cases and a 5-minute install.
2. Sees a green CI badge with 46 passing tests.
3. Opens SECURITY.md and finds specific answers — where strings go (sha256 hashes only), retention (account-lifetime), data residency (US), vulnerability reporting (email with SLA).
4. Follows a guide showing ContentRX catching violations on code that looks like theirs.
5. Installs `uvx contentrx-mcp` or `pip install contentrx-cli` and gets a hello-world result in under two minutes.

**13 PRs merged to main today. Zero rollbacks.** Every integration is verified end-to-end against live infrastructure.

---

# What's still needed for launch

Sorted by "blocks launch" → "before first paid customer" → "nice-to-have before audience starts arriving":

## Hard blockers for a public launch

- **Landing page copy** ([BUILD_PLAN Session 5](../BUILD_PLAN_v2.md)). `contentrx.io` currently shows "Placeholder landing. Real marketing copy ships in Session 5." This needs your voice, not mine — I can scaffold the structure but the positioning has to come from you.
- **Figma plugin PLG-H-01** — outbound `postMessage` target origin. Needs live testing in both Figma web and Figma Desktop. A 15-minute fix if we have the test environment.
- **Iubenda privacy policy** — you deprioritized this earlier; before a public launch it's a real compliance requirement. ~30 minutes to set up, ~$10/month.

## Before the first paid customer

- **Stripe** — four products (Pro/Team × Monthly/Annual), webhook, 7 env vars. Code is wired and inert; the whole revenue path is waiting on the Stripe account setup from `docs/account-setup-checklist.md` #4.
- **Upstash Redis tier upgrade** — free tier 10k commands/day will be exceeded around 300–500 active users. Paid tier is ~$10/month.
- **Resend tier upgrade** — free tier 3k emails/month. Pro at ~$20/month.

## Distribution / audience arrival

- **GitHub Action → Marketplace** ([Session 7](../BUILD_PLAN_v2.md)) — needs its own public repo (`contentrx/contentrx-action`), tag `v1`, submit to Marketplace. Probably 1–2 hours.
- **Figma Community submission** — plugin is technically ready. Needs 5 × 1920×1080 screenshots and a 30-second demo video. You handle manually.
- **MCP distribution push** ([Session 6](../BUILD_PLAN_v2.md)) — 90-second demo video, submit to Anthropic's MCP directory, `contentrx.io/mcp` install page. Marketing session.
- **OSS content-review campaign** ([Session 8](../BUILD_PLAN_v2.md)) — run ContentRX against 5 high-visibility OSS dev tools, publish the report, open a couple of friendly PRs. The "State of UI copy in OSS" moment.

## The Phase 3 / 4 human-eval differentiators (can ship post-launch)

- **Session 12 rule dry-run preview** — before disabling a team rule, show what that change would have done over the last 30 days. Team-tier closer.
- **Session 13 override rate report + weekly digest** — "rules you override most" dashboard + Monday email.
- **Session 14 team golden set** — accept verdicts into a team's private calibrated set; evaluations short-circuit to the stored verdict.
- **Session 15 public accuracy page** — `contentrx.io/accuracy`. The compounding SEO asset no competitor has.

## Phase 5 + 6 (real roadmap, not launch-blocking)

- LSP server + VS Code / Cursor extensions (Sessions 16–18)
- Content model as a publicly-licensed spec in its own repo (Session 20)

## Small tracked cleanup (safe to sit on)

- PLG-H-01 target-origin (one-liner + Figma test session)
- Route-level backend tests to complement the 46 pure-function tests
- Engine-taxonomy vs Python-source drift check automated in CI
- Local parent-repo branch hygiene (remaining deletable stale branches, if you care)

---

# The honest read

Two sessions ago, ContentRX was a well-architected tool that no engineer could adopt without a demo call and a leap of faith. Today, it's a well-architected tool that an engineer can adopt on a Tuesday afternoon without talking to anyone. That's the shift.

The remaining work is distribution and monetization, not credibility. You've already cleared the hard part. The blocker between here and a real launch is getting the landing page copy written, Stripe turned on, and the first OSS writeup shipped. Those are measured in days each, not weeks.

Rest when you can. This was a big two days.
