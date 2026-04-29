# Customer-copy vocabulary

The load-bearing decisions about what we call things on customer-facing
surfaces. Read this before writing any string a customer might see —
dashboard, emails, API errors, public pages, Figma plugin, CLI, MCP,
LSP, GitHub Action.

This doc is a reference, not enforcement. Drift is caught by audit
([first one was 2026-04-28](https://github.com/thenewforktimes/contentRX/pull/227));
this page is what the audit checks against.

## Voice in two lines

Direct. No jargon. Names the actor (we / I / the system), doesn't blame
the user, points somewhere when something fails. *"We couldn't load
your dashboard. Try again — if it keeps happening, email
hello@contentrx.io."* Not *"An unexpected error occurred."*

## Audience boundary

**Customer surfaces follow this doc.** Dashboard, customer emails, API
error responses, public marketing pages, Figma plugin UI, CLI output,
MCP tool responses, LSP diagnostics, GitHub Action PR comments.

**Founder /admin surfaces deliberately don't.** /admin/* uses raw
enums, full standard IDs, kappa, override-stream jargon, and
internal-only language because the audience is one technical founder
running a daily review rhythm. Don't soften /admin.

**Marketing prose is owned by its page file.** Landing copy, /pricing
hero, /about, /ethics, /privacy, /security, /sources, /accuracy,
/calibration — these stay in their files. The voice is Robo's. This
doc covers the load-bearing vocabulary, not the prose.

## Vocabulary decisions

The settled calls from the 2026-04-28 audit. Every one of these is
load-bearing — diverging in a new surface is a regression.

- **Findings** is what customers see. **Violations** stays in the API
  envelope and DB schema (the wire format calls them violations and
  always will). **Overrides** is what /admin calls dismissals. Three
  words for three audiences; don't blur them.
- **Team owner**, never *admin*. Per the Position-3 ICP locked
  2026-04-27 there is no admin role — the team owner is the billing
  contact and any team member can manage rules and examples. Code
  branches still use `isAdmin` internally; copy never does.
- Surfaces are always **Figma plugin**, never just *Figma* (which is
  the company). Same for **GitHub Action** (full phrase, capital A),
  **MCP server** (when introducing it; "MCP" alone is fine in
  scannable lists), **LSP server**, **CLI**.
- The customer-facing usage cap is the **monthly limit**. The API
  response and DB stay *quota* (engineers expect the technical word).
  The dashboard, emails, and error messages say *limit*.
- Substrate IDs (`CLR-01`, `PRF-03`, etc.) and `rule_version` never
  appear in customer-facing prose, per ADR 2026-04-25. The one carve-
  out today: the /dashboard/team/rules editor still shows the ID as a
  small monospace handle next to each rule row, because the user needs
  a stable identifier to refer to a specific rule when emailing
  support. Everywhere else — alerts, dialog titles, descriptions,
  emails, API error messages — the ID stays out.
- The email signoff is fixed: *"ContentRX — the content model for
  product copy."* Centralized in `src/emails/_shell.tsx`. Don't vary
  per template.

## Reusable phrases

If a new surface needs to express any of these ideas, copy the wording
verbatim instead of inventing a variant. The audit found four
different phrasings of "this needs the Team plan" before standardizing.

| Idea | Canonical wording |
|------|-------------------|
| Team-plan upsell | *"Available on the Team plan."* |
| 401 unauth | *"Authentication required"* |
| Recovery-path errors | *"Couldn't [verb the object]. Try again — if it keeps happening, email hello@contentrx.io."* |
| Stripe redirect loading | *"Redirecting to Stripe…"* |
| Rate-limit headline | *"Hold on a sec"* |
| Account provisioning still in flight | *"We're finishing setting up your account. Refresh in a moment."* |
| Quota exhausted headline | *"Monthly limit reached"* |

Support email: **hello@contentrx.io** (general, ethics, sources opt-out,
team plan setup). **privacy@contentrx.io** for privacy and data
requests. **security@contentrx.io** for vulnerability reports. Don't
introduce new addresses without updating /privacy.

## Patterns

Rules of thumb, not strings.

- **CTAs are action verbs.** *"Manage members"*, *"Edit team rules"*,
  *"View override report"*, *"Start calibration"*. Not *"Open
  members"* — *open* tells the user nothing about what's behind the
  link. Buttons that submit forms or initiate flows: *"Save changes"*,
  *"Send invite"*, *"Continue to checkout"*. Never *"Submit"*, *"OK"*,
  *"Click here"*.
- **Modal confirm/cancel.** Confirm verb-the-object, cancel says
  *"Cancel"*. *"Disable rule"* / *"Cancel"*. Not *"Disable"* / *"Keep
  it on"*. The api-key revoke modal still uses *"Keep key"* — that's
  a divergence to fix when next touching that file.
- **Loading states on async buttons.** *"Verbing…"* — *"Saving…"*,
  *"Joining…"*, *"Generating…"*, *"Redirecting to Stripe…"*. Not
  *"Loading…"* on a specific action.
- **Plurals are explicit.** *"1 finding"* / *"2 findings"*, never
  *"1 finding(s)"*. Use a ternary or `count === 1 ? "X" : "Xs"`.
- **Engine snake_case enums get humanized at the rendering boundary.**
  Moments, content types, review reasons, override stances, and
  Stripe lifecycle statuses have label tables in
  `src/lib/humanize.ts`. Never render a raw `low_confidence_mixed_signals`
  or `past_due` — call the helper. New enums get added to the helper
  the same PR that introduces them.
- **Third-party status strings are translated.** Stripe `past_due`
  becomes *"Payment past due — update your card to keep access."*
  Same rule as engine enums: never raw.
- **Dates.** Customer surfaces: *"Apr 25, 2026"* (locale short month).
  /admin and engineer-facing surfaces: ISO is fine. Several places in
  the codebase still mix these — when touching them, prefer the
  customer format unless you're inside /admin.
- **Numbers.** *"1,000 checks per month"*, not *"1000 checks/mo"*.
  Comma separator on thousands. The ContentRX numbers people see most:
  20 (free monthly limit), 1,000 (Pro monthly limit), 1,000/seat
  (Team), 3,000 (chars per check), 15,000 (max chars per call). Match
  these in copy or you're contradicting another surface.
- **Em dashes** carry the voice. Single space on each side: " — ". Used
  for asides, not commas. The audit kept this consistent; new copy
  should follow.

## What this doc isn't

- A style guide for marketing prose. The landing page, /about,
  /ethics, /pricing, /privacy stay in their page files; voice is
  Robo's; this doc covers vocabulary, not narrative.
- A list of every error message in the app. Only the patterns and the
  recurring phrases.
- An enforcement mechanism. The audit catches drift; this is the
  reference for what the audit checks against.
- A localization spec. Single-language for now. If i18n lands, this
  doc seeds the en-US base.

## Updating this doc

Vocabulary decisions belong in code review. If a PR introduces a new
recurring phrase, a new label table, or a new audience boundary, that
PR also updates this doc. If a PR overrides a decision in the table
above, link the ADR superseding it — vocabulary changes can have
positioning consequences (the *findings vs violations vs overrides*
split is downstream of the ADR 2026-04-25 substrate-vs-report split).

Last refreshed: 2026-04-28, after [#227](https://github.com/thenewforktimes/contentRX/pull/227).
