# ADR: /sources page retired; transparency commitment folded into /ethics

**Date:** 2026-05-06
**Status:** Accepted
**Owner:** Robert
**Supersedes:** None
**Cross-links:** ADR 2026-04-25 (private-taxonomy-pivot), ADR 2026-04-28 (customer-not-product)

## Context

`/sources` was the public attribution surface. It rendered a card grid of every design system, style guide, and OSS repo the engine leans on, with role + license + opt-out path per entry. It shipped early in the build (Session 14) when the product was structured around a public-facing taxonomy and a "show all the inputs" transparency posture.

Two things shifted that posture:

1. **2026-04-25 — private-taxonomy pivot.** The taxonomy moved private. The public surface narrowed to `/accuracy` + `/calibration` + `/essays` + `/reports` — measured outputs, not internal artifacts. `/sources` was never named in that ADR's public-surface list because it predates the pivot and was always tangential to the moat argument.

2. **Pre-launch legal-risk read.** A dedicated public attribution surface, structured as a card grid, is a *target* for legal scrutiny more than it is a *defense*. It implicitly invites litigation-by-card-grid: every entry is a discrete claim that a maintainer or rights-holder can challenge in isolation. The transparency commitment can be made just as load-bearing in a single section on `/ethics` — and the opt-out path is faster to find on a small commitments page than on a 316-LOC catalog.

The right framing is the load-bearing claim itself: **"every input has an MIT license, a fair-use standing, or a public-style-guide convention behind it."** That sentence belongs on `/ethics`, with the opt-out mailto next to it, not buried at the bottom of a list of cards.

This ADR retires the route, folds the commitment into `/ethics` as Commitment 4 ("No stolen content"), and closes the audit at the corpus level so the new copy is a property of the system rather than a marketing claim.

## Decision

### Retire the route

`src/app/(marketing)/sources/page.tsx` (316 LOC) deleted. The build-time aggregator at `src/lib/sources-data.ts` (~364 LOC) and its test (`sources-data.test.ts`, ~250 LOC) deleted with it — they had no other consumers.

### 308 redirect

`/sources` 308s to `/ethics#no-stolen-content`. Anyone landing on a stale bookmark, search-result link, or external citation arrives at the load-bearing claim and the opt-out path with no second click. The redirect is permanent because the route is gone for good.

### Add Commitment 4 to /ethics

`/ethics` grows from three commitments to four:

1. Privacy
2. Security
3. Customer, not product
4. **No stolen content** — *"ContentRX learns from sources I have rights to use. Other people's work isn't mine to take."*

Body copy makes the load-bearing claim explicit and points to the opt-out mailto. Same first-person Robert voice as the other three commitments; same `<Section>` component, extended with an optional `id` prop so the deep-link target (`#no-stolen-content`) lands below the sticky header via `scroll-mt-16`.

### Close the audit at the corpus level

Pre-merge license audit ran on `external_signal/allow_list.json` and the `"sources"` citations in `src/content_checker/standards/private/standards_library.json`. Audit removed three entries from the allow-list that didn't fit the new claim:

