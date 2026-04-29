/**
 * Tests for the PR sticky-comment formatter. The GitHub API call
 * itself isn't tested here (network + auth boundary); the comment
 * body shape is what matters and what regresses.
 */

import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  formatComment,
  parseFindings,
  truncate,
} from "./post-engine-check-comment";

type Finding = Parameters<typeof formatComment>[0][number];

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/app/page.tsx",
    line: 41,
    col: 1,
    text: "The content model for product copy.",
    context: "h1",
    content_type_hint: "heading",
    moment_hint: null,
    verdict: "pass",
    severity: "info",
    violations: [],
    review_reason: null,
    latency_ms: 100,
    ...overrides,
  } as Finding;
}

describe("truncate", () => {
  it("returns the input unchanged when under the limit", () => {
    expect(truncate("short")).toBe("short");
  });

  it("cuts long input + appends ellipsis", () => {
    const out = truncate("a".repeat(200), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("parseFindings", () => {
  it("handles empty input", () => {
    expect(parseFindings("")).toEqual([]);
  });

  it("ignores blank lines", () => {
    const f = makeFinding();
    const raw = `\n${JSON.stringify(f)}\n\n`;
    expect(parseFindings(raw)).toHaveLength(1);
  });

  it("parses one finding per line", () => {
    const f1 = makeFinding({ line: 1 });
    const f2 = makeFinding({ line: 2 });
    const raw = [JSON.stringify(f1), JSON.stringify(f2)].join("\n");
    const parsed = parseFindings(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].line).toBe(1);
    expect(parsed[1].line).toBe(2);
  });
});

describe("formatComment", () => {
  it("renders the all-clear case", () => {
    const md = formatComment([]);
    expect(md).toMatch(/0 violations/);
    expect(md).toMatch(/0 reviews/);
    expect(md).toContain("Nothing to flag");
    expect(md).toContain(COMMENT_MARKER);
  });

  it("renders a violation with its issue + suggestion", () => {
    const finding = makeFinding({
      verdict: "violation",
      severity: "error",
      violations: [
        {
          issue: "This error blames the user.",
          suggestion: "Name what the system couldn't do.",
          severity: "high",
          confidence: 0.92,
        },
      ],
    });
    const md = formatComment([finding]);
    expect(md).toMatch(/1 violation/);
    expect(md).toContain("This error blames the user.");
    expect(md).toContain("Name what the system couldn't do.");
    expect(md).toContain("### Violations");
  });

  it("renders a review_recommended in the reviews section", () => {
    const finding = makeFinding({
      verdict: "review_recommended",
      severity: "warning",
      review_reason: "low_confidence_mixed_signals",
    });
    const md = formatComment([finding]);
    expect(md).toMatch(/1 review/);
    expect(md).toContain("### Worth a review");
    expect(md).toContain("low_confidence_mixed_signals");
  });

  it("escapes pipe chars in table cells", () => {
    const finding = makeFinding({
      verdict: "violation",
      severity: "error",
      text: "Pipe | char | breaks tables",
      violations: [
        {
          issue: "Has | a pipe",
          suggestion: "Also | pipes",
          severity: "high",
          confidence: 0.9,
        },
      ],
    });
    const md = formatComment([finding]);
    expect(md).not.toMatch(/[^\\]\| a pipe/);
    expect(md).toContain("\\|");
  });

  it("ends with the comment marker so updates can be deduped", () => {
    const md = formatComment([]);
    expect(md.endsWith(COMMENT_MARKER)).toBe(true);
  });

  it("groups multiple violations and reviews into separate sections", () => {
    const findings = [
      makeFinding({
        verdict: "violation",
        severity: "error",
        violations: [
          {
            issue: "i1",
            suggestion: "s1",
            severity: "high",
            confidence: 0.9,
          },
        ],
      }),
      makeFinding({
        verdict: "review_recommended",
        severity: "warning",
        review_reason: "low_confidence",
      }),
    ];
    const md = formatComment(findings);
    expect(md).toContain("### Violations");
    expect(md).toContain("### Worth a review");
    // Violations should appear before reviews in the output.
    expect(md.indexOf("### Violations")).toBeLessThan(
      md.indexOf("### Worth a review"),
    );
  });
});
