# Integrity sweep — week of 2026-05-09

> This document uses em dashes editorially because it's an internal
> audit, not a customer-facing artifact. The voice rule against em
> dashes lives at `docs/copy-vocabulary.md` and applies to strings a
> customer reads (UI copy, email templates, public marketing pages,
> the PR-comment digest). Audit notes for the founder are not in
> scope.

Day 5 audit of every new or substantively-modified customer surface
shipped this week. Sweeps:

1. **Raw stone-N classes** outside `src/components/ui/` and
   `src/emails/` (flagged by the `no-restricted-syntax` ESLint rule).
2. **Em dashes** in customer-visible strings (voice rule 2 of
   [docs/copy-vocabulary.md](copy-vocabulary.md)).
3. **Engine-substrate leaks** — any `standardId`, `ruleVersion`,
   `rationaleChain`, `relatedStandards`, or `docsUrl` interpolated
   into customer-visible JSX.
4. **Primitive usage** — every new component reaches for an existing
   primitive (`Button`, `Pill`, `Card`, `Alert`, `Heading`, `Eyebrow`,
   `Section`, `Divider`, `PageHeader`) before inlining classes.
5. **Marketing-copy banner trigger** correctness against fixtures.
6. **PR comment template** rendering against the four variants
   (drift / no-repetition / mixed / setup-prompt).

## TL;DR

All five new customer surfaces and all five substantively-modified
customer surfaces pass the integrity bar. Two pre-existing technical
debts surfaced as adjacent findings (not in scope for this sweep,
deferred); listed below for the next cleanup pass.

| Surface | New / modified | Stone-N drift | Em dashes | Substrate leaks | Primitive usage |
|---|---|---|---|---|---|
| `src/components/use-case-toggle.tsx` | new (F1) | clean | clean | clean | `Eyebrow`, `Pill` |
| `src/app/(marketing)/writes/page.tsx` | new (F3) | clean | clean | clean | `PageHeader`, `Eyebrow`, `Pill` |
| `src/app/(marketing)/page.tsx` (hero supporting line + UseCaseToggle) | modified (F1) | clean | clean | clean | unchanged structure |
| `src/app/(marketing)/install/page.tsx` (paste-mode section) | modified (F5) | clean | clean | clean | reuses local `<Section>` + `<SurfaceChip>` + `<Code>` helpers |
| `src/app/(marketing)/pricing/page.tsx` (FAQ entry) | modified (F5) | clean | clean | clean | reuses local `<Faq>` helper |
| `src/app/(authed)/dashboard/explain/explain-client.tsx` (marketing banner + textarea sizing) | modified (F2) | one pre-existing line on the textarea (line 230, `focus:border-stone-500`) | clean (banner copy + state messages all canonical recovery shape) | clean | the new `MarketingCopyBanner` component is local; uses `accent-info-*` tokens |
| `src/app/(authed)/dashboard/explain/page.tsx` (paste-mode header rewrite) | modified (F2) | clean | clean | clean | unchanged structure |
| `src/app/(authed)/dashboard/agent/page.tsx` | new (G3) | clean | clean | clean | `Card` |
| `src/app/(authed)/dashboard/agent/agent-preview-island.tsx` | new (G3) | clean | clean | clean | `Button` |
| `src/app/(authed)/dashboard/folder-tabs.tsx` (new tab entry) | modified (G3) | clean | clean | clean | unchanged structure |
| `src/app/admin/agent-runs/page.tsx` | new (G1) | clean | clean | n/a (`/admin/*` allowed substrate) | inline JSX (admin-acceptable per [docs/copy-vocabulary.md](copy-vocabulary.md) audience boundary) |
| `src/lib/agent/render-digest.ts` | new (G4+G5) | n/a (no JSX, returns markdown string) | clean (assertion in test) | clean (substrate→category translation) | n/a |

## Verification artefacts

- **`npm test` (full suite):** 1057 tests across 88 files, all green.
- **`npm run lint`:** 0 errors. 18 warnings, all pre-existing
  (the same 18 raw-stone usages elsewhere in the codebase that have
  been flagged for cleanup since 2026-05-03; no new warnings from this
  week's surfaces).
- **`npm run build`:** clean. New routes in the table:
  `/writes`, `/dashboard/agent`, `/admin/agent-runs`,
  `/api/agent/preview`, `/api/cron/agent-run`.
- **Engine self-check (CI):** every PR merged this week passed
  `check:engine` after one round of dogfood feedback. Two flags
  caught and fixed:
    - PR #440: `Couldn't render the preview` heading on
      `agent-preview-island.tsx` was recovery-less in isolation;
      collapsed heading into the dynamic body which already carried
      the canonical recovery shape. (fix commit: 72aad68)
    - PR #441: webhook responses (`GitHub App not configured`,
      `Invalid signature`, `Invalid JSON`) are server-to-server
      strings GitHub reads, not user-facing copy; switched to
      snake_case error codes. (fix commit: 7db93e9)

## Marketing-copy banner trigger correctness

The banner triggers when `shouldShowMarketingBanner(text, moment)`
returns true. Test fixtures that exercise the trigger live in
`src/lib/marketing-copy-detect.test.ts` (15 tests):

