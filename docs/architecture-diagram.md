# ContentRX architecture & flows

Snapshot: 2026-04-22, after Sessions 1–17, 13, 19 + audit waves 1–3 + npm audit + .vercelignore hotfixes.

## Legend

- 🟢 **Live in prod and working** — code shipped, env vars set, end-to-end functional
- 🟡 **Code-ready, inert** — code merged + deployed, but waiting on you to provision env vars / external accounts
- 🔴 **Future** — not started, in BUILD_PLAN or out of scope

---

## 1. System architecture — services + integrations

```mermaid
graph TB
    subgraph "Client surfaces"
        FP["Figma Plugin<br/>(figma-plugin/ui.html)<br/>🟢"]
        CLI["CLI client<br/>(contentrx-cli on PyPI)<br/>🟢"]
        GHA["GitHub Action<br/>(github-action/, in-tree)<br/>🟡 needs Marketplace publish"]
        WEB["Web browser<br/>(landing + dashboard)<br/>🟢"]
        DOC["docs.contentrx.app<br/>(docs-site/)<br/>🟡 needs separate Vercel project"]
    end

    subgraph "Vercel — content-rx.vercel.app"
        MW["Clerk Middleware<br/>(src/middleware.ts)"]
        NXT["Next.js API routes<br/>/api/check, /api/checkout,<br/>/api/portal, /api/team-rules,<br/>/api/team-analytics, /api/dashboard/*,<br/>/api/webhooks/clerk, /api/webhooks/stripe<br/>🟢"]
        PY["Python eval function<br/>api/evaluate.py<br/>🟢 internal only<br/>(gated by INTERNAL_EVAL_SECRET)"]
    end

    subgraph "Data layer"
        PG[("Supabase Postgres<br/>users, usage, subscriptions,<br/>team_members, team_rules,<br/>violations, ditto_syncs<br/>via Drizzle ORM<br/>🟢")]
        RDS[("Upstash Redis<br/>rate limit · webhook dedupe ·<br/>email dedupe · figma handoff<br/>🟢")]
    end

    subgraph "External services — 🟢 live"
        CK["Clerk v7<br/>(test keys in prod ⚠)"]
        AN["Anthropic API<br/>(LLM evaluator)"]
    end

    subgraph "External services — 🟡 wired, awaiting env vars"
        ST["Stripe<br/>(products + webhook +<br/>6 env vars TODO)"]
        RS["Resend<br/>(API key + verify<br/>hello@contentrx.app)"]
        SN["Sentry<br/>(DSN + auth token<br/>+ org/project)"]
        PL["Plausible<br/>(register site +<br/>NEXT_PUBLIC_PLAUSIBLE_DOMAIN)"]
    end

    subgraph "External services — 🔴 future"
        DT["Ditto API<br/>(Session 18, encrypted key storage)"]
    end

    %% Client → Vercel
    FP -- "POST /api/check<br/>Bearer cx_<token>" --> MW
    CLI -- "POST /api/check<br/>Bearer cx_<token>" --> MW
    GHA -- "POST /api/check<br/>Bearer cx_<token>" --> MW
    WEB -- "Cookies (Clerk session)" --> MW
    MW -- "auth.protect() OR<br/>pass through if Bearer cx_" --> NXT

    %% Vercel internals
    NXT -- "POST /api/evaluate<br/>x-internal-secret" --> PY
    NXT -- "Drizzle queries" --> PG
    NXT -- "GET/SET/GETDEL" --> RDS
    PY -- "messages.create" --> AN

    %% Auth
    NXT -- "auth() / clerkClient()" --> CK
    CK -. "user.created/updated/deleted<br/>webhook" .-> NXT

    %% Billing
    NXT -- "checkout.sessions.create<br/>billingPortal.sessions.create" --> ST
    ST -. "checkout.session.completed<br/>customer.subscription.*<br/>invoice.payment_failed" .-> NXT

    %% Email
    NXT -- "resend.emails.send" --> RS

    %% Analytics
    NXT -- "trackEvent (server)" --> PL
    WEB -- "pageview script" --> PL

    %% Errors
    NXT -- "captureException" --> SN
    WEB -- "captureException + replays" --> SN

    %% Future
    NXT -. "encrypted key,<br/>sync component scans" .-> DT

    %% Docs site
    DOC -. "reads<br/>standards_library.json<br/>at build time" .-> PG

    classDef live fill:#d1fae5,stroke:#059669,color:#065f46
    classDef inert fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef future fill:#fee2e2,stroke:#dc2626,color:#991b1b
    classDef vercel fill:#e5e7eb,stroke:#374151,color:#1f2937

    class FP,CLI,WEB,PG,RDS,CK,AN,NXT,PY live
    class GHA,DOC,ST,RS,SN,PL inert
    class DT future
    class MW vercel
```

