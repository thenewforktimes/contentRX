# Essays

Working area for essay drafts. The published artifacts live in
[`contentrx-docs/essays/`](../docs-site/) — drafts here are the
private staging area where the founder iterates before publishing.

The architecture rule (per
[`decisions/2026-04-25-private-taxonomy-pivot.md`](../decisions/2026-04-25-private-taxonomy-pivot.md))
splits the essay flow into two stages:

1. **Draft** — `essays/drafts/<filename>.md` in this repo. Owned by
   the founder via `/admin/essay-drafts`. Saved via Server Action.
   Iterates against the calibration-log entry the essay anchors to.
2. **Publish** — move the finalized markdown into
   `contentrx-docs/essays/` so Nextra picks it up.

Drafts travel through git as part of normal commits — no DB rows, no
out-of-band infra. The named-expert moat depends on the founder's
voice across the cadence; the draft folder is the surface where that
voice gets shaped before the public site ever sees it.

## Editorial standard: anonymize brand names

Specific brands are anonymized in essays. Permanently. The lesson
lives in the strings and the reasoning, not the names.

Why: the underlying use of public-facing UI copy for criticism +
commentary is squarely fair-use, but defending a frivolous lawsuit
from a well-funded brand can cost six figures regardless of who's
right. Anonymization is cheap insurance that costs the essays
nothing — the educational value is in the analysis, not the
attribution. (Decision 2026-05-05.)

Practical patterns:

- "Apple's iPad page" → "a major consumer-electronics homepage"
- "Wells Fargo legalese" → "a major bank's checking-account tooltip"
- "Robinhood label" → "a brokerage app wayfinding label"
- "Mailchimp form CTA" → "a marketing-platform plan-selection CTA"
- A specific competitor → "a competitor"

The strings themselves stay quoted verbatim — that's the data the
essay is reasoning about. Only the source brand gets generalized.

Exceptions: `/sources` cites external systems by name for attribution
purposes (different legal posture: required disclosure, not
criticism). Don't change `/sources`.

## Subdirectories

### `drafts/`

One markdown file per essay-in-progress. The naming convention follows
the ISO week of the calibration log entry the essay anchors to:

```
drafts/<calibration-week>.md   e.g. drafts/2026-15.md
```

The Server Action that saves into this directory writes
filename-validated paths only — names must match
`^[A-Za-z0-9._-]+$` and live under 64 chars. Hidden files (anything
starting with `.`) are excluded from the listing scan, mirroring the
review-sentinel pattern from `reports/`.

Vercel runtime is read-only; saves only land in local checkouts. Local
saves get committed alongside the calibration log entry they reference.
