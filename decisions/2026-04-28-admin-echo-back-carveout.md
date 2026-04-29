# ADR: Admin echo-back carve-out for substrate-management tools

**Date:** 2026-04-28
**Status:** Accepted
**Owner:** Robert
**Supersedes:** None
**Amends:** [2026-04-25-private-taxonomy-pivot.md](2026-04-25-private-taxonomy-pivot.md)

## Context

The 2026-04-25 private-taxonomy ADR locked the rule that `standard_id` and `rule_version` "are returned in internal substrate API responses (founder-auth) but never rendered on user-facing surfaces (web dashboard cards, MCP response payload, CLI output, Figma plugin UI, GitHub Action PR comments, LSP diagnostic messages, editor extension UI)." That rule was written with violation-rendering surfaces in mind: the designer reading a check result, the engineer seeing a PR-comment diagnostic, the LSP client surfacing an inline warning. In all those cases, an `standard_id` in the response is the system *teaching the user* about the private taxonomy — which is exactly the leak the ADR exists to prevent.

The 2026-04-25 ADR predates the team-plan custom-example tools (`custom_example_add`, `custom_example_list`, `custom_example_search`, `custom_example_remove`) that landed in the MCP server's post-pivot 0.7.0 release. Those tools are a different shape of surface. A team admin uses them to curate strings whose verdict is well-known to that team — phrasings the team has vetted as on-brand (`verdict: "pass"`) or known anti-patterns they don't want regressing (`verdict: "violation"`, paired with the `standard_id` that the team asserts fires on the string). The data flow is:

1. Admin calls `custom_example_add(text, verdict, standard_id, ...)`. The admin **types in** the standard_id.
2. The server stores the entry.
3. Subsequent `custom_example_list` and `custom_example_search` calls return the entry, including the standard_id field the admin originally provided.

When step 3 returns standard_id, it is not the system teaching the admin anything — the admin already knows the value because they typed it. It is the system echoing the admin's own input back so they can audit what they previously curated.

A strict reading of the 2026-04-25 ADR forbids this. A spirit-of-the-ADR reading allows it: the leak the ADR exists to prevent is "non-substrate-tier user learns the taxonomy from the response." Echo-back to the admin who supplied the value doesn't qualify.

The conformance audit completed 2026-04-28 confirmed:

- The MCP `_example_as_dict` helper does return `standard_id` for all four `custom_example_*` tools.
- The `/api/team-custom-examples` API route returns the field unfiltered.
- The route is gated to authenticated team members (via `requireTeamMember()`), with the team-admin gate applied separately for write operations.
- The other MCP tools (`evaluate_copy`, `evaluate_copy_batch`, `classify_moment`) correctly strip substrate at the schema-2.0.0 boundary; this audit found no leak in those.
- No snapshot test currently asserts the strip on `evaluate_copy`-style tools; the existing tests pass without enforcing the constraint.

The decision below carves out the admin-echo-back case explicitly, so future ADR-conformance sweeps can verify mechanically and so future contributors don't strip `standard_id` from `custom_example_*` responses thinking they're fixing a bug.

## Decision

The 2026-04-25 private-taxonomy rule applies to **rendering surfaces** — surfaces where the system tells the user about the taxonomy. It does **not** apply to **echo-back** surfaces — surfaces where the system returns substrate data the same authenticated user just provided.

The carve-out applies when all four conditions hold:

1. **The substrate field was supplied by the same authenticated principal** in a prior request to the same logical resource. (Admin types `standard_id` into `custom_example_add` → admin gets `standard_id` back from `custom_example_list`. Not: admin types `standard_id` into `custom_example_add` → designer sees `standard_id` on a different surface.)
2. **The auth tier is at least team-member.** Anonymous and free-tier users have no curation surface; this carve-out does not create a back-channel for them.
3. **The response is a curation/management view**, not a violation-rendering view. A response like `{id, text, verdict, moment, content_type, standard_id, notes, contribute_upstream, created_at, updated_at}` describing an entry the admin previously created is a curation view. A response like `{issue, suggestion, severity, confidence, standard_id}` describing a fresh evaluation is a violation-rendering view, and `standard_id` must still be stripped from it.
4. **The substrate field is the same one supplied earlier**, byte-for-byte, not a derived or computed taxonomy fact. Echo-back is allowed; teaching is not.

The four `custom_example_*` MCP tools satisfy all four conditions and are explicitly exempt from the strip rule.

The web `/admin/*` routes (founder-auth only) were already exempt under the 2026-04-25 ADR's "internal substrate API responses (founder-auth)" clause; this ADR does not change that.

The standard-rendering MCP tools (`evaluate_copy`, `evaluate_copy_batch`, `classify_moment`) and all five non-MCP user-facing surfaces (web app violation cards, CLI output, Figma plugin UI, GitHub Action PR comments, LSP diagnostics) **remain bound by the strict no-substrate rule**. Nothing about this carve-out relaxes the rule for those.

A snapshot test in `mcp-server/tests/test_custom_examples.py` documents the carve-out by asserting `standard_id` IS present in `custom_example_*` responses. A parallel snapshot test in `mcp-server/tests/test_client.py` (already exists at lines 74-76) asserts `standard_id` is NOT present in `evaluate_copy` responses. Together, the two tests pin the contract: echo-back surfaces include the field; rendering surfaces strip it.

## Consequences

**Positive:**
- The custom_example_* tool workflow stays usable. Admins can audit and remove entries by `standard_id` without round-tripping through `/admin/*` in the browser.
- The ADR-conformance contract becomes mechanically checkable. A future sweep can run the snapshot tests and trust the result.
- The carve-out conditions are tight enough to prevent abuse. The four conditions disqualify hypothetical future leaks (e.g., an "explain a violation by standard_id" endpoint that *generates* taxonomy info from an admin-supplied id is NOT echo-back, because condition 4 fails).

**Negative:**
- The 2026-04-25 ADR's "MCP response payload" line in the strip list now reads ambiguously without this carve-out adjacent. Anyone reading 2026-04-25 in isolation may believe `standard_id` should be stripped from custom_example_* responses; the cross-reference at the top of this ADR is the only mitigation.
- The carve-out introduces a category distinction (rendering vs echo-back) that didn't previously exist in the conformance vocabulary. Future surface additions will need to be classified explicitly.

**Reversibility:**
- This ADR can be superseded by a future ADR if a real leak emerges from the carve-out. The natural reversal would be to strip `standard_id` from `custom_example_*` responses and have admins look it up in `/admin/team-custom-examples` instead. The cost of that reversal is low — it's a one-line change to `_example_as_dict`.

## Out of scope (future work)

The audit also flagged that `/api/team-custom-examples` returns several fields beyond `standard_id` that aren't covered by either the 2026-04-25 strip rule or this carve-out — `createdByUserId`, raw `createdAt` / `updatedAt` timestamps, and the schema's full row shape. Whether those fields belong in the response, and whether they should be filtered for any auth tier, is a separate audit. This ADR does not address it.

The audit also flagged that the `review_ui_copy` MCP prompt's tool description says "citing standards" — imprecise wording, since the prompt body itself does not direct the LLM to cite standards. This is a documentation-copy fix for a future MCP release, not an ADR matter.
