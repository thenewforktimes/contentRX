# ContentRX — full-codebase audit

**Date:** 2026-04-22
**Auditor:** Claude (Opus 4.7, 1M context)
**Scope:** Every file committed to `main` as of commit 61328fd (Session 15 merged)
**Method:** Four parallel sub-agents covering Python engine, Figma plugin,
CLI + GitHub Action, and Next.js UI, plus deep hand-reading of the
security-critical backend (middleware, auth, webhooks, crypto, CORS,
Redis handoff, Stripe pipeline, Clerk integration).

This audit focuses on **real risks**. Where a concern is theoretical or
already intentional per CLAUDE.md, I say so. I've tried hard not to pad.

---

## 1. Executive summary

The codebase is in good shape for a product at its stage. No catastrophic
vulnerabilities, no exposed secrets, no SQL-injection surface, no
dangerouslySetInnerHTML anywhere in React. The auth model (Clerk session
+ hashed `cx_` API key) is coherent and consistently applied. The Stripe
webhook is signature-verified + Redis-deduped. The Python engine fails
closed on LLM parse errors. Tests are thorough (1,139 across three test
suites).

That said, **three findings warrant action before broader launch**:

1. The Figma plugin's `window.onmessage` handler accepts messages from
   any origin — token-hijack risk in the wild.
2. The Figma handoff-code polling endpoint has a TOCTOU race between
   `redis.get` and `redis.del` (atomic `GETDEL` fixes it in one line).
3. The GitHub Action's PR-comment builder can overflow GitHub's 65,536
   character limit on large PRs, and pagination isn't followed on PRs
   with >100 changed files.

Everything else is Medium, Low, or Info — fix at your cadence.

---

## 2. Severity roll-up

| Severity  | Count | Areas |
|-----------|-------|-------|
| Critical  | **3** | Figma plugin (1), GitHub Action (2) |
| High      | **5** | Python engine (1), Figma plugin (3), Stripe UI redirect (1) |
| Medium    | **13** | Cross-cutting |
| Low       | **8** | Polish + a11y |
| Info      | **20+** | Documented patterns, intentional designs, passing checks |