| Input shape | Expected | Actual |
|---|---|---|
| empty string | false | ✓ false |
| short marketing-shaped UI string (<200 chars) | false (length floor) | ✓ false |
| long marketing-shaped paragraph (3+ markers) | true | ✓ true |
| long product-update prose (no markers) | false | ✓ false |
| long security disclosure (no markers) | false | ✓ false |
| long input + engine-emitted `moment === "marketing"` | true | ✓ true |
| long input + engine-emitted `moment === "notification"` (no markers) | false | ✓ false |

The threshold of 3 marker hits filters out a single use of
"innovative" or "robust" in real product writing (verified by the
`looksLikeMarketingCopy` test cases); above-threshold examples
include the Phase F `/writes` product-update fixture (eight markers
in three sentences) and the all-hands pre-read fixture (mixed
"strategic initiatives" / "value creation" stack).

## PR comment template variant rendering

The four variants render through `renderDigest(payload)` in
`src/lib/agent/render-digest.ts`. Each variant is exercised against
a fixture in `src/lib/agent/render-digest.test.ts` (19 tests):

| Variant | Header | Trust opener | Body block | Footer |
|---|---|---|---|---|
| `empty` (0-1 flags) | "Setting up your review agent" | (suppressed) | setup-prompt prose + run-a-check link | `ZERO_CHECKS_FOOTER` |
| `drift` (patterns of 2+) | "Flagged for drift this week" | cold-start or warmed-up | top 3 patterns; library-example pair per pattern; warmed-up adds team-accept count | `ZERO_CHECKS_FOOTER` |
| `no-repetition` (2-3 flags, no pattern) | "This week's flags from your team's writing" | cold-start or warmed-up | bulleted isolated flags | `ZERO_CHECKS_FOOTER` |
| `mixed` | "Flagged for drift this week" | cold-start or warmed-up | drift block first, then "Other flags this week" subheading + isolated bullets | `ZERO_CHECKS_FOOTER` |

The locked `ZERO_CHECKS_FOOTER` constant matches the dashboard's
`PAGE_LOCKED_COPY` constant verbatim. `page.test.ts` asserts the
two strings stay aligned (the three-place rule from the roadmap;
the install confirmation modal lands in the GitHub-App follow-up
PR with the same string).

## Findings deferred to a follow-up cleanup PR

These exist on the boundary of the sweep — pre-existing drift on
files I touched but didn't author from scratch. Not blocking the
launch; worth picking up in a small dedicated PR.

1. **`src/app/(authed)/dashboard/explain/explain-client.tsx` raw colors.**
   The textarea on line 230 carries `focus:border-stone-500
   focus:ring-neutral-500`; the over-limit state on lines 229 and
   the character-counter on lines 237/239/255 carry raw `rose-` /
   `amber-` shades. The diff blocks at 725, 734, 1137, 1144, 1319
   carry raw `red-` / `green-` / `emerald-` shades.
   - Recommended fix: refactor the textarea to use the `<Textarea>`
     primitive at `src/components/ui/input.tsx`, which would also
     pick up the canonical focus-state tokens. The diff blocks
     would benefit from `accent-affirm-*` / `accent-concern-*`
     token mapping.
   - Risk of NOT fixing: low. Lint already warns on line 230; the
     other lines aren't in the rule's pattern (the rule scopes to
     `stone-*` only). Customer-visible behaviour is correct.

2. **`/admin/agent-runs` lacks primitive usage.** The cards on this
   page use inline `<div>` + Tailwind classes rather than the `Card`
   primitive. Acceptable for `/admin/*` per the audience boundary,
   but a follow-up could promote this to the same primitive set the
   customer dashboard uses for cross-surface visual consistency
   when the founder is reviewing runs.

3. **18 pre-existing raw-stone warnings elsewhere in the codebase.**
   Tracked in lint output since 2026-05-03; not regressed this
   week. The list:
   - `src/app/(authed)/dashboard/checks/checks-search.tsx:190`
   - `src/app/(authed)/dashboard/runs/[run_id]/page.tsx:527`
   - `src/app/(authed)/dashboard/subscription-panel.tsx:287`
   - `src/app/(marketing)/install/page.tsx:21` — unused import
   - `src/app/(marketing)/onboard/page.tsx:112`
   - `src/app/admin/case-studies/[slug]/log-refinement-button.tsx:114, 189`
   - `src/app/admin/overrides/page.tsx:308, 326`
   - `src/app/admin/page.tsx:422`
   - `src/app/admin/queue/page.tsx:252`
   - `src/app/admin/refinement-log/page.tsx:316`
   - `src/components/admin/command-palette.tsx:301`
   - `src/components/finding-adjust-modal.tsx:168`
   - `src/components/finding-make-rule-modal.tsx:118`
   - `src/components/flag-for-review.tsx:255, 293`

## Sign-off

Sweep date: 2026-05-09.
Surfaces in scope: F1, F2, F3, F4, F5, G1, G2, G3, G4, G5, plus the
GitHub-App follow-up still in PR #441.
Verdict: **green to launch**. The three deferred findings above are
acceptable as launch-day technical debt; they don't surface to
customers and they're already ESLint-tracked for follow-up.
