# Customer-copy vocabulary

The load-bearing decisions about what we say on customer-facing surfaces.
Read this before writing any string a customer might see. Dashboard,
emails, API errors, public pages, Figma plugin, CLI, MCP, LSP, GitHub
Action.

This doc is a reference, not enforcement. Drift gets caught by audit
([first one was 2026-04-28](https://github.com/thenewforktimes/contentRX/pull/227)).
This page is what the audit checks against.

## Voice

ContentRX speaks like a staff content designer who has read the
situation, weighed the moment, and reached a decision. Not like a
chatbot offering you options.

The product's value is **informed content-design judgment**. That's
Robo's role, baked into the model. Every string we ship has to feel
like that judgment showed up.

### Five rules

1. **Declarative, not suggestive.** Say what's wrong, not what *might
   be* wrong. "This error blames the user," not "consider whether the
   error is user-friendly." We hire ourselves for a verdict; if we
   hedge, we erode the value.
2. **No em dashes. Ever.** The em dash reads as LLM-flavored prose. Use
   a period, a comma, a colon, parens, or a sentence break. The voice
   gets sharper without it.
3. **No generic responses.** "Consider revising," "you might want to,"
   "this could be improved" are filler. Replace them with a specific
   read. If you can't write a specific read, the engine shouldn't have
   flagged the string.
4. **Name the actor. Don't blame the user. Point somewhere.** "We
   couldn't load your dashboard. Try again. If it keeps happening,
   email hello@contentrx.io." Not "An unexpected error occurred." Not
   "Invalid input."
5. **Use plain words.** *Use* not *utilize*. *Help* not *facilitate*.
   *Improve* not *optimize*. The full prohibited list is in
   [Prohibited terms](#prohibited-terms) below.

## Audience boundary

**Customer surfaces follow this doc.** Dashboard, customer emails, API
error responses, public marketing pages, Figma plugin UI, CLI output,
MCP tool responses, LSP diagnostics, GitHub Action PR comments.

**Founder /admin surfaces deliberately don't.** /admin/* uses raw
enums, full standard IDs, kappa, override-stream jargon, and
internal-only language. The audience is one technical founder running
a daily review rhythm. Don't soften /admin.

**Marketing prose is owned by its page file.** Landing copy, /pricing
hero, /about, /ethics, /privacy, /security, /sources, /accuracy,
/calibration. These stay in their files. The voice is Robo's. This
doc covers the load-bearing vocabulary, not the narrative.

## Engine output

The Violation envelope ships four fields: `issue`, `suggestion`,
`severity`, `confidence`. The staff-content-designer voice has to
come through in HOW those fields are written. Otherwise we're a
Claude reskin.

This is the differentiator. Get it right.

### `issue`: declarative, specific, named

A direct statement of what's wrong. Names the specific problem. No
hedging. No "consider whether," no "you might want to," no "this
could be more user-friendly." Filler.

| ✗ | ✓ |
|---|---|
| Consider whether this error message could be more user-friendly. | This error blames the user instead of naming what the system couldn't do. |
| There may be an opportunity to improve clarity. | The verb 'utilize' is jargon. 'Use' is shorter and clearer. |
| This phrasing is somewhat passive. | The button label 'Submit' doesn't tell the user what happens. |

### `suggestion`: the rewrite, not advice about the rewrite

A concrete replacement string the writer can paste in. Not guidance
about how to rewrite. The actual words.

| ✗ | ✓ |
|---|---|
| Try a more direct phrasing. | Use 'team' instead of 'guys'. |
| Consider naming the consequence. | Replace 'Are you sure?' with 'Delete 3 files?'. |
| Restructure to lead with the action. | Use 'Save changes' instead of 'Submit'. |

If the rewrite has multiple acceptable versions, pick one. Don't list
options. The writer can reject our pick; they can't reject "consider
some alternatives."

### `content_notes`: the staff content designer's read (NEW FIELD)

One to three sentences of judgment beyond the basic issue + suggestion.
Why does this matter in this situation? What's the principle? What's
the moment doing?

This field is what separates ContentRX from a Claude wrapper. The LLM
produces it under a prompt that teaches the staff-content-designer
voice. It explains the WHY in terms a writer can apply to the next
string they write, not just this one.

**Example.** For an error message that read *"An unexpected error
occurred"*:

```
issue:         "This error doesn't say what went wrong or what to do."

suggestion:    "We couldn't load your dashboard. Try again. If it
                keeps happening, email hello@contentrx.io."

content_notes: "Generic error messages erode trust because they signal
                the team didn't think about the failure case. Replace
                'unexpected error' with the specific failure (the
                dashboard wouldn't load), and follow it with a concrete
                next step. The user should never wonder whether to
                retry or wait."
```

**Example.** For a destructive button labelled *"Submit"*:

```
issue:         "The button doesn't name the action it triggers.
                'Submit' is a form-action verb, not a content-design
                verb."

suggestion:    "Use 'Delete account' (or whatever specific outcome
                this button triggers)."

content_notes: "Destructive confirmations need to name the consequence
                so the user can make an informed decision. 'Submit'
                borrows from form ceremonies that predate good content
                design. The outcome verb earns trust the form verb
                doesn't."
```

**Wire format note.** Adding `content_notes` to the public envelope is
a 2.0.0 → 2.1.0 schema bump. Non-breaking. Every surface (dashboard,
MCP, LSP, GitHub Action, Figma plugin, CLI) has to render it. Track
via ADR; this doc is the spec, not the ship plan.

## Vocabulary decisions

Settled calls. Diverging in a new surface is a regression.

- **Findings** is what customers see. **Violations** stays in the API
  envelope and DB schema. **Overrides** is what /admin calls
  dismissals. Three words for three audiences. Don't blur them.
- **Team owner**, never *admin*. Per the Position-3 ICP locked
  2026-04-27 there is no admin role. The team owner is the billing
  contact, and any team member can manage rules and examples. Code
  branches still use `isAdmin` internally; copy never does.
- Surfaces are always **Figma plugin**, never just *Figma* (which is
  the company). Same for **GitHub Action** (full phrase, capital A),
  **MCP server** (when introducing it; "MCP" alone is fine in
  scannable lists), **LSP server**, **CLI**.
- The customer-facing usage cap is the **monthly limit**. The API
  response and DB stay *quota* (engineers expect the technical word).
  The dashboard, emails, and error messages say *limit*.
- Substrate IDs (`CLR-01`, `PRF-03`, etc.) and `rule_version` never
  appear in customer-facing prose, per ADR 2026-04-25. The one
  carve-out today: the /dashboard/team/rules editor still shows the ID
  as a small monospace handle next to each rule row, because the user
  needs a stable identifier to refer to a specific rule when emailing
  support. Everywhere else, the ID stays out. That includes alerts,
  dialog titles, descriptions, emails, and API error messages.
- The email signoff is fixed: *"ContentRX. The content model for
  product copy."* Centralized in `src/emails/_shell.tsx`. Don't vary
  per template. (Note: the live signoff still uses an em dash from
  the 2026-04-28 audit. Em-dash sweep upcoming; this is the target.)

## Prohibited terms

These trigger findings on every customer surface, mapped to engine
standards (INC-01 inclusive language, CLR-01 clarity, VT-01 voice,
ACT-01 action verbs, ACC-04/05 accessibility). Listed here so we
don't use them in our own copy either.

### Inclusive language (severity: error)

**Gender-exclusive.** Replace with people-first or role-first language.

| Avoid | Use |
|-------|-----|
| guys, dudes, bros | team, everyone, folks |
| mankind | humanity, people |
| manpower | workforce, staff |
| man-hours | person-hours, work-hours |
| businessman | business person |
| chairman | chair, head |
| salesman | salesperson |
| freshman | first-year student |

**Tech legacy.** These are settled in the industry; using them now
signals the team hasn't kept up.

| Avoid | Use |
|-------|-----|
| master / slave | primary / secondary, main / replica |
| blacklist / whitelist | blocklist / allowlist |

**Ableist.** Casual ableism in product copy lands worst on the people
most affected by it. Always rewrite.

| Avoid | Use |
|-------|-----|
| crazy, insane | surprising, unexpected, striking |
| blind spot | gap, oversight |
| lame | disappointing, weak |
| dummy, dumb | placeholder, sample, ineffective |
| tone-deaf | out of touch, unaware |

### Pronoun guidelines (severity: warning)

Default to the singular *they*. *He / she* and *his / her* are
exclusionary in product copy where the audience isn't known.

| Avoid | Use |
|-------|-----|
| he, she | they |
| his, her | their |
| him, her | them |

### Plain language (severity: warning)

Jargon and corporate-speak. The fix is almost always a shorter,
plainer word.

| Avoid | Use |
|-------|-----|
| utilize, leverage | use |
| facilitate | help, enable |
| optimize, streamline | improve, simplify |
| synergize, ideate | work together, brainstorm |
| paradigm, methodology | model, method |
| robust, scalable, world-class | say what you actually mean |

### Active voice (severity: warning)

Passive constructions hide the actor and weaken accountability. The
fix is to name who did what.

| Avoid | Use |
|-------|-----|
| "was created" | "we created" or "you created" |
| "is being processed" | "processes" or "we're processing" |
| "will be sent" | "we'll send" |

### Other engine-enforced categories

- **Missing alt text** on images (severity: error, ACC-05)
- **Non-descriptive links** like *"click here"* or *"read more"*
  (severity: warning, ACC-04). Replace with descriptive text that
  names the destination.
- **Generic CTAs** like *"Submit"*, *"OK"*, *"Click here"* (severity:
  warning, ACT-01). Replace with the verb that names the outcome.

## Reusable phrases

If a new surface needs to express any of these ideas, copy the wording
verbatim instead of inventing a variant. The audit found four
different phrasings of "this needs the Team plan" before standardizing.

| Idea | Canonical wording |
|------|-------------------|
| Team-plan upsell | *"Available on the Team plan."* |
| 401 unauth | *"Authentication required"* |
| Recovery-path errors | *"Couldn't [verb the object]. Try again. If it keeps happening, email hello@contentrx.io."* |
| Stripe redirect loading | *"Redirecting to Stripe…"* |
| Rate-limit headline | *"Hold on a sec"* |
| Account provisioning still in flight | *"We're finishing setting up your account. Refresh in a moment."* |
| Quota exhausted headline | *"Monthly limit reached"* |
| Stripe payment past due | *"Payment past due. Update your card to keep access."* |
| Email signoff | *"ContentRX. The content model for product copy."* |

Support email: **hello@contentrx.io** (general, ethics, sources opt-out,
team plan setup). **privacy@contentrx.io** for privacy and data
requests. **security@contentrx.io** for vulnerability reports. Don't
introduce new addresses without updating /privacy.

## Patterns

Rules of thumb, not strings.

- **CTAs are action verbs.** *"Manage members"*, *"Edit team rules"*,
  *"View override report"*, *"Start calibration"*. Not *"Open
  members"*: *open* tells the user nothing about what's behind the
  link. Buttons that submit forms or initiate flows: *"Save changes"*,
  *"Send invite"*, *"Continue to checkout"*. Never *"Submit"*, *"OK"*,
  or *"Click here"*.
- **Modal confirm/cancel.** Confirm verb-the-object, cancel says
  *"Cancel"*. *"Disable rule"* / *"Cancel"*. Not *"Disable"* / *"Keep
  it on"*. The api-key revoke modal still uses *"Keep key"*. That's a
  divergence to fix when next touching that file.
- **Loading states on async buttons.** *"Verbing…"*. So *"Saving…"*,
  *"Joining…"*, *"Generating…"*, *"Redirecting to Stripe…"*. Not
  *"Loading…"* on a specific action.
- **Plurals are explicit.** *"1 finding"* / *"2 findings"*, never
  *"1 finding(s)"*. Use a ternary or `count === 1 ? "X" : "Xs"`.
- **Engine snake_case enums get humanized at the rendering boundary.**
  Moments, content types, review reasons, override stances, and Stripe
  lifecycle statuses have label tables in `src/lib/humanize.ts`. Never
  render a raw `low_confidence_mixed_signals` or `past_due`. Call the
  helper. New enums get added to the helper the same PR that
  introduces them.
- **Third-party status strings are translated.** Stripe `past_due`
  becomes *"Payment past due. Update your card to keep access."* Same
  rule as engine enums: never raw.
- **Dates.** Customer surfaces use the locale short month, like
  *"Apr 25, 2026"*. /admin and engineer-facing surfaces can stay ISO.
  Several places in the codebase still mix these. When touching them,
  prefer the customer format unless you're inside /admin.
- **Numbers.** *"1,000 checks per month"*, not *"1000 checks/mo"*.
  Comma separator on thousands. The numbers customers see most: 20
  (free monthly limit), 1,000 (Pro monthly limit), 1,000/seat (Team),
  3,000 (chars per check), 15,000 (max chars per call). Match these
  in copy or you're contradicting another surface.
- **Punctuation instead of em dashes.** When you reach for an em dash,
  reach for a period, a comma, a colon, parens, or a sentence break.
  Almost always one of those works. The em dash reads as
  Claude-flavored; the voice gets sharper without it.

## What this doc isn't

- A style guide for marketing prose. The landing page, /about, /ethics,
  /pricing, /privacy stay in their page files. Voice is Robo's. This
  doc covers vocabulary, not narrative.
- A list of every error message in the app. Only the patterns and the
  recurring phrases.
- An enforcement mechanism. The audit catches drift; this is the
  reference for what the audit checks against.
- A localization spec. Single-language for now. If i18n lands, this
  doc seeds the en-US base.

## Outstanding follow-ups

Captured here so they don't get forgotten. Track each as its own PR.

1. **Em-dash sweep.** The 2026-04-28 audit (#227) added or kept em
   dashes in several places that this revision now contradicts. The
   email signoff (`src/emails/_shell.tsx`), the recovery-path errors
   in `subscription-panel.tsx` and `api-key-panel.tsx`, the Stripe
   `past_due` rendering in `subscription-panel.tsx`. Replace with
   periods or commas per the canonical phrases above.
2. **`content_notes` wire-format change.** Schema bump 2.0.0 → 2.1.0,
   prompt update in `api_utils.py`, render the field on every surface
   (dashboard explain panel, MCP/LSP/CLI/GitHub Action/Figma plugin),
   and snapshot tests. Needs an ADR and its own build-plan session.
3. **Prohibited-terms parity check.** Verify the engine's standards
   library (`standards_library.json`) covers every term in the lists
   above. Any gap is a missing example pair, not necessarily a missing
   standard.

## Updating this doc

Vocabulary decisions belong in code review. If a PR introduces a new
recurring phrase, a new label table, or a new audience boundary, that
PR also updates this doc. If a PR overrides a decision in the table
above, link the ADR superseding it. Vocabulary changes can have
positioning consequences (the *findings vs violations vs overrides*
split is downstream of ADR 2026-04-25).

Last refreshed: 2026-04-29.
