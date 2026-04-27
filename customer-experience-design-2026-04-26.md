# Customer experience design — thinking through it together

**Date:** 2026-04-26
**Companion to:** `design-critique-2026-04-26.md` (which audited what's there). This one is forward-looking — what should the customer experience become.

You said you're figuring out how to fly the plane as you build it. Good. That's the right mode for this stage. Below is my take on the five things you raised, with a sixth I think you're underweighting (#0).

---

## 0. Before anything else: define a "check"

You can't price the product, design the dashboard, or write the install copy until this question has a single answer. Right now it doesn't.

Here's what I found in the source:

- `POST /api/check` evaluates **one string** per call.
- The Figma plugin fans out **one /api/check per text node** in a frame (the comment on line 932 of `ui.html` says it explicitly: *"/api/check evaluates one string per call, so we don't batch multiple"*).
- The MCP tool `evaluate_copy` is one string per call.
- The CLI's `--batch strings.txt` makes N calls.
- The GitHub Action evaluates each touched string in a PR.
- LSP diagnostics fire per string as you type.
- The current quota is `free: 25, pro: 5000, team: 5000/seat` — labeled "scans" in the dashboard.

So today's reality: **a "scan" in the dashboard means one string evaluated, but a "scan" in the Figma plugin UI means a whole frame, which actually consumes 5–50 quota slots invisibly.** A designer on the free tier hits the wall before they finish their first real frame. They don't understand why. They think your product is broken or stingy. They leave.

**The fix is to stop calling it a scan.** Pick one word that means "one string evaluated by the engine" and use it everywhere. My pick:

> **Check.** It's what the API endpoint is named. It's what the action is. It scales linearly with cost. It survives across all five surfaces.

Then every surface tells the user the truth about how many checks an action will cost:

- Figma: *"Scan this frame → 23 checks"* before they confirm.
- CLI: `contentrx scan ./src` returns *"Found 47 strings. Run all 47 checks? [Y/n]"*
- MCP: each `evaluate_copy` call is 1 check; the LLM client narrates it inline.
- LSP: each save triggers diagnostics on N changed strings; status bar shows "checks today: 38."
- GitHub Action: PR comment opens with *"This PR introduced 12 new strings. 12 checks consumed."*

Once "check" is the unit, everything else gets easier.

---

## 1. Sign-up — what you might be missing

The mechanics are fine: Clerk handles email verification, password rules, OAuth (if you've enabled it — check), and the webhook lazily provisions the row in `users`. No security gap I'd flag.

What's missing isn't security, it's **onboarding intent**. After sign-up, the customer lands on `/dashboard`, sees email + plan pill + usage bar at zero + an empty API key panel + four collapsed cards for team features they probably don't have. There's no welcome, no surface picker, no first-check moment, no "here's what 25 free checks gets you."

Six things I'd add to the sign-up flow, in order of impact:

1. **Surface picker as the first post-signup screen.** "Where do you want to use ContentRX?" — five large cards: MCP / LSP / CLI / GitHub Action / Figma. Their pick determines what they see next: tailored install instructions, a tailored sample call, a tailored "you're done" success state. Right now everyone sees the engineer-flavored install page regardless of why they signed up.

2. **First-check moment in the dashboard.** `/dashboard/explain` already exists — it's the interactive paste-a-string-see-the-verdict page. Promote it to be the centerpiece of the signed-in dashboard for users with zero usage. *"Try a check before you install — paste any UI string."* Stripe-style: make them touch the product before they wire it up. This is the single biggest unlock for understanding.

3. **Quota expectations set explicitly.** A plain-language "you have 25 checks this month — about one Figma frame, or a couple dozen MCP calls" lives at the top of the dashboard. The current usage bar shows `0 of 25` with no context for what 25 means.

4. **Welcome email via Resend** with the API key (or a deep link to mint one), the install-page link tailored to their picker choice, and a calendar reminder for their quota reset. You have Resend wired; this should be a one-day project.

5. **Sign-up path provenance.** If the user landed at sign-up from `/install#figma`, default the surface picker to Figma. If they hit the GitHub Action listing, default to GitHub Action. The path tells you what they came for.

6. **Detect corporate emails and offer a Team trial.** A user signing up with an `@stripe.com` address gets a "want to try the Team plan free for 14 days?" inline upsell. Personal emails skip this. This is a 50% lift on Team conversions in dev tools historically.

What I'd *not* do at sign-up: ask for credit card. ContentRX is a "see the value first" sale. Card walls before value-demonstration kill conversion in this category.

---

## 2. Freemium tier — what does 25 checks really get you?

Not enough to fall in love with. Here's the actual math:

| Use case | Strings per session | Sessions in 25 checks |
|---|---|---|
| Designer scans one Figma frame | 5–50 | 0–5 |
| Engineer in MCP during a feature | 5–30 | 1–5 |
| PR check via GitHub Action (small PR) | 3–15 | 1–8 |
| PR check via GitHub Action (typical PR) | 10–40 | 0–2 |
| CLI exploring | 1–3 per command | 8–25 |
| LSP "as I type" (one editing session) | 20–100 | 0–1 |

For a designer (the persona Figma is targeting), **25 checks is one frame**. They run the scan, hit the wall mid-frame, and never see the second half of the verdicts. That's not freemium — that's a demo with a paywall in the middle of the demo.

For an engineer using MCP casually, 25 checks is a single light coding session. Same problem.

**My recommendation:**

> **Free: 250 checks/month, hard cap.**

That number is roughly:
- 5–10 Figma frames per month, OR
- A week of moderate MCP usage, OR
- 10–20 PRs gated by the Action

Enough to commit to the workflow. Not enough to ship a paid product on top of. Hard cap (no overage) so you don't accidentally subsidize someone running you in CI for free.

The leverage of 250 over 25 is asymmetric: 25 says "we tolerate you trying us." 250 says "we want you to actually use us." The marginal LLM cost on an extra 225 checks for a casual user is small — the conversion lift on an extra 225 checks is large.

**Possible variant I'd consider:** different free quotas per surface, with a global cap. Something like "Figma: 100 strings/month, MCP+CLI+LSP+Action share 250." This acknowledges that the Figma user is a different cost profile (higher per-action, lower frequency) than the IDE user (lower per-action, higher frequency). But it's also more confusing to communicate. Probably not worth the complexity unless cohort data tells you so. Start with the simple flat cap.

---

## 3. Membership tier — $29/mo

The structural question first: **what changes between Free and Pro besides the quota?** Right now (per the dashboard code I read), almost nothing. That's the wrong shape. Pro at $29 needs to feel like a different product, not a bigger free tier.

My take on what each plan unlocks:

| | Free | Pro $29 | Team $99/seat (or whatever) |
|---|---|---|---|
| Checks/month | 250 | 5,000 | 25,000 per seat, pooled across team |
| Overage | None — hard cap | $0.005/check, soft cap configurable | $0.003/check, soft cap configurable |
| Surfaces | All 5 (don't gate surfaces — they're how customers find you) | All 5 | All 5 |
| `/dashboard/explain` interactive demo | Yes | Yes | Yes |
| Override history visible in dashboard | Last 10 | Last 100 | Unlimited |
| Saved scan history (last N verdicts) | None | Last 50 | Unlimited |
| Calibration prompts (the weekly judgment thing) | Optional | Optional | Optional + team-shared scoring |
| Team rules / disabled standards | — | — | ✓ (already gated) |
| Custom examples (team_custom_examples) | — | — | ✓ (already gated) |
| Team analytics | — | — | ✓ (already gated) |
| Override report by member | — | — | ✓ (already gated) |
| SSO (when it exists) | — | — | ✓ |
| Audit log | — | — | ✓ |

The principle: **free is "I tried it and I get it." Pro is "I use it daily without thinking about quota." Team is "my organization runs it as policy."**

### On usage-based pricing

You asked: should the product be usage-based?

Pure usage-based is wrong for ContentRX. Here's why: the value of the product is per-project, not per-call. A team that integrates ContentRX into PR checks shouldn't be punished for being thorough. A designer who scans every frame shouldn't be charged more for caring more. Usage-based pricing creates the "should I run this check?" hesitation, and that hesitation is exactly the friction you don't want — you want them to run it always, everywhere, by reflex.

But pure flat-rate is also wrong because some power users *will* exhaust 5,000 checks (e.g. heavy LSP-on-save users, large-PR-heavy teams), and you don't want them ratcheting back to stay under the cap.

The right shape is **tiered quota with cheap, capped overage**. The customer sets a soft cap (default $50/mo on Pro, $200/mo on Team) and gets warning emails at 80%/100% of quota and 80%/100% of soft cap. The hard cutoff is the soft cap, not the quota — so a heavy month doesn't stop work, it just shows up on the bill, predictably and with their consent.

This solves three things simultaneously:
- Predictability for the customer (they set the ceiling)
- No work-stoppage from a surprise spike
- No unbounded LLM cost for you

Stripe sells metered billing as a primitive, by the way — you don't have to build the meter UI. Use Stripe Metered Billing for the overage and let the Customer Portal handle the cap configuration.

---

## 4. The MCP shift changes what the web app *is*

This is the part I think you're underweighting. When the product was "Figma plugin + dashboard," the dashboard was where verdicts lived — you'd review violations, accept or dismiss, manage the team rules. The dashboard was the work surface.

Now the headline surfaces are MCP/LSP/PR. Verdicts happen in Claude Code, in VS Code, in PR comments. The customer never opens the web app to see a verdict. **The dashboard's job changes — and the current dashboard hasn't caught up.**

Here's the new job, ordered by what the customer is here for:

1. **Integration health.** Is my key working? When did each surface last call the API? If a surface stopped calling, why? (404 from the LSP server, expired token from the MCP client, etc.) This is the first thing a returning user wants to know.

2. **Try a check.** The `/dashboard/explain` flow. For new users it's onboarding; for ongoing users it's a "let me sanity-check this one string" tool. Always one click away.

3. **Usage and quota.** Checks this month, broken down by surface. *"3,847 of 5,000 — heaviest source: GitHub Action (2,109)."* Forecast: *"At current rate you'll hit quota on April 24."*

4. **Insights — what's the engine telling me about my product copy?** *"Top 3 standards firing this week. Standard X has a high override rate — your team disagrees with it more often than average."* This is the part that converts users from "I check things sometimes" to "I rely on this."

5. **Subscription / billing.** Plan, period, manage in Stripe Portal.

6. **Team management** (Team plan only). Members, rules, custom examples, analytics. This is the part that resembles the current dashboard.

The order is the inversion of the current dashboard, which puts subscription/billing third and the API key fourth. Reverse it. Your customer is here to integrate and to learn what the model is telling them about their product. Not to manage their billing — Stripe Portal does that.

### Concrete redesign sketch for `/dashboard`

```
┌──────────────────────────────────────────────────────┐
│  Hi Robo                                  [Pro · $29]│
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │ Try a check                                  │    │
│  │ [paste any UI string here       ] [Check]    │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Your API key │  │ This month    │                 │
│  │ cx_a1b2... ✓ │  │ 3,847 / 5,000 │                 │
│  │ [Rotate]     │  │ ▰▰▰▰▰▰▱▱     │                 │
│  └──────────────┘  └──────────────┘                 │
│                                                       │
│  Active surfaces                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ MCP      │ │ LSP      │ │ Action   │ │ Figma  │  │
│  │ ● now    │ │ ● 2m ago │ │ ● 1h ago │ │ ○ 3d   │  │
│  │ 1,234 ✓  │ │   892 ✓  │ │   612 ✓  │ │  47 ✓  │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘  │
│                                                       │
│  This week                                           │
│  ─ 47 violations · 3 review-recommended              │
│  ─ Top standard firing: ACT-01 (12×)                 │
│  ─ Most-overridden: VT-05 (5/8 dismissed)            │
│  [Open insights →]                                   │
│                                                       │
│  Subscription · Stripe Portal →                      │
└──────────────────────────────────────────────────────┘
```

The "active surfaces" row is the most important new pattern. It tells the user at a glance whether their integrations are alive. It also surfaces the cross-surface insight you can only deliver because all 5 surfaces share one quota and one API key.

---

## 5. The verdict UX — what makes "actionable insights" actually actionable

You said: *"They scan thing and get actionable insights that let them discern how to make their content better. This includes a recommendation on every scan."*

Per `CLAUDE.md`, the public Violation envelope is `issue`, `suggestion`, `severity`, `confidence`. That's the right surface. What makes it *actionable* is the framing around it. Here's what each surface should render:

### Common envelope (every surface renders these in some form)

- **Verdict** — pass / review_recommended / violation. Color-coded, top of the result.
- **Issue** — what's wrong, in plain language. ("Generic action verb — 'Submit' doesn't tell the user what happens next.")
- **Suggestion** — concrete rewrite. ("Try 'Request access' — describes the result of pressing the button.")
- **Diff view** — original next to suggestion, character-level diff highlighted. Don't make the user mentally diff.
- **Severity badge** — `high` / `medium` / `low`.
- **Confidence indicator** — only when it's interesting (e.g. low confidence triggers a "this might be wrong, here's why" callout).

### Per surface, the differentiation

**MCP / Claude Code / Cursor:**
The LLM client renders the tool response. The narration matters. Today the MomentBanner says *"I noticed this looks like destructive_action"* and links to docs.contentrx.io — that leaks the private taxonomy and that link goes to a docs site that may not exist as such yet. Better:

> **Issue:** "Are you sure?" doesn't name the consequence.
> **Suggestion:** "Delete this project? You'll lose 47 documents and 12 collaborators."
> **Why:** Destructive-action confirmations should name what specifically gets destroyed.
> **Confidence:** High.

The "why" line is the model's voice without exposing the standard ID. That's the right level of detail for a customer surface.

**LSP / VS Code / Cursor:**
- Squiggle on the offending string (yellow = review, red = violation).
- Hover shows: issue + suggestion + diff + "apply this fix" code action.
- One keystroke applies the suggestion. (This is where IDE LSPs win — the fix is one keystroke away, not a copy-paste.)

**GitHub Action / PR comment:**
- One sticky PR comment, updated on every push.
- Grouped by file, then by severity.
- Each finding shows file:line, the original string in a code block, the issue, the suggestion as a code block (so the diff renders nicely in GitHub UI).
- Footer: *"47 strings checked · 3 violations · 2 review-recommended · view full report on dashboard →"* (and the dashboard link goes to a per-PR page that survives the PR being closed).

**Figma:**
- Per-string verdict cards in the side panel.
- Click a card → zoom to that text node in the canvas.
- Three-button stance per finding (Agree / Disagree / Ship anyway) — already exists.
- Apply suggestion writes the new text directly into the Figma node.

**CLI:**
- Default render: one line per finding, pass/review/violation icon, file:line if applicable, issue + suggestion truncated.
- `--explain` expands the rationale (without leaking standard IDs).
- `--json` emits the raw API response.
- Exit codes: 0 if all pass, 1 if any review_recommended, 2 if any violation. Pipelines gate on these.

### The repo-wide scan question specifically

You asked: *"What happens if they point the scan at an entire repo? That counts as one scan?"*

It counts as **N checks** — one per string the engine evaluates. But the customer-facing UX needs to make this visible *before* they pull the trigger.

The pattern should be **dry-run-first**, like git or terraform:

```
$ contentrx scan ./src
Scanning ./src for translatable strings...
Found 1,247 strings across 184 files.

This will consume 1,247 checks. Your remaining quota: 3,153 / 5,000.

Estimated cost: ~$2.40 if you exceed quota (overage at $0.005/check).
Estimated time: ~6 minutes.

Run all 1,247 checks? [y/N]
```

Same pattern in Figma (*"Scan page → 312 strings detected, scan all? Yes / No / Just selection"*) and in the GitHub Action (configure a `max-checks` per PR with a sensible default, fail-soft above that with a "PR too large for full scan, scanned first 200 strings" comment).

Three principles for high-volume scans:
1. **Show the count before you run.** No surprise quota drains.
2. **Stream results as they come.** A 1,247-string scan should render results progressively, not block for 6 minutes and then dump everything.
3. **Group results by severity.** A pile of 47 violations + 200 review-recommended + 1,000 passes should land sorted "violations first, then review, then a collapsed 'passed' summary."

### Pattern callouts (the model getting helpful, not just judgmental)

Per-finding feedback is good. **Cross-finding pattern feedback is what makes the product feel like a designer.** Examples:

> *"You've hit ACT-01 (generic verbs) on 4 buttons in this PR. Want to see all 4?"*
>
> *"This is the third destructive confirmation today that doesn't name what's being destroyed. Pattern across your team this week."*
>
> *"Standard VT-05 fires often on your team but gets overridden ~60% of the time. Consider disabling it in team rules."*

These callouts live in the dashboard's "Insights" panel and surface as inline nudges in MCP/LSP. They're the moat showing up in the customer's experience.

---

## 6. Onboarding flow as a wireframe

Putting it all together, here's the journey:

1. **Land on `/`.** Hero: *"The content model for product copy."* CTA: "Try it free →"
2. **Sign up via Clerk.** Email + password (or OAuth). 30 seconds.
3. **Surface picker.** *"Where do you want to use ContentRX?"* Five cards. Their choice routes to step 4.
4. **First check.** A pre-filled string in `/dashboard/explain` based on their picker choice (designer → button label, engineer → error message). They hit Check, see the verdict, see the rationale.
5. **Generate API key.** One click after the first check. *"Now connect your [Figma | editor | repo]:"* tailored install instructions render below.
6. **Confirmation.** When their first real call comes in (from MCP, LSP, etc.), the dashboard lights up: *"You're connected. First call from MCP just landed."* Ideally with a Plausible event so you can measure activation.
7. **Quota expectation set.** Email at 50% quota: *"You've used 125 of 250 free checks this month. Here's what you've found:"* with the top 3 violations and a soft Pro upsell.
8. **Upgrade prompt.** At 100% quota: dashboard banner *"Quota hit — checks paused until [reset date]. [Upgrade to Pro $29 →]"*. Don't black-bar the dashboard; let them keep using `/dashboard/explain` (cap that path at 5/day for free even at quota = 0 so they can keep evaluating).

Specific moments where the experience can feel like a *content designer* built it (because one did):

- The empty state of the dashboard before the first check uses the same voice as the product itself: *"Nothing to show yet — you haven't checked anything. Try one above."* Not *"No data."*
- The quota-hit message names the actor and names the next action: *"You've used your 250 free checks for April. Resets May 1, or upgrade for 5,000/mo."* Not *"Quota exhausted."*
- The "first call from MCP just landed" notification is in your voice: *"Nice — your first MCP call just came through. ContentRX is wired up."* Not *"Integration successful."*

ContentRX is the rare product where the marketing copy and the empty states and the error messages can themselves be a demo of the value prop. Use that.

---

## Summary of decisions you can make this week

1. **Rename "scans" to "checks" everywhere** — engine stays the same, vocabulary shifts. One PR.
2. **Bump free quota from 25 to 250** — one number change in `quotas.ts`. Update any copy that says "25."
3. **Wire up Pro and Team to actually feel different** — saved history, override visibility, calibration prompts, etc. Multi-PR but each one is small.
4. **Build the surface picker** as the first post-signup screen. One page, five cards, redirect to tailored install. ~1 day of work.
5. **Promote `/dashboard/explain` to the dashboard** as the "Try a check" inline panel. Move the API key panel to the side. ~1 day.
6. **Add per-surface activity row** to the dashboard (MCP / LSP / Action / Figma cards with last-call-time). Requires logging "source" on each check (already in the schema — `source` enum on the check request). ~1 day to build the query, ~1 day for the cards.
7. **Add the dry-run pattern** to the CLI and the Figma plugin. *"Scan this → N checks. Continue?"* This single pattern eliminates 80% of "I burned my quota" complaints.
8. **Hybrid quota + cheap overage with soft cap** via Stripe Metered Billing. ~1 week of work but unblocks the upgrade story for power users.

If you can ship 1, 2, 4, 5 in a week the customer experience flips from "tools/settings" to "product." Everything else is iteration on top of that.

---

## Appendix: a few things I noticed but didn't make it into the body

- **No pricing page.** `/pricing` doesn't exist in `src/app/`. The landing page doesn't mention $29 or 250 free checks. Customers signing up have no idea what they're agreeing to until they land on the dashboard. Build a simple `/pricing` page with the three plans, the unit clarification ("checks, not scans"), and the upgrade buttons (Stripe Checkout already wired).
- **Quota emails exist but aren't clearly visible to the user.** I saw `QuotaExhaustedEmail` and `QuotaWarningEmail` imports in `/api/check/route.ts`. The 80%/100% thresholds should be confirmable in the dashboard and configurable (some users want 50%, some want only 100%).
- **The team plan is "$5,000 per seat" of quota** but there's no team-plan price visible in the source. Decide: $99/seat? $199/seat? This matters for the upgrade page.
- **There's no per-PR or per-batch result page on the web app.** The GitHub Action posts to a PR comment, which decays as the PR scrolls. A `/dashboard/runs/[run_id]` page that survives gives engineers a permanent home for "the ContentRX results from PR #347."
- **The "Sign up" → "Sign in" copy distinction matters.** Sign up should be obvious from the landing page. Today the landing has "Install →" and "Sign in →" but no "Sign up →" CTA. Engineers may grok "install = sign up"; designers won't.
