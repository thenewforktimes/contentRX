# Taxonomy refinement log

Granularity gaps in the content type taxonomy, surfaced through real-world triage. Each entry captures what the taxonomy can't currently distinguish and whether the distinction would change the tool's behavior.

**Decision criterion:** only split a content type when the distinction would change which standards are evaluated, how they're weighted, or whether a violation is flagged. If the split just makes classification more semantically accurate without changing any downstream behavior, it's not worth the complexity cost. Every new content type multiplies classifier signals, filter routing in `standards_library.json`, and the test matrix.

**Implementation path when a split is approved:** add new type to `content_types` in `standards_library.json` → update `relevant_content_types` on affected standards → add heuristic signals in `classify.py` + JS classifier → update moment detection weights if applicable → write test cases.


## Open refinements

### REF-001: ui_label → ui_label + section_header

**Current category:** `ui_label` (any short text that names or identifies a UI element)

**Proposed split:** Distinguish component-level labels (badges, eyebrows, field labels, toggle labels) from section-level headers that organize content hierarchy (section titles, card headers, page region labels).

**Triggering case:** "Today's focus" from Opendoor scan (SCAN-2026-03-29). Classified as `ui_label` with `wayfinding` moment. Functionally correct — the text IS a label doing wayfinding — but a content designer's mental model distinguishes between a badge label and a section header. The tool treats them identically.

**Architectural consequence:**
- PRF-03 (trailing period) applies to section headers but may not apply to all component labels (e.g., a badge reading "Beta." might be intentional).
- CON-02 (sentence case) is stricter on section headers than on component labels where title case is sometimes conventional.
- Moment detection: section headers imply `wayfinding` more strongly than component labels, which might be `browsing_discovery`.
- Standards weighting: section headers could warrant CLR-01 (plain language) evaluation more strongly — a header is high-visibility content.

**Verdict:** Pending. Accumulate more triage cases to see if the distinction produces verdict-changing differences consistently, or only in edge cases.


### REF-004: PRF-03 — legal-entity-suffix exception in placeholder text

**Current category:** PRF-03 (trailing period on heading / button_cta / ui_label).

**Proposed refinement:** Suppress PRF-03 when the trailing period is part of a legal-entity-suffix abbreviation (`Inc.`, `LLC.`, `Co.`, `Ltd.`, `GmbH.`, `S.A.`, `B.V.`, `Pty.`, `Pte.`, etc.) AND the content_type is `short_ui_copy` or placeholder-flavored.

**Triggering case:** PostHog case study iteration-1, 2026-04-26. Engine flagged "Acme Inc." — placeholder text on the org-name input in `frontend/src/scenes/organization/CreateOrganizationModal.tsx:71` — as a high-severity PRF-03 violation. The period is correct (legal-entity abbreviation); removing it ("Acme Inc") would be wrong. Recorded at `evals/case-studies/posthog/engine_results.jsonl`.

**Architectural consequence:**
- PRF-03 needs a targeted exception: a trailing period on a recognized legal-entity suffix is intentional.
- Most impact lands on placeholder text (example company names) and brand references in microcopy.
- Adjacent pattern worth thinking about: literal brand names with internal/trailing periods (Y.A.S., e.l.f., L.L.Bean) — same "the punctuation is correct" shape, different mechanism.
- Implementation likely: a `LEGAL_ENTITY_SUFFIXES` frozenset in `preprocess.py` (mirrors `BRAND_AMPERSANDS` / `COMMON_ABBREVIATIONS`), checked before flagging PRF-03. Both Python and JS preprocessors need the same allowlist (CI parity gate covers it).

**Date logged:** 2026-04-26

**Verdict:** Pending — single triggering case so far. Accumulate at least one more independent case before adding the exception. Also worth checking: PostHog's other modals likely use "Acme Inc." or similar placeholder, which would be more cases of the same string and not independent. A separate target's similar placeholder (Stripe's "Acme Co.", Linear's "Acme, Inc.") would qualify.


