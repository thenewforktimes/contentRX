# ADR: Customer-not-product data handling

**Date:** 2026-04-28
**Status:** Accepted
**Owner:** Robo
**Supersedes:** None

## Context

ContentRX is a content-design review tool for designers, engineers, and PMs. Customers paste UI strings — sometimes rough drafts, sometimes copy that names unreleased products, sometimes (by accident) strings that contain credit card numbers, social security numbers, API keys, or other content that has nothing to do with UI copy. The tool runs those strings through a third-party LLM (Anthropic's Claude) and surfaces a verdict.

That flow puts customer text in front of multiple systems that aren't ours: Anthropic for evaluation, Vercel for execution, Sentry for error capture, Supabase for storage, Resend for email, Stripe for billing. Each one is a contracted subprocessor with a defined purpose. Each one creates a surface where customer content could be retained, repackaged, or visible to someone other than the customer who pasted it.

The trust model the product needs to make explicit: ContentRX charges customers for a tool. The customer is the customer; the customer is not the product. ContentRX does not — and must not — fund itself by selling the customer's strings to data brokers, by repackaging check history into "intent signal" datasets, by training models on customer content without explicit per-entry opt-in, or by running engagement-modelling telemetry on individual customer behaviour. The "free service, you're the product" pattern that defines ad-funded platforms (Meta, X, free-tier Google) does not apply here, and the policy needs to say so loudly enough that customers can verify it.

This ADR captures both the position and the engineering layer that backs it. Without the engineering layer, the position is a promise. With it, the position is a property of the system.

## Decision

### Five things ContentRX will not do

The five lines we won't cross are public-facing and identical across `/ethics` (commitment 6) and `/privacy`:

1. **No selling customer strings.** Hashed, anonymised, or otherwise. No data-broker contract. No advertiser arrangement.
2. **No repackaging check history into a profile** of the customer, their team, or their industry that gets marketed against them. The dashboard shows the customer's own activity to the customer; no aggregate "intent signal" product gets sold on top.
3. **No training a model on customer content** — ours, Anthropic's, anyone's — without the customer's explicit, per-entry opt-in. The Team-plan custom-example contribution toggle is the only path by which a customer string ever enters our calibration corpus, it is off by default, it is per-entry rather than account-wide, and contributed strings are anonymised at ingest.
4. **No subprocessors beyond the published list.** The `/privacy` page enumerates Anthropic, Stripe, Clerk, Supabase, Vercel, Resend, Sentry, Plausible, Upstash, Figma. Each one has a defined purpose. Adding one updates the published list within 30 days; meaningfully changing what data we share with one is announced before the change ships.
5. **No engagement-modelling or behavioural telemetry** on individual customer use of ContentRX. Two telemetry sources only: monthly check counts (because billing) and crash reports (because bugs). No event tracking, no funnel analysis at the user level, no per-customer behavioural profiles.

### Engineering layer (the code that backs the policy)

Three modules guard the boundary between customer text and any place that text could become visible to someone else. They are required infrastructure, not optional defense-in-depth — removing or weakening any of them requires a new ADR superseding this one.

**`src/lib/pii-screen.ts`** — regex-based pre-screen on every public route that accepts a string. Detects high-confidence sensitive patterns (US SSNs, Luhn-validated credit/debit card numbers, AWS access keys, Stripe live/test keys, OpenAI / Anthropic / generic `sk-…` keys, GitHub PATs) and refuses the request with a 400 before the engine, Anthropic, or any logging surface ever sees the value. Wired into `/api/check`, `/api/classify`, `/api/suggest-fix`, `/api/violations/override`, and `/api/team-custom-examples`. Matched substrings are not echoed back in the error response — the response names the type only.

**`src/lib/sentry-scrub.ts`** — Sentry `beforeSend` handler that runs on top of `sendDefaultPii: false`. Drops the request body, scrubs Authorization / Cookie / x-internal-secret headers, drops cookies and query strings, truncates exception messages and the top-level event message past 200 chars, redacts text-shaped fields from extras / tags / breadcrumb data. Applied to both server (Node + Edge runtimes via `instrumentation.ts`) and browser (`instrumentation-client.ts`).

**`src/lib/safe-error-log.ts`** — `logSafeError(label, err)` replaces `console.error(label, err)` patterns in routes that handle user content. Hand-shaped log payload of `{kind, message, status?}` so Vercel function logs never receive an err object's transitive properties. SDK errors (Anthropic, Stripe, fetch wrappers) sometimes serialise the request body into their subclasses; this helper means that body never reaches `vercel logs`.

### What stays the customer's responsibility

The pre-screen is a high-confidence net, not an exhaustive one. Patterns that have legitimate use in UI copy — phone numbers, email addresses, generic numeric IDs, prose like "your password expires in 30 days" — are explicitly out of scope. A customer pasting an expense report, a chat transcript, or a passport number in plain digit form will not be blocked. The product is for UI copy review; pasting other content is the customer's call, and the privacy policy describes what happens to that content (sha256 in our database, transit through Anthropic, retention rules per the cancellation flow).

### Operational item not in scope of this ADR

Anthropic retains API logs for 30 days by default. Anthropic's Zero Data Retention (ZDR) agreement is enabled at the account level via direct support contact. Engaging ZDR is an operational task on the founder, not a code change, and is the largest single gap the engineering layer cannot close on its own. Customer-facing copy (privacy policy, ethics page, FAQ) does not claim "your strings never leave the request lifecycle" until ZDR is confirmed live on the production Anthropic account.

## Consequences

### Positive

- **The trust model is verifiable, not just stated.** A customer or third-party auditor can read `/ethics` (commitment 6) and `/privacy` ("What we won't do") and check the engineering claim against the named source files. The promise is anchored to code that exists in the repository.

- **Defense extends past the dashboard.** The audit that prompted the engineering work confirmed that admin dashboards never display raw customer text. The engineering layer covers the surfaces that audit didn't initially examine: Sentry events, Vercel function logs, Anthropic's API console retention. Customer text now travels through fewer systems, and through none of them by accident.

- **The "what changes if we ever change our mind" path is explicit.** Future reversal of any of the five non-negotiables requires a new ADR superseding this one, with a customer notification before any new collection starts. The page at `/ethics` is always live; if a competing ADR isn't linked, the rules above are the rules.

- **The position is differentiating.** Few content-tool competitors make this commitment in code rather than in marketing. The combination of (a) public commitment, (b) engineering layer, (c) ADR-bound reversal path is a concrete trust signal an enterprise procurement reviewer can verify.

### Negative

- **Pre-screen will produce false positives at the margin.** A customer reviewing transactional UI copy that contains a Luhn-valid 16-digit reference number will be blocked. The error message names the type and suggests a placeholder, but the friction is real. The trade-off (blocking some legitimate inputs vs. ever showing a real card number to Anthropic / Sentry / function logs) is the right one for the product, but the friction will need monitoring once paying customers report it.

- **Engineering hardening adds surface area.** Three new library files plus their tests must keep working as the codebase evolves. The structural Sentry Event type in `sentry-scrub.ts` is decoupled from `@sentry/types` to avoid SDK-version coupling, but a substantive Sentry SDK rewrite could still require maintenance.

- **Adding new public surfaces takes more work.** Any new route that accepts a string must wire the pre-screen and use `logSafeError`. The CLAUDE.md non-negotiables enumerate the requirement so the next engineer / agent knows.

- **Anthropic ZDR remains an external dependency.** Without it, the strongest defense the policy promises ("strings never sit at rest in a system you don't audit") is incomplete. Customer-facing copy is calibrated accordingly.

## Reversal path

Any change to the five non-negotiables — or removal / weakening of any of the three guard files — requires a new ADR superseding this one and customer notification before the change ships. The customer-facing copy at `/ethics` (commitment 6) and `/privacy` ("What we won't do") is the live truth: if no superseding ADR is linked from `/ethics`, the rules in this ADR are the rules.

## References

- [/ethics commitment 6](../src/app/ethics/page.tsx) — public-facing position
- [/privacy "What we won't do"](../src/app/privacy/page.tsx) — public-facing position, plain-language version
- [src/lib/pii-screen.ts](../src/lib/pii-screen.ts) — pre-screen library
- [src/lib/sentry-scrub.ts](../src/lib/sentry-scrub.ts) — Sentry beforeSend handler
- [src/lib/safe-error-log.ts](../src/lib/safe-error-log.ts) — structured error logger
- [CLAUDE.md "Customer data — non-negotiables"](../CLAUDE.md) — rules for future engineering work
