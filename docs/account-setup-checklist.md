# Account setup checklist — unblock v2 Session 1

Generated 2026-04-22, end of the v2 Phase 1 + 3 build sprint. The code
side of every integration below is **shipped and inert** — turning each
one on is a matter of creating an account, copying a key into Vercel
env, and (sometimes) doing a one-time DNS step.

Order is cheapest → most setup-work, with prerequisites first. You can
work through it linearly; nothing later depends on something earlier
*structurally* (only on convenience).

---

## 0. Workflow for each step

For every item below:

1. **Create / configure the external account** (per the steps in the
   item).
2. **Set the env vars in Vercel**: production project at
   https://vercel.com/thenewforktimes-projects/content-rx → Settings
   → Environment Variables. Set each to **Production** (and Preview
   if you want it active on PR previews). Existing variables can be
   edited; new ones use "Add."
3. **Redeploy**: pull the new env into prod with
   `cd /Users/rbxnoodle/Desktop/contentRX && vercel --prod --yes`. Or
   trigger a redeploy from the Vercel dashboard. Env vars only take
   effect on the next deploy.
4. **Verify** per the item's "How to test."

---

## 1. Plausible (5 min — easiest win)

**What it unblocks:** `signup` and `upgrade` analytics events that
already fire from the Clerk + Stripe webhooks. Server-side custom
events + browser pageview tracking.

**Steps:**
1. Go to https://plausible.io and sign up (or use your existing
   account).
2. Create a new site. Domain: `content-rx.vercel.app` (use your
   eventual `contentrx.app` once that exists; `content-rx.vercel.app`
   works in the meantime).
3. **Vercel env**: `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=content-rx.vercel.app`
4. Redeploy.

**How to test:** open https://content-rx.vercel.app in an incognito
window → the Plausible dashboard should register a live visit within
30 seconds. Sign up for a new account → after the Clerk webhook
fires, the `signup` event appears under "Goal Conversions."

---

## 2. Sentry (15 min)

**What it unblocks:** every server-side and client-side error gets
captured automatically. Critical to have **before launch traffic** so
you actually see the first crashers instead of guessing.

**Steps:**
1. Go to https://sentry.io and sign up. Create an organization
   (whatever name you want — `contentrx` is sensible).
2. Create a project: **Platform = Next.js**. Sentry will give you a
   DSN immediately.
3. Get an Auth Token: User Settings → Auth Tokens → Create New Token
   → check the `project:releases` and `org:read` scopes.
4. **Vercel env (5 vars):**
   - `SENTRY_DSN` (server-side)
   - `NEXT_PUBLIC_SENTRY_DSN` (client-side; same value as above is
     fine)
   - `SENTRY_AUTH_TOKEN` (the one you just created)
   - `SENTRY_ORG` (your org slug — e.g., `contentrx`)
   - `SENTRY_PROJECT` (your project slug — e.g., `content-rx`)
5. Redeploy.

**How to test:** trigger a deliberate error — easiest path is to hit
a URL that doesn't exist with malformed input, or temporarily throw
in a route. Check the Sentry "Issues" tab — the error should appear
within a minute, with full stacktrace + source-map decoded line.

---

## 3. Resend + `hello@contentrx.app` domain (30 min — DNS waits)

**What it unblocks:** all transactional email — welcome, quota
warning, quota exhausted, subscription confirmation. Templates ship
in `src/emails/`. Without this, the engine logs "would send …" to
console instead of actually sending.

**Steps:**
1. Go to https://resend.com and sign up.
2. **Add the domain** `contentrx.app` (or whichever domain you'll
   send from). Resend gives you DNS records (SPF, DKIM, DMARC).
3. Add those records to your DNS provider (Cloudflare, Namecheap,
   wherever you registered `contentrx.app`). DNS propagation can
   take 15 min – a few hours.
4. Once Resend shows "Verified" next to the domain, generate an
   **API Key** (Settings → API Keys → Create).
