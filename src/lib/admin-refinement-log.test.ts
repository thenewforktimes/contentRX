/**
 * Tests for the pure refinement-log parser.
 *
 * Exercises `parseRefinementLog` directly with a fixture string so the
 * parser can be checked without going through the server-only file
 * loader.
 */

import { describe, expect, it } from "vitest";
import {
  emptyRefinementLog,
  parseRefinementLog,
} from "./admin-refinement-log-parser";

const FIXTURE = `# Taxonomy refinement log

Some preface text describing the decision criterion.


## Open refinements

### REF-001: ui_label → ui_label + section_header

**Current category:** \`ui_label\` (any short text that names a UI element)

**Proposed split:** Distinguish component-level labels from section-level headers.

**Triggering case:** "Today's focus" from Opendoor scan (SCAN-2026-03-29).

**Architectural consequence:**
- PRF-03 applies to section headers but not to all component labels.
- CON-02 is stricter on section headers than on component labels.

**Verdict:** Pending. Accumulate more triage cases.


## Proposed refinements (auto-detected)

(No auto-detected candidates at the last run.)

### REF-A001: ui_label — auto-proposed split

**Current category:** \`ui_label\`

**Proposed split:** ui_label → ui_label + data_viz_label

**Triggering case:** SCAN-2026-03-29-005 — "VALUE"

**Note:** data_viz_label would suppress PRF-09.

**Date logged:** 2026-03-30

**Verdict:** Pending — more cases needed.


## Approved refinements

(None yet.)


## Declined refinements

### REF-099: previously rejected split

**Current category:** \`error_message\`

**Proposed split:** Skip — the distinction did not change verdict.

**Verdict:** Declined 2026-04-01.
`;

describe("parseRefinementLog", () => {
  it("captures the preface up to the first section header", () => {
    const log = parseRefinementLog(FIXTURE);
    expect(log.preface).toContain("# Taxonomy refinement log");
    expect(log.preface).toContain("decision criterion");
    expect(log.preface).not.toContain("## Open refinements");
  });

  it("partitions entries by section status", () => {
    const log = parseRefinementLog(FIXTURE);
    expect(log.byStatus.open).toHaveLength(1);
    expect(log.byStatus.auto_detected).toHaveLength(1);
    expect(log.byStatus.approved).toHaveLength(0);
    expect(log.byStatus.declined).toHaveLength(1);
    expect(log.entries).toHaveLength(3);
  });

  it("captures load-bearing fields on a hand-written entry", () => {
    const log = parseRefinementLog(FIXTURE);
    const ref001 = log.byStatus.open[0];
    expect(ref001.id).toBe("REF-001");
    expect(ref001.title).toBe("ui_label → ui_label + section_header");
    expect(ref001.current_category).toContain("ui_label");
    expect(ref001.proposed_split).toContain("Distinguish");
    expect(ref001.triggering_case).toContain("Today's focus");
    expect(ref001.architectural_consequence).toContain("PRF-03");
    expect(ref001.verdict).toContain("Pending");
  });

  it("captures auto-detected REF-A* entries with the auto_detected status", () => {
    const log = parseRefinementLog(FIXTURE);
    const auto = log.byStatus.auto_detected[0];
    expect(auto.id).toBe("REF-A001");
    expect(auto.note).toContain("data_viz_label would suppress PRF-09");
    expect(auto.date_logged).toBe("2026-03-30");
  });

  it("returns an empty log for empty input", () => {
    const log = parseRefinementLog("");
    expect(log.entries).toHaveLength(0);
    expect(log.byStatus.open).toHaveLength(0);
  });

  it("emptyRefinementLog returns the canonical empty shape", () => {
    const log = emptyRefinementLog();
    expect(log.preface).toBe("");
    expect(log.entries).toHaveLength(0);
    expect(log.byStatus).toEqual({
      open: [],
      auto_detected: [],
      approved: [],
      declined: [],
    });
  });

  it("ignores non-REF ### headers", () => {
    const log = parseRefinementLog(`## Open refinements

### Some random heading

**Current category:** noise

### REF-042: real entry

**Current category:** \`button_cta\`
**Verdict:** Pending.
`);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].id).toBe("REF-042");
  });
});
