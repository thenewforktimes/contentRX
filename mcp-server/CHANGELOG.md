# Changelog — contentrx-mcp

All notable changes to the `contentrx-mcp` package. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package
adheres to semantic versioning.

The PyPI history for this package skipped 0.5.0 and 0.6.0 — those version
numbers were bumped in source but never published. The published progression
is `0.2.0 → 0.3.0 → 0.4.0 → 0.7.0 → 0.8.0 → 0.9.0`.

## [0.9.0] — 2026-05-05

Adds team-rule CRUD over MCP. Closes the agent-authored-rules gap
identified in the Ditto competitive read: an agent inside Cursor /
Claude Code can now create and manage team rules without leaving the
editor (previously a dashboard-only flow).

### Added
- `team_rule_add` — create a disable / override / add rule. Mirrors
  the discriminated-union shape of `POST /api/team-rules`.
- `team_rule_list` — list the team's rules, including stock-standard
  disables/overrides and team-owned add rules.
- `team_rule_update` — patch an existing rule's body. Disable rules
  reject this; override and add rules accept their respective body
  schemas.
- `team_rule_remove` — delete a rule by id.
- `TeamRule` dataclass + `_team_rule_from_json` parser (handles both
  Drizzle camelCase and snake_case payload shapes).

## [0.8.0] — 2026-05-05

Schema 3.0.0 cutover: the three-tier check model collapsed into
length-routed metering. Drops the `segment_type` parameter from
`evaluate_copy` (and the underlying `client.check()`); the size class
is now derived server-side from `text.length` (1 unit per 200
characters, rounded up). Pre-3.0.0 callers that pass `segment_type`
get a `TypeError` (parameter no longer exists). Breaking change for
any caller that explicitly passed `segment_type`; transparent for
the typical caller that relied on the default.

### Changed
- `evaluate_copy` (and `client.check()`) drop the `segment_type`
  parameter. The server auto-routes by text length — short inputs
  (≤200 chars) get the per-finding diff cards; long inputs (>200
  chars) get the rich long-form review with holistic rewrite.
- The `metering` block on responses uses `size_class` ("small" /
  "large") instead of `tier` ("standard" / "document" / "surface").

### Removed
- `segment_type` parameter from `evaluate_copy` / `client.check()`.

## [0.7.0] — 2026-04-28

The first PyPI release after the 2026-04-25 private-taxonomy pivot. The
previously-published 0.4.0 predates the pivot and silently misparses the
new schema-2.0.0 `/api/check` envelope (returns `verdict: "pass"` with
empty violations regardless of what the engine actually flagged) and ships
two tools — `list_standards` and `explain_violation` — that the pivot ADR
explicitly forbids. Anyone running 0.4.0 against the current production
API gets confidently wrong "pass" verdicts. **Upgrade is strongly
recommended; downgrade is not.**

### Added
- `evaluate_copy_batch` — multiple strings in one call, with a `dry_run`
  gate to preview quota cost for batches of 10+.
- `custom_example_add` / `custom_example_list` / `custom_example_search` /
  `custom_example_remove` — Team-plan curation tools for short-circuit
  entries that skip the LLM at `/api/check` time.
- `review_ui_copy` MCP prompt — multi-step review workflow that walks
  every UI string in a file or diff through `classify_moment` +
  `evaluate_copy` and summarises by severity.

### Changed
- `evaluate_copy` and `classify_moment` now parse the schema-2.0.0
  envelope correctly. The public Violation envelope is `{issue,
  suggestion, severity, confidence}` only — `standard_id`, `rule_version`,
  `rationale_chain`, `docs_url`, and `related_standards` are no longer
  in the response shape this client expects.
- Tool descriptions tightened to the post-pivot voice (no rule citations
  in user-facing copy).

### Removed
- `list_standards` tool. Forbidden by the 2026-04-25 ADR (renders the
  private taxonomy).
- `explain_violation` tool. Forbidden by the same ADR (returns substrate
  reasoning chains).

### Fixed
- Schema-version skew: 0.4.0's `CheckResult` parsing assumed pre-pivot
  field names and silently fell through to default values when those
  fields were absent. The 0.7.0 client matches the schema-2.0.0
  contract; verdicts now reflect what the engine actually returned.

### Conformance
- ADR 2026-04-25 (private-taxonomy pivot): `evaluate_copy` and
  `classify_moment` strip substrate at the schema boundary. Snapshot
  test at `tests/test_client.py:74-76`.
- ADR 2026-04-28 (admin echo-back carve-out): `custom_example_*` tools
  intentionally include `standard_id` in responses since the admin
  supplied the value at create time. Snapshot tests at
  `tests/test_custom_examples.py::test_adr_conformance_*`.

## [0.4.0] — pre-pivot (broken against current API)

Last published version before the 2026-04-25 schema-2.0.0 cutover.
Misparses post-pivot API responses; ships banned tools. Yanked from
the active install path by the 0.7.0 release. Documented here only
to clarify the version history for users upgrading from 0.4.0.

## [0.3.0] / [0.2.0] — early releases

Initial PyPI publishes. No release notes preserved.