5. **Vercel env:**
   - `RESEND_API_KEY=re_...`
   - `EMAIL_FROM=hello@contentrx.app` (already in `.env.local.example`
     with this default; only change if you want a different sender)
6. Redeploy.

**How to test:** sign up for a new account → welcome email should
arrive at the address you signed up with within 30 seconds. If it
doesn't, check Resend's "Logs" tab for delivery errors.

---

## 4. Stripe — products + webhook + 6 env vars (1–2 hr)

**What it unblocks:** the entire paid-tier flow. Pro upgrade, Team
upgrade, billing portal, subscription confirmation email, the whole
revenue path.

**Steps (in this order):**

### 4a. Create the four products

In the Stripe Dashboard → Products:

| Product | Price | Billing | Notes |
|---|---|---|---|
| ContentRX Pro Monthly | $24/mo | recurring monthly | One seat |
| ContentRX Pro Annual | $216/yr ($18/mo equiv) | recurring annually | One seat |
| ContentRX Team Monthly | $35/seat/mo | recurring monthly, **per seat (quantity)** | Min 3 seats |
| ContentRX Team Annual | $29/seat/mo billed annually = $348/seat/yr | recurring annually, per seat | Min 3 seats |

For each, copy the **Price ID** (starts with `price_…`). You'll need
all four.

### 4b. Configure the webhook

Stripe Dashboard → Developers → Webhooks → Add endpoint:
- **URL:** `https://content-rx.vercel.app/api/webhooks/stripe`
- **Events to listen for:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

After creating, copy the **Signing secret** (starts with `whsec_…`).

### 4c. Get the API keys

Stripe Dashboard → Developers → API keys:
- **Publishable key** (starts with `pk_live_…`)
- **Secret key** (starts with `sk_live_…`)

### 4d. Vercel env (8 vars total)

```
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_... (from 4b)
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
STRIPE_PRICE_TEAM_ANNUAL=price_...
```

(`EMAIL_FROM` for the subscription confirmation email is already
covered by step 3.)

### 4e. Redeploy + test

**How to test:**
1. From your account on `/dashboard`, click "Upgrade to Pro" → should
   redirect to Stripe Checkout (not error).
2. Use Stripe's test card `4242 4242 4242 4242` (any future expiry,
   any CVC) — wait, you'll be in live mode, so this won't work.
   Better test path: complete a real $24 transaction with your own
   card, then refund it from the Stripe dashboard immediately.
3. After successful checkout: subscription confirmation email arrives
   (Resend), `users.plan` flips to `pro`, `subscriptions` row gets
   inserted, dashboard shows Pro pill. Stripe webhook log shows
   200 on the events.

---

## 5. Clerk live keys (30 min)

**What it unblocks:** real user accounts. **The current production
deploy uses Clerk's TEST keys** (`pk_test_…`) — every signup goes
through Clerk's dev environment and isn't a real persistent account.
This needs to flip before you launch publicly.

**Steps:**
1. https://dashboard.clerk.com → switch to (or create) the production
   instance.
2. Configure sign-in / sign-up methods to match what's in dev (likely
   email + Google).
3. Get the **production keys**:
   - Publishable key: `pk_live_…`
   - Secret key: `sk_live_…`
4. Configure the **production webhook**:
   - URL: `https://content-rx.vercel.app/api/webhooks/clerk`
   - Events: `user.created`, `user.updated`, `user.deleted`
   - Copy the new signing secret (`whsec_…`)
5. **Vercel env:**
   - `CLERK_SECRET_KEY=sk_live_...`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`
   - `CLERK_WEBHOOK_SECRET=whsec_...` (the new prod one)
6. Redeploy.

**How to test:** open `https://content-rx.vercel.app/sign-up` in a
fresh browser → the sign-in/up widget should NOT redirect to
`great-redfish-54.clerk.accounts.dev` (that's the dev-instance
hostname). Sign up with a real email → user appears in the Clerk
production dashboard's Users list, AND in your Supabase `users`
table via the webhook.