- `calcom/cal.com` (AGPL-3.0)
- `getsentry/sentry` (BUSL-1.1)
- `mdn/content` (CC-BY-SA-2.5 — copyleft variant outside the spec's MIT/Apache/BSD/CC0/ISC list)

No data had been mined from those repos (`external_signal/output/` is empty and gitignored), so removal was clean — no derived data to regenerate. The remaining 17 allow-list entries are MIT or Apache-2.0. Standards-library citations are all industry-standard published style guides (Mailchimp, GOV.UK, Microsoft, Apple HIG, Atlassian, Shopify Polaris, 18F, USWDS), which fit the "public-style-guide convention" leg of the claim.

## What stays

- **The corpus.** Existing licensed inputs continue to inform the model. This is not a corpus freeze.
- **The opt-out path.** Maintainers and rights-holders email `hello@contentrx.io` with subject `[OPTOUT]` and the project name. The mailto is on `/ethics` and on `external_signal/README.md`.
- **The right to add new sources later.** Adding a permissively-licensed input remains a one-PR decision. Anything outside the MIT / Apache / BSD / CC0 / ISC / public-style-guide convention envelope requires a new ADR superseding this one.

## What goes

- The `/sources` route in `src/app/(marketing)/sources/page.tsx`.
- The build-time aggregator at `src/lib/sources-data.ts`.
- Its test at `src/lib/sources-data.test.ts`.
- The `/sources` link in the global footer's Trust column.
- The `/sources` inline link in `/about`'s "Why one designer's judgment" section (repointed to `/ethics#no-stolen-content`).
- The `/sources` mention in `docs/copy-vocabulary.md`'s marketing-pages list and the "sources opt-out" phrasing in the support-email line (repointed to "third-party opt-out").

## Considered and rejected

- **Keep `/sources` as-is.** Page bloat, attracts attention as a litigation-by-card-grid surface, and duplicates a transparency commitment that fits cleanly on `/ethics`. The cost was real (316 LOC + 364 LOC aggregator + 250 LOC test) and the marginal benefit (over a single `/ethics` section + redirect) was small.
- **Go synthetic-only on examples.** Stop relying on any external corpus and generate every example internally. Rejected: introduces model-collapse risk over time and gives up the editorial advantage of grounding in published style guides that have decades of editorial citation behind them.
- **Freeze the corpus.** Lock the current set of inputs and never add another. Rejected: gives up flexibility we may want as the standards library grows. The ADR-supersedes path keeps the option open without committing to it now.

## Sequencing

The corpus was already licensed before this PR landed. The license audit just confirmed that fact and tightened the allow-list to match the new public claim. Sequencing of the PR itself:

1. Audit corpus → remove three license-incompatible repos from `external_signal/allow_list.json`.
2. Add Commitment 4 to `/ethics` with the new `id` prop on the local Section component.
3. Delete `/sources` route + aggregator + test.
4. Append the 308 redirect to `next.config.ts`.
5. Drop the `/sources` link from `site-footer.tsx` + update its test.
6. Repoint the `/about` inline link.
7. Update `docs/copy-vocabulary.md` (marketing-pages list, support-email phrasing, last-refreshed date).
8. Verify (vitest + tsc + lint + lint:copy + build + pytest).
9. Commit + push + open PR.

## Reversibility

Re-instating `/sources` if the catalog grows enough to warrant a dedicated surface again is a one-PR decision. The redirect would come down, a new aggregator could read from a refreshed `STYLE_GUIDE_METADATA` table, and the route would return. No data is lost in the meantime — the transparency commitment lives on `/ethics`, the corpus is unchanged, and the opt-out path is unaffected.

## Cross-links

- **ADR 2026-04-25 (private-taxonomy-pivot).** This ADR is downstream, not a reversal. The 2026-04-25 ADR named `/accuracy` + `/calibration` + `/essays` + `/reports` as the public surface; `/sources` predated the pivot and was always tangential. No superseding ADR for 2026-04-25 is required.
- **ADR 2026-04-28 (customer-not-product).** Commitment 4 extends the same posture outward to non-customers (rights-holders of the inputs) — the same "tool, not data product" stance, applied to the upstream side of the corpus.

## References

- [/ethics Commitment 4](../src/app/(marketing)/ethics/page.tsx) — public-facing position
- [next.config.ts](../next.config.ts) — 308 redirect from `/sources` → `/ethics#no-stolen-content`
- [external_signal/allow_list.json](../external_signal/allow_list.json) — corpus licensing (post-audit)
- [src/content_checker/standards/private/standards_library.json](../src/content_checker/standards/private/standards_library.json) — standards-library citations
- [decisions/2026-04-25-private-taxonomy-pivot.md](./2026-04-25-private-taxonomy-pivot.md) — public-surface scope
- [decisions/2026-04-28-customer-not-product.md](./2026-04-28-customer-not-product.md) — customer-not-product commitments
