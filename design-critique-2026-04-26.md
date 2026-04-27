# Design critique: ContentRX web app (customer + /admin)

**Reviewed:** 2026-04-26
**Scope:** `src/app/` — public landing + marketing, `/dashboard/*`, `/admin/*`
**Stage:** Final-polish on landing/dashboard, mid-build on `/admin`
**Method:** Source review against `CLAUDE.md` and `decisions/2026-04-25-private-taxonomy-pivot.md` (the live URL was not reachable from this environment, so source-of-truth is the deployed code in `src/app/`)

---

## Overall impression

The visual system is consistent — same neutral palette, same eyebrow/title/body rhythm, same border-and-padding card vocabulary across every surface. That's the strongest thing going for it. The two biggest opportunities are (a) **the public surface contradicts the locked positioning**: ~5 of the 7 pages reachable from the landing nav still treat the taxonomy as the headline product, and (b) **the design system is implicit, not codified** — there are zero shared layout/text components and one CSS bug that's silently overriding the loaded font on every page.

The `/admin` substrate has a clearer information architecture than the customer dashboard, which is structurally inverted: the founder dashboard reads like a product, the customer dashboard reads like a settings panel.

---

## Part 1 — Customer surfaces

### Critical: positioning leak across the public surface

`CLAUDE.md` and the 2026-04-25 ADR lock the public surface to `/accuracy`, `/calibration`, `/essays`, `/reports` — and explicitly forbid publishing the taxonomy. The current public surface does the opposite:

