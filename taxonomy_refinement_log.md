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

