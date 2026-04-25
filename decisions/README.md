# Architectural decisions

This directory holds Architecture Decision Records (ADRs) for ContentRX —
positioning-level choices that shape the build for a long stretch and that
later sessions are not allowed to silently re-litigate.

## When to write one

Write an ADR when a session would otherwise:

- change the public/private boundary on the taxonomy or wire format,
- change the moat hypothesis or named-expert positioning,
- change a "locked" architectural decision in the root [CLAUDE.md](../CLAUDE.md),
- supersede a previous ADR.

ADRs are not for routine implementation choices. Those go in commit messages
and the relevant session block in [BUILD_PLAN_v2.md](../BUILD_PLAN_v2.md).

## Format

Filename: `YYYY-MM-DD-short-slug.md` (one ADR per day max; if you need more,
disambiguate with a suffix).

Frontmatter:

```
**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Superseded by <ADR>
**Owner:** <person>
**Supersedes:** <ADR or "None">
```

Sections, in order: Context, Decision, Alternatives considered, Consequences
(Positive / Negative / Neutral but worth naming), Triggers for revisiting,
References.

The `Triggers for revisiting` section is mandatory. ADRs without falsifiable
revisit conditions are wishes, not decisions.

## Reversal

To reverse an accepted ADR, write a new ADR that supersedes it explicitly.
Update the prior ADR's `Status:` to `Superseded by YYYY-MM-DD-new-adr`.
Never edit a previously-accepted ADR in place — the historical record is
load-bearing for understanding why the architecture is the shape it is.

## Index

- [2026-04-25 — Private taxonomy with public evidence of work](2026-04-25-private-taxonomy-pivot.md)