---

## 6. docs.contentrx.app — second Vercel project (15 min)

**What it unblocks:** the spec site. The code is at `docs-site/` in
the same repo, ready to build (57 SSG pages, all 47 standards).

**Steps:**
1. https://vercel.com/new → **Import** the same repo
   (`thenewforktimes/contentRX`).
2. **Project name:** `contentrx-docs` (or whatever).
3. **Root Directory:** `docs-site/` (this is the critical setting —
   without it Vercel tries to build the main app from the repo root).
4. **Framework Preset:** Next.js (autodetected once the root dir is
   set).
5. **Environment variables:** none required.
6. Deploy.
7. Once it's live, **add a custom domain**: Vercel project Settings →
   Domains → `docs.contentrx.app`. Vercel gives you a CNAME record;
   add it at your DNS provider.

**How to test:** `curl https://docs.contentrx.app/spec/standards/CLR-01`
returns the rendered standard page. The sidebar should list all 9
categories + 47 standards.

---

## 7. GitHub Action to Marketplace (longer — own track)

**What it unblocks:** any engineering team can drop ContentRX into
their `.github/workflows/`. Today the action lives in-tree at
`github-action/`; it has to move to its own public repo to publish.

**Steps:**
1. Create a new public repo: `github.com/contentrx/contentrx-action`
   (or `github.com/<your-handle>/contentrx-action` if you don't have
   the contentrx org yet).
2. Copy the contents of `github-action/` from this repo into the
   root of the new one (action.yml, Dockerfile, src/, tests/, README,
   LICENSE, CLAUDE.md).
3. Create a release tag (`v1`, `v1.0.0`).
4. From the GitHub Releases page, check **"Publish this Action to
   the GitHub Marketplace."** Pick a category (`Code quality` or
   similar), pick the icon (already set in action.yml), publish.
5. Test against an external repo: add `uses: contentrx/contentrx-action@v1`
   to a workflow with `CONTENTRX_API_KEY` in repo secrets, open a
   test PR, verify the comment posts.

---

## 8. Iubenda privacy policy (deprioritized — your call)

You previously deprioritized Session 5 (landing page + legal). If
you launch publicly without a privacy policy, that's a real
compliance risk. Iubenda's standard plan is fine for this scale.
Embed the policy at `/privacy` and link from the footer.

---

## What I (Claude) can do once each step is done

When you finish each item and let me know, I can:

| After step | I can verify / wire |
|---|---|
| Plausible | Curl-check pageview registers; verify signup goal fires after a dummy webhook trigger |
| Sentry | Trigger a deliberate prod error and confirm Sentry shows it |
| Resend | Send a test email via the API; verify welcome arrives end-to-end |
| Stripe | Walk a real upgrade flow; verify subscription row + plan flip + email |
| Clerk live | Verify the prod hostname is no longer the dev `great-redfish-…`; check webhook |
| docs.contentrx.app | Confirm DNS resolves; smoke-test routing |
| GH Action | Smoke-test the published action against a sample repo |

You don't have to wait for me — knock them out in any order. When
you're done, say "all set" and I'll do a comprehensive prod
verification pass.

---

## Quick ref — Vercel env var summary

Total new env vars across all integrations: **15** (counting from a
fresh Vercel project state).

```
# Plausible (1)
NEXT_PUBLIC_PLAUSIBLE_DOMAIN=content-rx.vercel.app

# Sentry (5)
SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_AUTH_TOKEN=sntrys_...
SENTRY_ORG=contentrx
SENTRY_PROJECT=content-rx

# Resend (1; EMAIL_FROM has a working default)
RESEND_API_KEY=re_...

# Stripe (7)
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
STRIPE_PRICE_TEAM_ANNUAL=price_...

# Clerk live keys — REPLACE the existing pk_test_/sk_test_ values, plus rotate webhook secret
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_WEBHOOK_SECRET=whsec_...
```