| Page | Issue | Severity |
|---|---|---|
| `/` (landing) | 5 outbound links to `/model` (no such public route exists — it's `/admin/model`) | 🔴 Critical — every "See the model" CTA 404s |
| `/` (landing) | Hardcoded link to `https://docs.contentrx.io/model/moments/destructive_action` and uses moment names as URL anchors | 🔴 Critical — exposes private taxonomy |
| `/sources` | Renders "47 standards", per-source standard counts, and a direct link to `src/content_checker/moments.py` | 🔴 Critical — publishes the private taxonomy by another name |
| `/about` | Links to `/model/standards/VT-05`, `/model/standards/ACT-01`, `/model/standards/CLR-01` (all 404) and `/model/changelog` (404) | 🔴 Critical — dead links + standard-id leak |
| `/about` | Ships with `{bio: years shipping product copy, notable teams or companies…}` placeholder still in source. The comment on `PLACEHOLDER_BIO` says a copy-pin test should fail until edited; the file has the placeholder unedited. | 🔴 Critical — either the test isn't running or the placeholder is rendering live |
| `/install` | Sign-in/install nav references `/model` | 🟡 Moderate — same theme |
| `MomentBanner` component | Renders the moment id verbatim ("I noticed this looks like `destructive_action`") and links to `docs.contentrx.io/model/moments/${moment}` from every customer-facing surface that uses it (Figma plugin, dashboard, MCP, CLI render) | 🔴 Critical — by the ADR, no user-facing surface should expose moment names |

**Recommendation:** Either reverse the ADR (write the new ADR before shipping more code) or do the rip-out. The contradiction between what `/` promises and what `/sources` shows vs. what the architecture document says is the most expensive thing on the site right now — every code review and every customer conversation has to navigate it. Specifically:

1. Replace the landing page's "See the model" with **"See the accuracy"** linking `/accuracy`.
2. Replace `/sources` with a one-page attribution stub that names the categories of inputs (style guides, OSS repos, examples corpus) without per-standard counts or links into engine source files. Keep the opt-out mailto.
3. Rewrite `MomentBanner`'s headline. The moment is internal — the user doesn't need to see `destructive_action` to understand the verdict. Surface the verdict and severity; drop the moment id and the docs link.
4. Either fill `PLACEHOLDER_BIO` or unship `/about` until it's filled.

### Critical: body font is being overridden

`src/app/globals.css:25` sets:

```css
body { font-family: Arial, Helvetica, sans-serif; }
```

The root layout loads `Geist` and `Geist_Mono` from `next/font/google`, applies their CSS variables to `<body>`, and references them in `@theme inline`. But the body's `font-family` declaration is **the most-specific rule that actually applies** — Tailwind's `font-sans` utility isn't in use anywhere I checked (eyebrow uses `font-mono`, body text inherits). So the entire site is rendering in **Arial**, not Geist, despite the perf cost of loading Geist on every page.

**Recommendation:** Delete the `font-family: Arial...` line in `globals.css`, or change it to `font-family: var(--font-geist-sans), system-ui, sans-serif;`. Verify visually after fix — this is the kind of regression that goes unnoticed for months.

### First impression (landing page)

What draws the eye first: the H1 "The content model for product copy." That's correct. The eyebrow + H1 + lead paragraph stack is tight and unambiguous about what the product is.

What reads weakest: the CTA stack. `Install → MCP · CLI · GitHub Action · Figma` is doing four things — it's a button, an installer, a list of surfaces, and an arrow indicator — and the result is a button that's hard to scan. The secondary "See the model" button competes for visual weight even though it should be subordinate. The tertiary "Sign in →" disappears between them.

**Recommendation:** Make the primary CTA short ("Install →") and let the install page do the surface-listing work. Keep the secondary as **"See the accuracy"** (after the positioning fix). Sign-in moves to the top-right corner of every page (a thin auth nav).

### Visual hierarchy across the public surface

The Section component pattern (eyebrow + H2 + body + top border) is good — it gives every long page a predictable rhythm without a heavy visual frame. It does start to feel mechanical at length: landing page has 6 sections, install has 5, about has 5. Every section looks identical. There's no visual anchor for "this section is the wedge" vs. "this section is administrivia."

**Recommendation:** Reserve the section-with-eyebrow pattern for the substantive sections; use a lighter rule for footer-style content (the "Stacking surfaces" coda, the "Keep reading" footer). Consider a single hero-image or schematic on the landing page — one piece of visual content would relieve the wall-of-text feeling, and it's something a content-design product especially can afford to do well.

### `/dashboard` (customer)

The information architecture is upside down. The dashboard surfaces, in order:

1. Email + plan pill
2. Usage bar
3. Subscription panel
4. API key panel
5. Team rules / analytics / overrides (team only)
6. Calibration link

The **most important thing a customer is here for** — managing their integration — is buried below billing UI. The API key is the asset; the usage bar is reassurance. Reverse them.

| Finding | Severity | Recommendation |
|---|---|---|
| API key panel is fourth on the page; for new users the first action is "generate key," but they have to scroll past three sections to find it | 🟡 Moderate | Move API key to the top, right under email. Usage and billing collapse into a single right-rail card. |
| The usage bar uses `bg-black dark:bg-white` for the fill and `bg-red-500` only at 100% | 🟢 Minor | Use a warning color (amber) at ≥80% so the user has runway to upgrade before they're at 0. |
| Plan pill uses three different color systems (neutral / blue / purple) but no visual semantic — purple = team is arbitrary | 🟢 Minor | Either go monochrome or pick semantically distinct colors (free = neutral, pro = blue, team = forest green or similar). Three random colors look like badges. |
| `/dashboard/explain` ships with eyebrow text **"Sessions 21 + 22 — rationale chain + moment banner"** (line 41 of `explain/page.tsx`) | 🔴 Critical | This is internal build-plan language showing in the customer surface. Replace with something the customer would understand, e.g. "Live demo." |
| `/dashboard/cadence` requires Team plan but pitches the substrate concepts (override stream, refinement-log, drift signals) to the Team admin | 🟡 Moderate | The customer doesn't have a refinement log — that's a founder concept. Reframe in customer terms ("review queue," "rules trending toward dismissal") or move this surface to `/admin`. |
| Typography hierarchy on the dashboard is `text-2xl` H1 / `text-sm` H2 / `text-3xl` for the usage number — the largest type on the page is a metric | 🟢 Minor | Fine on a metrics-heavy page, but `text-2xl` for the user's email is small for what should be the page identity. |

### Consistency across customer surfaces

| Element | Issue | Recommendation |
|---|---|---|
| Card border | Most pages use `border-neutral-200`; some use `border-neutral-300` (`/install` chips, `/sources` opt-out box) | Pick one. `border-neutral-200` reads best on white. |
| Card background | Mix of `bg-white`, `bg-neutral-50`, no-background | The "callout box" treatment varies page-to-page. Codify two: default card (white, neutral-200 border) and emphasis callout (neutral-50, neutral-300 border). |
| Eyebrow text | Always `text-xs font-mono uppercase tracking-widest text-neutral-500` — good | Promote this to a single `<Eyebrow>` component. Currently inlined ~15× across pages. |
| Section spacing | `mt-12` (about) vs `mt-16` (landing) vs `mt-10` (accuracy) | Pick a scale (e.g. `space-y-12` on a parent wrapper) and stop hand-spacing. |
| Button vocabulary | Five distinct button styles in use: `bg-black/text-white`, `border + hover:bg-neutral-50`, transparent text-only, `border-amber + amber bg`, `border-red + red bg` — no central definition | Write a `Button` component with `primary` / `secondary` / `ghost` / `danger` variants. The amber "fresh API key" button can be the `warning` variant. |
| Link underline | Uses `underline underline-offset-2` everywhere (good) but the underline on inline links isn't differentiated from the underline on standalone links | Fine as-is, but standalone link buttons could use the `border + hover` pattern to feel more clickable. |

### Accessibility

| Check | Pass / fail | Notes |
|---|---|---|
| Color contrast: `text-neutral-500` on white | ⚠️ ~4.6:1 | Just over WCAG AA for normal text (4.5:1) but eyebrow text is `text-xs`, which is below the threshold for "large text." `text-neutral-600` is safer. |
| Color contrast: `text-neutral-400` (used on draft labels and some sublines) | ❌ ~3.0:1 | Below AA on white. |
| Touch targets: install-page `SurfaceChip` (`px-3 py-1.5 text-xs`) | ⚠️ ~28px tall | Below 44px AAA / 24px AA target size for touch. Acceptable on desktop, fails on mobile. |
| Touch targets: dashboard "Open team rules" / "Open analytics" buttons (`px-3 py-1.5 text-xs`) | ⚠️ Same | Same problem. |
| Focus states | Mostly default (Tailwind doesn't add a focus ring without `focus:ring-*`) | Add `focus-visible:ring-2 focus-visible:ring-neutral-500` to the `Button` component. Right now the only focusable elements with explicit focus styles are the refinement-log form inputs. |
| Alt text on the (zero) images | N/A | There are no images. The site is text-only — which is fine, but means a single hero illustration would have outsized impact (see hierarchy note above). |
| Semantic landmarks | Most pages use `<main>`, `<header>`, `<section>`, `<footer>` correctly | Good. The dashboard layout doesn't wrap the nav in a `<nav>`, only the admin layout does. |
| Dark mode | Implemented everywhere via `dark:` variants — but contrast on dark mode is generally lower (e.g. `dark:text-neutral-400` on `dark:bg-neutral-950`) | Audit the dark palette specifically. The current dark theme reads more "low-contrast preview" than "deliberate dark mode." |

### What works well

- The eyebrow + H1 + lead paragraph rhythm is excellent. It's the strongest pattern on the site.
- The `/accuracy` page's three-card layout is a model for the rest of the site: each metric is its own card, the design target uses a dashed border to visually separate it from measurements, "pending" states are first-class. This is what content-design-led product looks like.
- The `MomentBanner`'s correction flow ("Not destructive_action?" → dropdown → submit) is a beautifully thought-through interaction. It's exactly the right shape; it's just the *naming* that leaks the private taxonomy.
- The API key reveal-once flow is correct — amber callout, copy button, explicit "we won't show this again" message. Don't change this.
- `mailto:` opt-out links pre-filled with subject lines (`/sources`) are a nice attention-to-detail moment.

---

## Part 2 — `/admin` (founder substrate)

### Overall

`/admin` is more interesting than `/dashboard`. It has a clearer top-level model (8 surfaces, all linked from a card grid), it uses a wider container (`max-w-6xl` vs. dashboard's `max-w-3xl`), and it leans into data-density correctly: tables, sparklines, filter tabs, decision buttons. This is what a founder-as-power-user surface should look like.

### First impression (`/admin`)

What draws the eye: the eight cards, one per surface. That's correct — each surface is roughly equal weight and the founder is here to pick one and dive in. The card descriptions are workmanlike and informative.

What reads weakest: the index page has no signal of *what's stale or urgent*. The whole point of this dashboard, per the architecture doc, is the daily review rhythm. The index should tell the founder: "you have N pending reviews; the calibration log is M days stale; these refinements need a verdict." Right now the index is a navigation menu, not a status board.

**Recommendation:** Promote the index to a status dashboard. Each card gets a small badge: pending count for `/admin/queue`, last-modified for `/admin/calibration`, open count for `/admin/refinement-log`, stale flag for `/admin/reports`. The founder should be able to look at `/admin` and immediately know what to do next — that's the operational moat the architecture is staking everything on.

### Usability

| Finding | Severity | Recommendation |
|---|---|---|
| `/admin/queue` is the daily-rhythm landing — but the founder enters via `/admin` index, picks "Review queue," then has to set a subtype filter. Make it the default tab. | 🟡 Moderate | Either redirect `/admin` → `/admin/queue` for the founder, or surface "today's queue" inline on the index. |
| `/admin/queue` decision buttons (`Agree` / `Disagree` / `Skip`) are styled as three same-size buttons. Disagree is the consequential one (it's a false positive recorded against the engine), but it's visually equivalent to Agree. | 🟢 Minor | Slight: make `Agree` the default visual emphasis; `Disagree` / `Skip` lighter. The success path is the most-pressed button. |
| `/admin/refinement-log` requires clicking a `<details>` to reveal the "Add a refinement candidate" form, which is the primary writable action on the page. | 🟡 Moderate | A founder reviewing the page during the daily rhythm should land on the form. Promote it above the fold. The list-of-existing-entries can collapse instead. |
| `/admin/calibration` per-standard table has 47 rows with no pagination, no filtering, no search. | 🟡 Moderate | At 47 it's tolerable. Add a filter input ("all / measured only / pending / stale") before the count grows. |
| `/admin/reports` "Mark reviewed" toggle is in `font-mono text-[10px] uppercase` — readable as data, not as an action. | 🟢 Minor | The mark-reviewed action is the founder's gating decision. Make it a regular-weight button at `text-xs`. |
| `/admin/essay-drafts` autosaves nowhere — the textarea is server-action-on-submit, no local persistence. A 22-row textarea full of essay draft is a lot to lose to an accidental nav. | 🟡 Moderate | Add `localStorage` autosave keyed on `draftFilename` (purely client-side, doesn't conflict with the read-only-on-Vercel disk constraint). |
| `/admin/essay-drafts` textarea is `font-mono text-xs` — fine for reading raw markdown, hostile for writing 200 words of prose | 🟡 Moderate | Switch to a sans serif at `text-sm` with `leading-relaxed`. Markdown is text — typography helps the writer, not just the reader. |

### Visual hierarchy

- The admin nav is a horizontal bar of eight links with no current-route indication. On a deep page (e.g. `/admin/model/standards/VT-05`) the founder loses sense of where they are. **Recommendation:** mark the active section in the nav (`text-neutral-900 underline` or a subtle `bg-neutral-100`).
- The two-column nav structure (logo left, nav right) is fine but the nav doesn't visually group: "Model · Queue · Refinement log · Calibration · Reports · Essay drafts · Case studies · Rule review" is eight items at equal weight. Consider grouping into "Today's rhythm" (Queue, Refinement log, Reports) and "Substrate" (Model, Calibration, Case studies, Rule review, Essay drafts). The architecture doc has this distinction implicitly; the nav doesn't reflect it.
- Per-surface H1s use `text-2xl font-semibold` consistently — good. But the "kappa numbers" sections of `/admin/calibration` use `text-sm font-semibold uppercase tracking-wide text-neutral-500` for section headers, which reads as eyebrow text rather than as a header. Visual weight is wrong for what should be a major scannable landmark on the page.

### Consistency

`/admin` is internally consistent (the layout is shared, the card pattern repeats, the table styles repeat). The breaks are in the seams with the customer surface:

| Element | Customer | Admin | Decision |
|---|---|---|---|
| Container width | `max-w-3xl` | `max-w-6xl` | Correct — these are different surfaces with different density. Keep. |
| Background | `bg-white` | `bg-neutral-50` | Correct — admin is "tools" surface, customer is "marketing/account" surface. Keep. |
| Card style | `border-neutral-200 + bg-white` | Same | Consistent — good. |
| Eyebrow color | `text-neutral-500` | Same | Consistent. |
| Mono font use | Sparingly (eyebrows, code) | Heavily (IDs, dates, numbers, sparklines) | Right call — mono signals "this is data" in admin. |

### Accessibility (admin)

The same `text-neutral-500` and `text-neutral-400` contrast issues from the customer surface apply here. Additionally:

- **Sparkline is decorative** in the per-standard table — no `aria-label`, no fallback text, no underlying number for screen readers to announce. The numeric kappa is in the previous column, so functionally OK, but I'd add `aria-label="Weekly trend, 8 weeks"` for completeness.
- **Decision buttons in the queue have no confirmation** for `Disagree`, which writes to the override stream and feeds calibration. A keystroke away from a misclick that pollutes the substrate. **Recommendation:** double-confirm `Disagree` on the queue page (the customer-side `AlertDialog` component is already in `src/components`).
- **The `/admin/reports` "Mark reviewed" toggle is destructive in the other direction** — un-marking is a meaningful action (it un-gates a stale report from publication). Same pattern: confirm before un-marking.
- **Admin nav doesn't announce its current location** to assistive tech (no `aria-current="page"`). Add it.

### What works well

- **Subtype filter tabs on `/admin/queue`** with counts is exactly the right pattern. The descriptions per subtype below the filter (when active) is a great touch — it teaches the vocabulary as the founder uses it.
- **Per-standard sparklines using Unicode block characters** (`▁▂▃▄▅▆▇█`) is delightful. Server-rendered, zero JS, accessible to copy-paste, fits in a table cell. Don't replace this with Recharts.
- **The "design target" card with a dashed border** to visually distinguish it from measured numbers is a load-bearing piece of design — it makes the "never combine into a composite score" rule into a visible thing. Repeat this pattern wherever the substrate has a value that's an assumption rather than a measurement.
- **`/admin/essay-drafts` shows the inputs to the scaffold next to the draft body** — that's transparency-by-design and matches the broader "show the rationale chain" ethos. Good.
- **Stale flags on `/admin/reports`** with explicit thresholds per report type (`stale > Nd`) is exactly the operational discipline the architecture calls for. This is the moat showing up in the UI.

---

## Cross-cutting recommendations

### Priority recommendations (do these first)

1. **Resolve the public/private contradiction.** Either ship a new ADR superseding the 2026-04-25 pivot, or do the rip-out: `/sources` becomes a stub, `/about` and `/` lose all `/model` links, `MomentBanner` stops rendering moment names. Right now the marketing surface is selling something the architecture doesn't deliver. This is the single most expensive thing on the site.

2. **Fix the body font.** Delete `font-family: Arial, Helvetica, sans-serif` from `globals.css:25` (or change to `var(--font-geist-sans)`). Visually verify after the change. This is a five-minute fix that unlocks the typography work already paid for by loading Geist.

3. **Codify the design system.** Extract three components: `<Eyebrow>`, `<Section>`, `<Button variant="primary|secondary|ghost|warning|danger">`. The patterns are already consistent — promote them to first-class so future pages don't have to re-derive them. Add `focus-visible:ring-*` to the button while you're there.

4. **Invert the customer dashboard.** API key first, usage second, billing third, calibration fourth. The customer is here to integrate; treat that as the headline.

5. **Promote `/admin` index from nav to status board.** Surface what's pending, what's stale, what needs a verdict. Right now the founder has to navigate into each surface to find out — the daily-rhythm becomes harder than it has to be.

### Medium-priority

6. Pin and verify the `PLACEHOLDER_BIO` (either fill it or pull `/about` from the nav).
7. Replace `text-neutral-400` with `text-neutral-500` everywhere it appears on a body-text size.
8. Replace the "Sessions 21 + 22 — rationale chain + moment banner" eyebrow on `/dashboard/explain` with customer-facing copy.
9. Add `aria-current="page"` to the admin nav.
10. Add a confirmation dialog to `Disagree` on the admin queue and `Unmark` on the admin reports surface.

### Lower-priority polish

11. Mark the active section in the admin nav (text color or background).
12. Add a single hero illustration to the landing page to break the wall-of-text rhythm.
13. Add localStorage autosave to the essay-draft textarea.
14. Switch the essay-draft textarea to a sans-serif body font.
15. Audit the dark palette for contrast.

---

## Appendix: surface inventory

**Public (linked from landing nav or footer):**
- `/` — landing
- `/install` — install instructions, 5 surfaces
- `/about` — founder bio + content-design framing
- `/accuracy` — three-kappa public surface
- `/calibration` — weekly log index
- `/calibration/[week]` — single weekly log render
- `/sources` — attribution surface
- `/ethics` — (not read in this pass)
- `/sign-in`, `/sign-up` — Clerk components

**Customer (`/dashboard`):**
- `/dashboard` — overview
- `/dashboard/calibrate` — pairwise prompts
- `/dashboard/explain` — interactive verdict demo
- `/dashboard/overrides` — override report (team)
- `/dashboard/graduation` — standards readiness (presumably)
- `/dashboard/team/rules` — team rule overrides
- `/dashboard/team/analytics` — team analytics
- `/dashboard/team/custom-examples` — custom examples
- `/dashboard/cadence` + `/dashboard/cadence/{annual,calibration,moment,overview,quarterly}` — daily-rhythm pages

**Founder (`/admin`):**
- `/admin` — index card grid
- `/admin/model` + `/admin/model/{moments,standards}/[id]` — taxonomy browser
- `/admin/queue` — review queue with subtype filters
- `/admin/refinement-log` — refinement candidates + form
- `/admin/calibration` — per-standard kappa table + trend chart
- `/admin/reports` — preview-before-publish gate
- `/admin/essay-drafts` + `/admin/essay-drafts/[filename]` — scaffolded drafting
- `/admin/case-studies` + `/admin/case-studies/[slug]` — case studies
- `/admin/rule-review` — cross-team override aggregation
