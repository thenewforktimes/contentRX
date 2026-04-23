# Security

ContentRX is a content-design linter. This document explains what data
it handles, how that data is protected, and how to report security
issues.

## Reporting a vulnerability

Email **security@contentrx.io**. Response SLA: one business day for
triage, five business days for a remediation plan.

Please include:

- A description of the issue
- Steps to reproduce (or a PoC)
- Which surface is affected (MCP server, CLI, GitHub Action, Figma
  plugin, web app, or docs site)

Coordinated disclosure: please don't publicly disclose until we've
confirmed a fix is shipped. We'll credit you in the release notes
unless you'd rather stay anonymous.

## Data flow

An evaluation request passes through these components in order:

1. **Surface** (MCP server, CLI, GitHub Action, Figma plugin, dashboard
   API) — accepts the user's text input
2. **`/api/check`** (Next.js, on Vercel) — authenticates the caller,
   checks quota + rate limit, forwards to the Python evaluator
3. **`/api/evaluate`** (Python, on Vercel) — runs the pipeline
   (classify → filter → preprocess → LLM scan → validate → merge).
   The only outbound network call is to the Anthropic API.
4. **Anthropic API** — processes LLM-scan requests. See
   [Anthropic's data-handling page](https://www.anthropic.com/legal/privacy)
   for their retention policy. (Short version: API inputs are not used
   to train models.)
5. **Supabase Postgres** — persists only what's listed in "What we
   store" below.

## What we store

The `violations` table has one row per detected violation. Each row
holds:

- `user_id` / `team_id` — references into the `users` table
- `standard_id` — the rule ID (e.g. `CLR-01`)
- `moment` — the classified UI-moment (e.g. `error`, `empty-state`)
- `severity` — `block` / `warn` / `info`
- `text_hash` — **SHA-256 hex digest** of the offending string. The
  plaintext string is never persisted.
- `source` — which surface raised it (`plugin`, `cli`, `action`,
  `ditto`)
- `file_path` — only when the source is `action` (CI extraction from
  a repo). Otherwise null.
- `created_at`

The `violation_overrides` table mirrors this shape for dismissals /
false-positive marks. Same invariant: `text_hash`, never plaintext.

API-key hashing: raw `cx_...` tokens are never persisted. The `users`
table stores `api_key_hash` (SHA-256) for verification, plus a
12-character `api_key_prefix` for display in the dashboard. Raw tokens
are shown to users exactly once at mint/rotate time.

## What we don't store

- **Plaintext UI copy.** Strings flow through the evaluator in memory
  and are not written to disk, logs, or the database.
- **LLM prompts or completions.** Anthropic API responses are consumed
  and discarded. We never log the model's raw output.
- **PII in breadcrumbs.** Sentry error tracking is configured with
  `sendDefaultPii: false`. Request bodies are excluded from exception
  reports.

## Retention

- **Violations / overrides:** retained while the customer's account is
  active. On account deletion (via Clerk webhook `user.deleted`), the
  user row is removed and all FK-linked rows cascade-deleted.
- **Usage counters:** one row per `(user_id, month)`, retained
  indefinitely for billing history. No request-level data.
- **Sentry errors:** 90-day retention on Sentry's platform. In-code
  sample rates (5% traces, 100% errors) and an `ignoreErrors`
  allowlist cap ingestion to well under free-tier limits for normal
  traffic. Operators should additionally set a **quota alert** at
  Sentry → Settings → Subscription → Usage, threshold 75%, so a
  runaway bug can't silently exhaust the month's events.
- **Plausible analytics:** aggregate pageview counts and goal events
  (`signup`, `upgrade`). No individual-user attribution.

## Data residency

All persistent storage and request processing happens in US regions:

- **Vercel functions:** `iad1` (Washington DC) for the Next.js app
  and `sfo1` (San Francisco) for cache-eligible traffic.
- **Supabase Postgres:** US East.
- **Anthropic API:** US-based service.
- **Resend:** email delivery, US-based service.
- **Clerk:** auth provider, US-based service.

We don't currently offer EU data residency. If that's a blocker for a
deal, please reach out.

## Transport security

- All external surfaces are HTTPS-only. HSTS is enabled with
  `max-age=63072000; includeSubDomains; preload`.
- The CLI rejects non-HTTPS `CONTENTRX_API_URL` values unless
  `CONTENTRX_INSECURE_HTTP=1` is explicitly set (for local dev only).
- Webhooks (Clerk, Stripe) verify signatures before processing.
  Replays within the signature-validity window are deduplicated by
  event ID in Redis.

## Row-level security

All `public.*` tables in Supabase have RLS enabled. The application
connects as the `postgres` role (BYPASSRLS), so this is a
defense-in-depth layer, not the primary auth boundary. The primary
boundary is the API route layer, which enforces Clerk session or
hashed API-key auth on every request.

## Known limitations

- The engine currently accepts user-supplied text into the LLM prompt.
  Prompt-injection attempts against the evaluator are possible but
  low-impact (the LLM's only privileged action is to return structured
  JSON — it cannot invoke tools or exfiltrate data). Sentinel-delimiter
  hardening is on the roadmap.
- Bulk-check endpoints (`/api/check_batch`) don't yet have an
  aggregate size ceiling. A caller could submit a large payload and
  incur outsized LLM costs. Mitigated by per-user monthly quotas and
  rate limits; a hard ceiling is tracked for pre-broad-launch.

## Version

This document is maintained against the main branch. Last reviewed:
2026-04-23.