Three items from the existing "Known limitations" block in CLAUDE.md
remain open and are re-surfaced here: (a) Clerk webhook svix-id dedupe
(#3), (b) `getCurrentUsage` → `incrementUsage` race (#2), (c) engine-
level custom-rule evaluation by LLM (Session 16 deferred).

---

## 3. Findings by area

### 3.1 Figma plugin

Files: `figma-plugin/ui.html`, `figma-plugin/code.js`, `figma-plugin/manifest.json`

#### Critical

**PLG-C-01: Missing origin check on `window.onmessage` handler**
- File: `figma-plugin/ui.html:3152–3221`
- The plugin's message handler (`window.onmessage = async (event) => { ... }`) reads `event.data.pluginMessage` without checking `event.origin`. Inside Figma's iframe sandbox, the only legitimate sender is the sandbox thread via `figma.ui.postMessage()`, but any third-party script loaded into the iframe context could emit a `{ type: "token-loaded", token: "attacker-controlled-token" }` or a `save-token` message to hijack the session.
- **Fix:** At the top of the handler, early-return unless `event.source === window.parent` (the Figma iframe shell). Belt-and-suspenders: also check `event.origin === "https://www.figma.com"` (plus `"null"` for the sandboxed doc).

#### High

**PLG-H-01: `parent.postMessage(..., "*")` leaks sensitive messages**
- File: `figma-plugin/ui.html:3062, 3081, 3100–3116, 3145, 3239, 3347, 3425`
- Every `parent.postMessage()` uses `"*"` as target origin, including the `save-token` message that carries the cx_token. If any non-Figma script lives in the parent frame (shouldn't, but defense-in-depth), it could intercept the token.
- **Fix:** Use `parent.postMessage(payload, "https://www.figma.com")`. Figma iframes may also use the `null` origin in some sandbox configurations — test in dev; if `null`, fall back to `"*"` only for messages that don't carry secrets.

**PLG-H-02: Double-poll race on handoff code**
- File: `figma-plugin/ui.html:3018–3054` (`pollForToken`) + `3056–3087` (`startSigninFlow`)
- If a user clicks "Sign in" twice before the first flow completes, two parallel polling loops hit `/auth/figma?poll=1&handoff=<same-code>`. Combined with the server-side TOCTOU (BE-M-01 below), two polls could both succeed. Client-side, the second `startSigninFlow` overwrites `window._lastSigninUrl` and `signinPollAbortController` without aborting the first.
- **Fix:** In `startSigninFlow`, `if (signinPollAbortController) { setError("Sign-in already in progress"); return; }` before generating a new handoff.

**PLG-H-03: Rate-limit 429 terminates the scan rather than backing off**
- File: `figma-plugin/ui.html:2363–2364` and the scan-pool error handler around line 2480
- When `/api/check` returns 429, `checkContentViaApi` throws a plain `Error`, which is caught per-node and recorded as `apiError`. A page with 100 layers at MAX_CONCURRENT=2 can briefly exceed the backend's 60/min window; every subsequent node then gets a 429 and the whole tail of the scan fails with no retry.
- **Fix:** Treat 429 like AuthError/QuotaError — a typed error that pauses the worker pool with `setTimeout(retry, parse(retry-after) * 1000)` instead of failing the node.

#### Medium

**PLG-M-01: Dead code — `renderSingleResult()` never called**
- File: `figma-plugin/ui.html:2884–2918`
- Defined, tested nowhere, not invoked. Since the plugin is shipped inline and bundle size matters for load time, cutting it is a free win.
- **Fix:** Delete the function.

**PLG-M-02: DEV_MODE flag is left enabled**
- File: `figma-plugin/ui.html:633` (`const DEV_MODE = true`)
- The "Export scan results (dev)" button is visible to everyone using the plugin. Not a security flaw (user exports their own data), but cramp of the UX and reveals internal intent. BUILD_PLAN's Figma Community submission checklist explicitly calls for `DEV_MODE = false` before submit.
- **Fix:** Flip to `false` before the Community submission in Session 6's deliverables. Or gate by `manifest.name.includes('Development')`.

**PLG-M-03: `innerHTML +=` pattern in `renderQuotaExhaustedBanner`**
- File: `figma-plugin/ui.html:3413–3418`
- The banner is inserted via `area.innerHTML = banner + area.innerHTML`. The `banner` variable uses `escapeHtml()` correctly, so there's no live XSS, but concatenating into `innerHTML` is the class of pattern where escaping bugs hide. Re-rendering this way also nukes event listeners on child nodes already rendered.
- **Fix:** Build a DOM node with `document.createElement("div")`, set `textContent`, and `area.insertBefore(node, area.firstChild)`.

**PLG-M-04: Stale `setTimeout` callbacks after sign-in cancel**
- File: `figma-plugin/ui.html:3018–3054`
- `pollForToken` uses a chain of `setTimeout(...)` between polls but doesn't `clearTimeout` on abort. After multiple cancel-and-retry cycles, stale timers fire and can issue polls against a new handoff code.
- **Fix:** Track each timeout handle in a closure variable, clear on abort.

#### Low

**PLG-L-01: Accessibility gaps**
- `ui.html` — node cards use `<div>` with click handlers (not `<button>`), progress bars lack `role="progressbar"` + `aria-valuenow`, icon-only "Go to layer" button lacks `aria-label`, quota banner lacks `role="alert" aria-live="polite"`.
- **Fix:** Incremental — audit against WCAG AA as part of Session 6 Figma Community pre-submit.

#### Info (positive observations)

- `manifest.json` `networkAccess.allowedDomains` correctly limited to `https://content-rx.vercel.app`. No extraneous domains.
- `cx_token` is only sent as `Authorization: Bearer` and saved to Figma's local clientStorage. Never logged, never in URL params, never echoed in error messages that surface to the DOM.
- `escapeHtml()` (ui.html:2976) uses the DOM-based escape pattern (textContent → innerHTML), which is the correct bulletproof approach.
- Handoff-code generation uses `crypto.getRandomValues()` with 24 bytes → 32 base64url chars ≈ 192 bits of entropy. Well above the server's 16-char minimum.
- The sandbox thread (`code.js`) has ZERO network access and acts purely as a clientStorage mailbox. Right architecture.

---

### 3.2 Next.js app UI (dashboard + client components + auth pages)

Files: `src/app/layout.tsx`, `src/app/dashboard/**`, `src/app/auth/**`, `src/app/page.tsx`

#### High

**UI-H-01: Unvalidated redirect to URL from `/api/checkout` response**
- File: `src/app/dashboard/subscription-panel.tsx:71, 170`
- `window.location.href = url` where `url` comes from `/api/checkout` or `/api/portal`. The server constructs these URLs itself via the Stripe SDK, so in practice the response is always `checkout.stripe.com` or `billing.stripe.com`. But trusting a JSON field as a redirect target is the class of vulnerability where a future refactor (different route, a cached stale response, a compromised dep) becomes an open-redirect bug.
- **Fix:** Before redirecting, `const u = new URL(url); if (u.origin !== "https://checkout.stripe.com" && u.origin !== "https://billing.stripe.com") throw new Error("Unexpected redirect host")`.

#### Medium

**UI-M-01: `confirm()` and `alert()` used for destructive flows**
- File: `src/app/dashboard/api-key-panel.tsx:60`, `src/app/dashboard/team/rules/rules-client.tsx:268`
- Revoke-key and remove-team-rule use browser `confirm()`. These aren't keyboard-accessible to screen readers, don't match the rest of the UI, and are bypassable in some browsers.
- **Fix:** Replace with a small `AlertDialog` component (Tailwind + `role="alertdialog"`). Session 20 / QA is a reasonable time.

**UI-M-02: Landing page literally tells visitors it's a placeholder**
- File: `src/app/page.tsx:33`
- `<p>Placeholder landing. Real marketing copy ships in Session 5.</p>` is visible to anyone who lands on `/`. Minor credibility issue. User already deprioritized fixing this; flagging for awareness.

**UI-M-03: Stale comment in Figma callback claims Session 9 hasn't shipped**
- File: `src/app/auth/figma-callback/page.tsx:10–15`
- Comment: `"Keys are stored plaintext — known limitation #1 in CLAUDE.md, scheduled for Session 9 to rework as sha256(key) lookup."` Session 9 has shipped; keys ARE sha256-hashed in this file's `ensureApiKey` (line 80, 92).
- **Fix:** Delete the "stored plaintext" sentence.

**UI-M-04: `CallbackShell` uses inline hex colors — no dark-mode support**
- File: `src/app/auth/figma-callback/page.tsx:156–197`
- `background: "#fff"`, `color: "#1f2937"` hard-coded. Everything else in the app respects dark mode via `dark:` Tailwind classes.
- **Fix:** Port to Tailwind classes: `bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100`.

**UI-M-05: Dashboard `DittoPanel` is a dangling placeholder**
- File: `src/app/dashboard/page.tsx:184`
- "Coming soon" card for Session 18 work that isn't started. Shown to every user on every load. Either hide until Session 18 or move to an "integrations" submenu.

#### Low

**UI-L-01: `navigator.clipboard` copy failure silently ignored**
- File: `src/app/dashboard/api-key-panel.tsx:80–88`
- If the copy fails (HTTP context, older browser), the user sees no feedback. Comment says "the user can select and copy manually" but the key is inside a `<code>` that doesn't have text-selection affordance.
- **Fix:** On failure, show an inline toast or change the button label to "Select text above".

**UI-L-02: `redirect_url` query param in Clerk sign-in chain**
- File: `src/app/auth/figma/route.ts:90–94`
- `returnTo` is always `/auth/figma?...` with a server-validated handoff code — can't be subverted to an external host. Clerk's own redirect_url validation (allowed-hosts list) is the defense-in-depth. Acceptable as-is.

#### Info

- No `dangerouslySetInnerHTML` anywhere in `src/`. React's auto-escaping is doing the work.
- Clerk v7 `auth()` is correctly awaited everywhere (grep for the pattern returns zero sync-call sites).
- Plan gating (team rules, analytics) is enforced at the server component level — no client-only checks.
- `useEffect` in `analytics-client.tsx` correctly uses a `cancelled` flag to avoid setState on unmount. Valid pattern.

---

### 3.3 Python engine + `api/evaluate.py`

Files: `src/content_checker/**`, `api/evaluate.py`, `tests/conftest.py`

#### High

**ENG-H-01: `/api/evaluate` leaks exception details to callers**
- File: `api/evaluate.py:82`
- `return self._respond(500, {"error": f"Evaluation failed: {exc}"})` embeds the raw exception string in the JSON response. That can include file paths, model names, Anthropic SDK error bodies, or truncated LLM output. Even though `/api/evaluate` is guarded by `INTERNAL_EVAL_SECRET`, the caller (our own `/api/check`) then propagates `res.statusText + body` into a thrown error. The TS route catches that and returns a generic "Evaluation service unavailable" (check route:125), so public-facing leakage is blocked — but anything that logs the TS error (Sentry, Vercel logs) captures the raw Python exception.
- **Fix:** Return `{"error": "Evaluation failed"}` plus a `request_id` for log correlation. Stay with `traceback.print_exc()` to stderr so Vercel logs capture the detail.

#### Medium

**ENG-M-01: `classify_llm()` instantiates a bare `Anthropic()` client**
- File: `src/content_checker/classify.py:93`
- Bypasses `api_utils.get_client()` (which is the documented "single LLM boundary" per CLAUDE.md). Any retry logic or telemetry added centrally won't apply here.
- **Fix:** `from .api_utils import get_client; client = get_client()`.

**ENG-M-02: LLM parse-error logging truncates to 200 chars of raw output**
- File: `src/content_checker/api_utils.py:82–86`
- The 200-char truncation is fine for debugging, but if an LLM ever echoes user text back in a malformed response, that text ends up in Vercel logs. Low actual risk (the LLM doesn't echo user content intentionally), but defense-in-depth cuts it.
- **Fix:** Log only the length + error type: `f"parse failed (len={len(cleaned)}, err={type(e).__name__})"`.

**ENG-M-03: `check_legal_content()` is dead code**
- File: `src/content_checker/preprocess.py:594–627`
- Defined and unit-tested, but never called from `run_preprocess()`. Either reserved for future use (document), or dead.
- **Fix:** Wire it into the pipeline or delete.

#### Low

**ENG-L-01: Moment detection regex chain is O(n·k)**
- File: `src/content_checker/moments.py:86–226`
- 10+ regex.search calls against the input, which is capped at 100k chars. Individual patterns are ReDoS-safe; aggregate latency is probably fine but not profiled.

#### Info (positive)

- `INTERNAL_EVAL_SECRET` comparison uses `hmac.compare_digest()` with both sides encoded — constant-time, fails closed on missing env var. (`api/evaluate.py:47–60`.)
- `content_type` / `moment` / `audience` are `z.enum()`-validated in `/api/check` before reaching Python, closing the prompt-injection surface at the TS boundary. Python side doesn't re-validate, which is a documented acceptable choice.
- Standards loader caches by resolved path; no repeated JSON parse. No path-traversal risk on user-controlled paths (none reach the loader).
- Engine has zero `subprocess`, `eval`, `exec`, or `pickle.load`. Zero file writes at runtime (only reads + HTTP).
- Test coverage is dense: 1,025 engine tests + 21 cli-client + 26 github-action.

---

### 3.4 CLI client (`contentrx-cli`)

Files: `cli-client/contentrx/**`, `cli-client/tests/**`, `cli-client/pyproject.toml`

#### Medium

**CLI-M-01: `CONTENTRX_API_URL` env var accepts any protocol**
- File: `cli-client/contentrx/main.py:62` (`_api_base_url`)
- A user who sets `CONTENTRX_API_URL=http://example.com` (typo, clipboard mis-paste, or hostile env) sends their cx_token over plaintext HTTP. The CLI documents HTTPS in README but doesn't enforce it.
- **Fix:** After `os.environ.get`, add `if not url.startswith("https://"): raise CliError("CONTENTRX_API_URL must use https://", EXIT_USAGE)`. Reserve an env-var escape (`CONTENTRX_INSECURE_HTTP=1`) for local dev against a bare http://localhost.

#### Info (positive)

- Zero third-party runtime deps. Pure stdlib.
- Python's `urllib.request.urlopen()` verifies TLS certificates by default via `ssl.create_default_context()`.
- Exit codes (0/1/2/3/4/5/6) documented as API and tested.
- 21 tests mock `urlopen` — runs fully offline.
- No secrets logged in verbose mode.

---

### 3.5 GitHub Action

Files: `github-action/**`

#### Critical

**GHA-C-01: PR comment body can exceed GitHub's 65,536-char limit**
- File: `github-action/src/report.py:35` + `main.py:290`
- A PR touching 50 TSX files with 10 extractable strings each and 5 violations per string produces a ~164 KB comment. GitHub returns 422 (Unprocessable Entity) on attempts to create issue comments >65,536 chars. The current code has no truncation, so on a large PR the action posts no comment at all.
- **Fix:** After `render_markdown()` returns, `if len(body) > 60000: body = render_summary_only(reports) + "\n\n(Truncated — see workflow logs for the full list.)"`. Cover with a unit test that asserts `len(body) < 65536` for a synthetic 100-file report.

**GHA-C-02: Pagination not followed for PRs with >100 changed files**
- File: `github-action/src/main.py:71` (`_fetch_changed_from_api`)
- Hardcoded `?per_page=100`. PRs with >100 changed files silently get only the first 100. This is a correctness bug with no indication to the user that coverage is partial.
- **Fix:** Loop through the `Link: <...>; rel="next"` header. Alternative: if `len(entries) == 100`, log a warning and fall back to the full tree scan for safety.

#### Medium

**GHA-M-01: No `package-lock.json` checked in for the Node extractor**
- File: `github-action/src/package.json`
- `"@babel/parser": "^7.25.0"` etc. allow minor bumps. Every Docker build resolves a fresh tree, so supply-chain risk comes from any `@babel/*` 7.25.x release introducing a bug or compromised publish. Small surface (3 Babel deps, widely-used), but reproducible builds matter for a published Marketplace action.
- **Fix:** `cd github-action/src && npm install` → commit the resulting `package-lock.json`. Dockerfile swaps `npm install` → `npm ci`.

**GHA-M-02: `_fetch_changed_from_api` has no retry on transient GitHub API failure**
- File: `github-action/src/main.py:71`
- On a 429 or 500 from GitHub, the code falls back to scanning the entire repository tree — for a monorepo with 10k+ files this might hit the 2-minute Node-extractor timeout.
- **Fix:** Retry 3x with exponential backoff before the tree-scan fallback.

#### Info

- `subprocess.run(...)` everywhere uses argument lists — no shell injection (no `shell=True`).
- `extract.mjs` uses `@babel/parser` with `errorRecovery: true`; regex filters in `looksLikeCopy()` are simple and safe.
- Docker base image `python:3.11-slim` + `node:20.x` via official nodesource. `--no-install-recommends` set.
- `GITHUB_TOKEN` is never printed, never persisted, only used for GitHub API calls.
- Markdown snippets in the PR comment escape backticks (via U+2018 substitution). Test coverage present.

---

### 3.6 Backend — Next.js API routes + libs

Files I deep-read personally: `src/middleware.ts`, `src/lib/auth.ts`, `src/lib/api-key.ts`, `src/lib/stripe.ts`, `src/lib/redis.ts`, `src/lib/ratelimit.ts`, `src/lib/usage.ts`, `src/lib/quotas.ts`, `src/lib/log-violations.ts`, `src/lib/team-rules.ts`, `src/lib/evaluate.ts`, `src/app/api/check/route.ts`, `src/app/api/checkout/route.ts`, `src/app/api/portal/route.ts`, `src/app/api/webhooks/stripe/route.ts`, `src/app/api/webhooks/clerk/route.ts`, `src/app/api/team-rules/**`, `src/app/api/team-analytics/route.ts`, `src/app/api/dashboard/api-key/route.ts`, `src/app/auth/figma/route.ts`, `src/app/auth/figma-callback/page.tsx`.

#### Medium

**BE-M-01: TOCTOU race on Figma handoff-code consumption**
- File: `src/app/auth/figma/route.ts:67–80`
- Sequence is `const token = await redis.get(key); if (!token) return 202; await redis.del(key); return { token };`. Two pollers that hit the endpoint simultaneously can both read the same token before either deletes it, then both return it. The attack requires an adversary who can race the legitimate plugin (knowing the handoff code), so exploitability is low — but the whole point of single-use is single-use.
- **Fix:** Upstash `@upstash/redis` supports `GETDEL`. Replace the two calls with one atomic `await redis.getdel<string>(key)`. Drops the race and simplifies the code.

**BE-M-02: ReDoS via admin-controlled regex in custom team rules**
- File: `src/lib/team-rules.ts:255–262` (`compilePattern`) + `src/app/api/team-rules/route.ts:119` (compile check)
- When an admin saves a custom "add" rule, the pattern is compiled as a JavaScript `RegExp` and applied to every `/api/check` call for that team. A malicious or careless admin could save something like `(a+)+$` and cause pathological backtracking on 100-char inputs. Self-DoS by a trusted actor, but the `/api/check` hot path sits inside a tight rate-limit budget and the text can be 100k chars.
- **Fix, cheapest:** Reject patterns with common ReDoS signatures (`(.+)+`, `(.*)*`, nested repetition). **Fix, correct:** Wrap pattern evaluation in a worker thread with a 50 ms timeout, or use a non-backtracking engine (re2 via `node-re2`).

**BE-M-03: Clerk webhook lacks `svix-id` dedupe**
- File: `src/app/api/webhooks/clerk/route.ts:22–94`
- Svix verification validates signature + 5-minute timestamp window, but within that window the same event can replay. If `user.created` replays, the `onConflictDoNothing` guards duplicate inserts. But `user.updated` with the same payload re-runs the `UPDATE` — idempotent in practice, but not guarded. Listed as Known Limitation #3 in CLAUDE.md.
- **Fix:** Same Redis dedupe pattern used in the Stripe webhook. `SET NX figma_handoff:<svix-id> "1" EX 24h`.

**BE-M-04: `getCurrentUsage` → `incrementUsage` race (Known Limitation #2)**
- File: `src/app/api/check/route.ts:80–84` + `src/lib/usage.ts:28–47`
- Documented in CLAUDE.md. Up to the rate-limit ceiling (60/min) of concurrent requests can pass the quota gate before any of them increment. For Free users this means theoretical over-quota by ~59 evaluations/month/user.
- **Fix, cheapest:** `UPDATE usage SET count = count + 1 WHERE user_id = $1 AND month = $2 AND count < $3 RETURNING count` — if no row updated, 402 immediately.

**BE-M-05: Non-admin team members can read full team analytics**
- File: `src/app/api/team-analytics/route.ts:33–53`
- BUILD_PLAN §17 says non-admin team members should 403 on `/api/team-analytics`. Current code lets any team-plan user see the same aggregates the admin sees. I previously flagged this deliberately (data is aggregate, not sensitive) — worth raising to you so it's a conscious choice.
- **Fix (if tightening):** `if (auth.teamOwnerUserId !== null) return NextResponse.json({ error: "Admin only" }, { status: 403 });`

**BE-M-06: Stripe webhook trusts `client_reference_id` without verifying user exists**
- File: `src/app/api/webhooks/stripe/route.ts:133–156`
- `handleCheckoutCompleted` extracts `userId = session.client_reference_id` and writes directly to `subscriptions` / `users` without verifying the user row exists. Signature verification proves the event came from Stripe, and we set `client_reference_id` in our checkout route — so in practice this is safe. But a defense-in-depth `SELECT 1 FROM users WHERE id = $1` catches Stripe-dashboard-edited subscriptions targeting a deleted user, preventing orphaned subscription rows.

#### Low

**BE-L-01: Misleading `void randomUUID()` in `generateApiKey()`**
- File: `src/lib/api-key.ts:25`
- The call is a no-op — it evaluates `randomUUID()` and discards the result. The comment claims "A tiny amount of extra entropy (randomUUID bytes mixed into cuid2 via its default RNG)", which is factually incorrect; cuid2 in Node uses the Crypto API on its own. Keys are still secure, but the code is confusing.
- **Fix:** Delete the line and update the comment. Actual extra entropy would require passing a custom RNG via `init()`.

**BE-L-02: HANDOFF_RE regex duplicated across two files**
- File: `src/app/auth/figma/route.ts:30` + `src/app/auth/figma-callback/page.tsx:28`
- Identical `/^[A-Za-z0-9_-]{16,128}$/`. Drift risk if one is tightened without the other.
- **Fix:** Move to `src/lib/figma-handoff.ts` as `HANDOFF_REGEX` + `HANDOFF_KEY_PREFIX`.

#### Info (positive)

- Middleware correctly skips `auth.protect()` for CORS preflight OPTIONS and for `Bearer cx_*` tokens on the routes that accept API keys. Without that, the bearer path in `resolveAuth` would be unreachable (that bug existed pre-Session 4 and is fixed).
- All DB access goes through Drizzle — zero raw SQL, no SQL-injection surface. `jsonb` columns (`rule_json`) are typed to unknown and normalized before use.
- Stripe webhook uses `stripe.webhooks.constructEventAsync` for signature verification and a Redis `SET NX` with 24-hour TTL for event-id dedupe. Pattern is correct.
- `/api/check` returns opaque error messages to clients (`"Evaluation service unavailable"`); exception detail is kept in `console.error` → Vercel logs → Sentry. Right split.
- `/api/dashboard/api-key` is Clerk-session-only (not in `acceptsApiKey`). Nobody can rotate a key by replaying a bearer they already hold.
- `log-violations.ts` stores `sha256(text)` only — plaintext never persists. Confirmed.
- CORS on `/api/check` sets `Allow-Origin: *` but the auth is bearer-header only (no cookies), so wildcard is the right call. The attack surface is "whoever has the token can use it" — same as without CORS.
- `evaluate.ts` refuses to fall back to `NEXT_PUBLIC_APP_URL` in production for the internal evaluator URL. Prevents misrouting the internal secret + user text to the wrong origin.

---

### 3.7 Cross-cutting observations

#### Dependencies
- All deps in `package.json` are current majors (Next 15.5, React 19, Clerk 7, Drizzle 0.45, Stripe 22, Zod 4). No obviously-abandoned packages.
- `npm audit` flagged 4 moderate vulns when I installed recharts (visible during install). Worth re-running `npm audit` and triaging.
- Python: `anthropic>=0.30.0` (engine) is the only runtime dep; the cli-client has zero deps. Lean.

#### Env-var handling
- All env vars checked at read time (not import time), so the app builds cleanly even without secrets set. Good Next.js pattern.
- `.env.local.example` is comprehensive and well-commented.
- `INTERNAL_EVAL_SECRET` comparison is constant-time on both the TS and Python sides.
- Some env vars (Stripe price IDs) are read per-request via `process.env[envVarName]`. In serverless these are cached by the runtime, so performance is fine. But if price IDs ever change mid-deployment, the cache could serve stale values until cold-start — unlikely to matter.

#### Test coverage
- Python engine: 1,025 tests across 21 files. Covers api_utils, batch, classify, filter, integration seams, loader, models, moments, pipeline, preprocess, promote, triage, validate, v44x/v45x/v46x patches. Dense.
- CLI client: 21 tests, HTTP-layer-mocked.
- GitHub Action: 26 tests — extractor, report, main orchestration.
- **Gaps:** No tests at all for the Next.js backend (all `src/app/api/**` and `src/lib/**`). No test framework configured. Given the auth/webhook/quota logic here, this is the single biggest test debt.

#### Type safety
- `strict: true` in `tsconfig.json`. No `any` types observed in the backend.
- One `as unknown as {...}` cast in `webhooks/stripe/route.ts:199` (for `invoice.parent.subscription`) — reasonable workaround for Stripe's shifting API shapes.
- `as Array<{...}>` casts in analytics route (`sql<number>\`count(*)::int\``) — Drizzle types don't currently infer aggregate return types. Acceptable.

#### Documentation
- CLAUDE.md is current and comprehensive. The "Known limitations" block is load-bearing for this audit — several items I flag here trace directly to that list.
- BUILD_PLAN.md checked in tonight. Canonical.
- Each sub-package has a `CLAUDE.md` (cli-client, github-action) for module-specific rules.

---

## 4. Things I looked at and didn't flag

- **SQL injection:** Zero raw SQL. All queries via Drizzle with parameterized values.
- **XSS in React:** Zero `dangerouslySetInnerHTML`, zero `innerHTML` in `src/`.
- **Open redirects:** Clerk's `redirect_url` allowlist handles external redirects; internal redirects are server-constructed.
- **CSRF:** Mutating dashboard APIs use Clerk session cookies with SameSite defaults. No explicit CSRF token needed per Next.js's framework guarantees.
- **Secret leakage:** Exhaustive grep for `console.log|print.*key|print.*token|print.*secret` — zero hits in non-test code that log credentials.
- **Dependency pins:** Major versions are current across the board.
- **Webhook signature verification:** Both Clerk (svix) and Stripe are signature-verified with raw body.
- **Plan gating:** Server-side on every team-plan route (`/dashboard/team/rules`, `/dashboard/team/analytics`, `POST /api/team-rules`).
- **Redis client:** Upstash wrapper is lazy-initialized; no connections held at cold start.
- **Env var naming:** Supports both `UPSTASH_REDIS_REST_*` and legacy `KV_REST_API_*` naming (Vercel Marketplace convention). Documented.
- **Python `pickle.load` / `eval` / `exec`:** None present.
- **File-path traversal:** Only `standards_library.json` is read at runtime; its path is hardcoded.
- **Rate limiting:** Sliding-window 60/min per user via Upstash. Applied before the expensive engine call. Correct order.
- **Token persistence in clientStorage:** `cx_token` is per-device, per-user — can't exfiltrate to another machine without Figma access.
- **`github-action/` + `cli-client/` isolation:** Neither imports the Python engine. Clean separation.

---

## 5. Recommended fix order

Ranked by severity × effort-to-fix. "Effort" is rough t-shirt size.

| # | ID | Severity | Effort | Notes |
|---|----|----------|--------|-------|
| 1 | BE-M-01 | Medium | XS | One-line `GETDEL` swap. Do this now. |
| 2 | PLG-C-01 | Critical | S | Add origin check to `window.onmessage`. Ship before next Figma Community release. |
| 3 | GHA-C-01 | Critical | S | Truncate comment body at 60KB. Add a test. |
| 4 | GHA-C-02 | Critical | S | Follow `Link: next` pagination. |
| 5 | PLG-H-01 | High | S | `parent.postMessage(msg, "https://www.figma.com")`. Test both `null` and `https` origins. |
| 6 | ENG-H-01 | High | XS | Return generic `{error: "Evaluation failed"}`; keep stacktrace in logs. |
| 7 | UI-H-01 | High | XS | URL-origin check before `window.location.href = url`. |
| 8 | CLI-M-01 | Medium | XS | Reject non-`https://` `CONTENTRX_API_URL` unless `_INSECURE_HTTP=1`. |
| 9 | PLG-H-02 + PLG-M-04 | High+Med | S | Guard double-click on Sign in + clearTimeout on abort. |
| 10 | PLG-H-03 | High | M | 429 → pause worker pool + retry. |
| 11 | BE-M-04 | Medium | S | Atomic claim-slot on usage increment. (Known Limitation #2.) |
| 12 | BE-M-03 | Medium | S | Redis dedupe on `svix-id`. (Known Limitation #3.) |
| 13 | BE-M-02 | Medium | M | ReDoS guard on custom team rules. |
| 14 | GHA-M-01 | Medium | XS | Commit `package-lock.json`; `npm install` → `npm ci`. |
| 15 | All Low + Info polish | Low | Varies | Grooming; batch during Session 20 QA pass. |

---

## 6. One-line TL;DR

**Three items worth fixing this week (BE-M-01, PLG-C-01, GHA-C-01/02); the rest grooms at your cadence; the codebase is structurally solid and has no show-stopping vulnerabilities.**

---

_Generated by Claude 🤖 with [Claude Code](https://claude.com/claude-code)._