---

## 2. Flow — individual (Free) user, sign-up → first scan

What happens when a brand new user signs up and runs their first scan from the Figma plugin.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant W as Web browser
    participant CK as Clerk
    participant NXT as Next.js API
    participant PG as Postgres
    participant RDS as Redis
    participant RS as Resend 🟡
    participant FP as Figma plugin
    participant PY as Python eval
    participant AN as Anthropic

    rect rgb(245, 245, 245)
        Note over U,RS: Sign-up + welcome
        U->>W: visit content-rx.vercel.app
        W->>CK: redirect to /sign-up
        U->>CK: complete sign-up
        CK->>NXT: webhook user.created (svix-signed)
        NXT->>RDS: SET NX svix-id (dedupe)
        NXT->>PG: INSERT users (clerkId, email, plan='free')
        NXT-->>RS: sendEmail(WelcomeEmail)
        NXT-->>NXT: trackEvent('signup')
    end

    rect rgb(245, 245, 245)
        Note over U,RDS: API key + plugin sign-in
        U->>W: open /dashboard
        W->>NXT: POST /api/dashboard/api-key
        NXT->>PG: UPDATE users SET api_key_hash=sha256(cx_...)
        NXT-->>W: returns raw cx_token (shown ONCE)
        U->>FP: opens plugin, clicks Sign in
        FP->>NXT: GET /auth/figma (generates handoff code)
        NXT->>RDS: SET handoff:<code> "" EX 5min
        NXT-->>FP: returns handoff URL
        FP->>U: opens browser to /auth/figma-callback?handoff=<code>
        U->>NXT: lands on callback (already auth'd)
        NXT->>PG: lookup or rotate api_key_hash
        NXT->>RDS: SET handoff:<code> <cx_token>
        FP->>NXT: poll /auth/figma?poll=1&handoff=<code>
        NXT->>RDS: GETDEL handoff:<code> (atomic, single-use)
        NXT-->>FP: returns cx_token
        FP->>FP: store in figma.clientStorage
    end

    rect rgb(245, 245, 245)
        Note over U,AN: First scan — the hot path
        U->>FP: select frame, click "Scan page"
        FP->>NXT: POST /api/check<br/>Authorization: Bearer cx_...
        NXT->>NXT: Clerk middleware: pass through (Bearer cx_)
        NXT->>PG: SELECT user WHERE api_key_hash=sha256(cx_)
        NXT->>RDS: ratelimit check (60/min sliding)
        NXT->>PG: claimQuotaSlot (atomic UPSERT WHERE count<25)
        NXT->>PY: POST /api/evaluate<br/>x-internal-secret
        PY->>PY: classify(text) → content_type, moment
        PY->>PY: preprocess (25 instant checks)
        PY->>AN: messages.create (LLM scan)
        AN-->>PY: violations
        PY->>PY: validate + merge
        PY-->>NXT: { violations, content_type, moment }
        NXT->>PG: INSERT violations (sha256(text), no plaintext)
        alt remaining ≤ 5
            NXT-->>RS: sendEmail(QuotaWarning, dedupe per month)
        end
        NXT-->>FP: { result, usage: {used, quota, remaining} }
        FP->>U: render verdict cards
    end

    rect rgb(255, 240, 240)
        Note over U,RS: When quota exhausted
        U->>FP: scan again at 25/25
        FP->>NXT: POST /api/check
        NXT->>PG: claimQuotaSlot → rejected (count == quota)
        NXT-->>RS: sendEmail(QuotaExhausted, dedupe per month)
        NXT-->>FP: 402 + upgrade_url
        FP->>U: show "Upgrade to Pro" banner
    end
```

---

## 3. Flow — Team-tier customer, shared quota + custom rules

What changes once an admin upgrades to Team and configures rules.

```mermaid
sequenceDiagram
    autonumber
    participant ADM as Team owner
    participant ST as Stripe 🟡
    participant NXT as Next.js API
    participant PG as Postgres
    participant MEM as Team member
    participant FP as Figma plugin
    participant PY as Python eval
    participant AN as Anthropic

    rect rgb(245, 245, 245)
        Note over ADM,PG: Team upgrade
        ADM->>NXT: POST /api/checkout {plan:team, seats:5}
        NXT->>ST: checkout.sessions.create<br/>(client_reference_id=user.id)
        ST-->>ADM: redirect to checkout.stripe.com
        ADM->>ST: complete payment
        ST->>NXT: webhook checkout.session.completed
        NXT->>PG: INSERT subscriptions (plan='team', seats=5)
        NXT->>PG: UPDATE users SET plan='team' WHERE id=owner
        NXT-->>NXT: send SubscriptionConfirmation + trackEvent('upgrade')
    end

    rect rgb(245, 245, 245)
        Note over ADM,PG: Configure team rules
        ADM->>NXT: POST /api/team-rules {action:'disable', standard_id:'CLR-01'}
        NXT->>PG: INSERT team_rules (action='disable')
        ADM->>NXT: POST /api/team-rules {action:'add', rule_json:{pattern:'\brevolutionary\b', ...}}
        NXT->>PG: INSERT team_rules (action='add', rule_json)
        Note right of PG: Now applies to every<br/>team member's scans
    end

    rect rgb(245, 245, 245)
        Note over MEM,AN: Team member runs a scan
        MEM->>FP: scan a frame
        FP->>NXT: POST /api/check (Bearer cx_<member-token>)
        NXT->>PG: SELECT user → finds member<br/>team_owner_user_id = owner.id
        Note right of NXT: Quota = 5000 × seats (5)<br/>= 25,000 SHARED across team
        NXT->>PG: claimQuotaSlot for OWNER's user.id
        NXT->>PG: SELECT team_rules WHERE team_owner_user_id=owner.id
        NXT->>PY: POST /api/evaluate
        PY-->>NXT: raw evaluation result
        NXT->>NXT: applyDisabledFilter (strip CLR-01)
        NXT->>NXT: applyOverrides (rewrite display fields)
        NXT->>NXT: applyAddedRules (regex match custom rule)
        NXT->>NXT: recomputeVerdict
        NXT->>PG: INSERT violations (team_id=owner.id, sha256(text))
        NXT-->>FP: filtered/augmented verdict
    end

    rect rgb(245, 245, 245)
        Note over ADM,PG: Team analytics
        ADM->>NXT: GET /api/team-analytics?range=30d
        NXT->>PG: SELECT FROM violations WHERE team_id=owner.id<br/>GROUP BY standard_id, day, member_user_id
        NXT-->>ADM: { by_standard, by_day, by_member }
    end
```

---

## 4. What's blocking which flow

If you treat each flow above as a "real product moment" the user has to land, here's what gates each one right now:

| Flow / moment | Blocked on |
|---|---|
| Sign-up + welcome email arrives | Resend API key + verified `hello@contentrx.app` domain |
| Sign-up registers as Plausible goal | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` set in Vercel env |
| Server crashes show in Sentry | `SENTRY_DSN` + 4 other Sentry env vars in Vercel env |
| First scan from plugin → result back | ✅ already works in prod (Anthropic key is set) |
| Quota warning + exhausted emails | Resend (same as welcome) |
| Upgrade to Pro / Team | Stripe products + webhook + 6 env vars |
| Subscription confirmation email | Stripe ✅ + Resend |
| Team invite + invite acceptance | Invite flow not built (no PR exists yet) |
| Team rules + analytics | ✅ already works |
| CLI auth + scan | ✅ ships on PyPI; user pastes cx_token from dashboard |
| GitHub Action posts PR comments | Action needs to be split to its own public repo + Marketplace publish |
| Real users (not Clerk test instance) | Clerk live keys (`pk_live_...` / `sk_live_...`) + new webhook secret |
| docs.contentrx.app | New Vercel project, `Root directory: docs-site/`, bind domain |
| Ditto integration | Session 18 — not started |

---

## 5. Suggested order to unblock

Roughly cheapest → most setup work, and prerequisites first:

1. **Plausible** (5 min) — register site, set 1 env var. Frees up signup/upgrade event tracking.
2. **Sentry** (15 min) — create project, set 5 env vars. Critical *before* live traffic.
3. **Resend** (30 min — DNS waits) — verify `hello@contentrx.app`, set 1 env var. Unlocks all 4 active email templates.
4. **Stripe** (1–2 hr) — create 4 products, configure webhook, set 6 env vars. Unlocks payments + subscription email + Team flow.
5. **Clerk live keys** (30 min) — production instance + new webhook. Switches off the test publishable key.
6. **docs-site Vercel project** (15 min) — second Vercel project, root = docs-site/. Goes live.
7. **GitHub Action repo split + Marketplace** (longer) — separate public repo, publish.
8. **Ditto** — Session 18, when you have a Ditto account.

After 1–5 you have a fully working free + paid product. After 6–7 the distribution story is complete.