### REF-005: CON-02 — technical-reference proper-noun exception

**Current category:** CON-02 (sentence case enforcement on heading / ui_label / button_cta).

**Proposed refinement:** Add a relaxed branch on CON-02 when content_type is `ui_label` or `heading` AND the moment is `task_execution` (or audience is a technical role) AND the text is a recognized compound technical-noun-phrase (`Source Table`, `Primary Key`, `Foreign Key`, `Public IP`, `Private Subnet`, `Read Replica`, `Pull Request`, etc.).

**Triggering case:** PostHog case study iteration-1, 2026-04-26. Engine flagged "Source Table" — column header in the Data Warehouse "View Link" modal at `frontend/src/scenes/data-warehouse/ViewLinkModal.tsx:106` — as a high-severity CON-02 violation. In data engineering, "Source Table" is a technical compound term referring to a specific database concept; Title Case is conventional for these references in technical UI. PostHog's choice is defensible.

**Architectural consequence:**
- CON-02 needs domain-aware relaxation. Three implementation paths:
  1. Moment-based: `task_execution` + audience signal relaxes CON-02. Risk: too broad — most developer tools live in `task_execution`.
  2. Allowlist-based: a `TECHNICAL_NOUN_PHRASES` frozenset (mirrors `CON02_SAFE_PHRASES`). Cleanest; explicit; trades coverage for precision.
  3. Audience-based: when audience is `developer`, CON-02 is permissive on multi-word capitalized phrases. Riskiest; could mask real violations elsewhere in dev-tool UI.
- Adjacent standards already use allowlists for this kind of exception (`KNOWN_ACRONYMS` for PRF-09, `BRAND_AMPERSANDS` for GRM-04, `CON02_SAFE_PHRASES` for CON-02 itself). Path 2 fits the existing pattern.
- Failure mode to watch: the allowlist becomes a junk drawer of "this is technical so title case is fine" cases that bypass real CON-02 issues in dev tools. Mitigation: every entry needs a triggering case logged here.

**Date logged:** 2026-04-26

**Verdict:** Pending — single triggering case. Accumulate at least 3 distinct technical-reference disagreements (across at least 2 different products) before adding the exception. The cleanest implementation when the bar is met is allowlist-based (path 2) per the existing convention.


## Proposed refinements (auto-detected)

(No auto-detected candidates at the last run.)

Entries in this section are written by
`tools/refinement_candidate_detector.py` (human-eval build plan
Session 34) from the nightly signal dump. Each entry uses `REF-ANNN`
ids so it can't collide with Robo-proposed `REF-NNN` ids. Robo triages
these during the weekly review rhythm; approved candidates move to
`## Approved refinements` below, declined ones to `## Declined
refinements`, and the two-source minimum + verdict-impact test from
the decision criterion still applies even when auto-detection has
fired.


## Approved refinements

(None yet.)


## Declined refinements

(None yet.)

### REF-002: ui_label — proposed split

**Current category:** `ui_label`

**Proposed split:** ui_label → ui_label + data_viz_label

**Triggering case:** SCAN-2026-03-29-005 — "VALUE"

**Note:** data_viz_label would suppress PRF-09 (ALL CAPS), potentially suppress CON-02 (sentence case), and carry different moment weighting since data visualization labels are browsing_discovery by nature, not wayfinding.

**Date logged:** 2026-03-30

**Verdict:** Pending — accumulate more triage cases before deciding.


### REF-003: ui_label — proposed split

**Current category:** `ui_label`

**Proposed split:** ui_label → ui_label + data_viz_label

**Triggering case:** SCAN-2026-03-29-006 — "Engagement is a balance between time & value"

**Note:** data_viz_label would suppress PRF-09 (ALL CAPS), potentially suppress CON-02 (sentence case), and carry different moment weighting since data visualization labels are browsing_discovery by nature, not wayfinding.

**Date logged:** 2026-03-30

**Verdict:** Pending — accumulate more triage cases before deciding.

