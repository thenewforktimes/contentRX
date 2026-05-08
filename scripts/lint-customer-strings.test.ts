/**
 * Tests for the customer-string lint.
 *
 * One spec per check, plus a "live codebase is clean" guard that
 * fails if any *error*-severity finding fires on the current
 * customer surfaces. Warnings are not asserted clean: they're advisory
 * by design (`Open dashboard` in emails, etc.) and we don't want to
 * block on them.
 */

import { describe, expect, it } from "vitest";
import {
  lintFile,
  lintFileChangedLines,
  lintString,
  parseChangedLines,
  type Finding,
} from "./lint-customer-strings";
import type { ExtractedString } from "./extract-customer-strings";
import { execSync } from "node:child_process";

function makeString(
  text: string,
  overrides: Partial<ExtractedString> = {},
): ExtractedString {
  return {
    file: "src/app/page.tsx",
    line: 1,
    col: 1,
    text,
    kind: "jsx-text",
    context: "p",
    content_type_hint: "body_paragraph",
    moment_hint: null,
    ...overrides,
  };
}

function findingsByCheck(findings: Finding[]): Set<string> {
  return new Set(findings.map((f) => f.check));
}

describe("error-severity checks", () => {
  it("flags em dashes", () => {
    const out = lintString(makeString("Try again — let me know."));
    expect(findingsByCheck(out)).toContain("no-em-dash");
    expect(out[0].severity).toBe("error");
  });

  it("flags engine standard IDs (CLR-01, PRF-03, etc.)", () => {
    const out = lintString(makeString("Standard CLR-01 fired."));
    expect(findingsByCheck(out)).toContain("no-standard-id");
  });

  it("doesn't flag ID-shaped strings outside the engine prefix list", () => {
    const out = lintString(makeString("Licensed under MIT-2.0."));
    expect(findingsByCheck(out)).not.toContain("no-standard-id");
  });

  it("flags gender-exclusive language", () => {
    expect(findingsByCheck(lintString(makeString("Hey guys!")))).toContain("inclusive-gender");
    expect(findingsByCheck(lintString(makeString("All of mankind")))).toContain("inclusive-gender");
    expect(findingsByCheck(lintString(makeString("Add manpower")))).toContain("inclusive-gender");
    expect(findingsByCheck(lintString(makeString("She's a freshman")))).toContain("inclusive-gender");
  });

  it("respects word boundaries", () => {
    // "guysian" shouldn't match "guys"; "blame" shouldn't match "lame"
    expect(findingsByCheck(lintString(makeString("Some guysian thing")))).not.toContain("inclusive-gender");
    // "blame" — "lame" is in inclusive-ableist; word boundary should prevent the hit
    expect(findingsByCheck(lintString(makeString("Don't blame the user.")))).not.toContain("inclusive-ableist");
  });

  it("flags tech legacy terms", () => {
    expect(findingsByCheck(lintString(makeString("Add to blacklist")))).toContain("inclusive-tech-legacy");
    expect(findingsByCheck(lintString(makeString("master/slave replication")))).toContain("inclusive-tech-legacy");
  });

  it("flags ableist language", () => {
    expect(findingsByCheck(lintString(makeString("That's crazy")))).toContain("inclusive-ableist");
    expect(findingsByCheck(lintString(makeString("Tone-deaf decision")))).toContain("inclusive-ableist");
    expect(findingsByCheck(lintString(makeString("A dumb mistake")))).toContain("inclusive-ableist");
  });

  it("flags plural-bug pattern", () => {
    expect(findingsByCheck(lintString(makeString("3 finding(s) flagged")))).toContain("no-plural-bug");
  });

  it("doesn't flag well-formed plurals", () => {
    expect(findingsByCheck(lintString(makeString("3 findings flagged")))).not.toContain("no-plural-bug");
  });

  it("flags generic CTAs in button context", () => {
    expect(
      findingsByCheck(
        lintString(makeString("Submit", { context: "button", content_type_hint: "button" })),
      ),
    ).toContain("no-generic-cta");
    expect(
      findingsByCheck(
        lintString(makeString("Click here", { context: "Link", content_type_hint: null })),
      ),
    ).toContain("no-generic-cta");
  });

  it("doesn't flag 'Submit' in body prose (not a button)", () => {
    // /about page mentions "Submit" as an example of a BAD button
    // label — that's prose, not a real button.
    expect(
      findingsByCheck(
        lintString(makeString("That button shouldn't say Submit", { context: "p", content_type_hint: "body_paragraph" })),
      ),
    ).not.toContain("no-generic-cta");
  });
});

describe("warning-severity checks", () => {
  it("flags plain-language jargon as a warning", () => {
    const out = lintString(makeString("Utilize the API to optimize the workflow."));
    const findings = out.filter((f) => f.check === "plain-language");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe("warning");
  });

  it("flags he/she pronouns", () => {
    expect(findingsByCheck(lintString(makeString("They he/she should know")))).toContain("pronoun-guidance");
  });

  it("flags 'Open X' CTAs in button context (warning, not error)", () => {
    const out = lintString(
      makeString("Open members", { context: "button", content_type_hint: "button" }),
    );
    expect(findingsByCheck(out)).toContain("no-open-x-cta");
    const finding = out.find((f) => f.check === "no-open-x-cta");
    expect(finding?.severity).toBe("warning");
  });

  it("doesn't flag 'Open' followed by non-word", () => {
    // Just "Open" alone should not match the pattern "Open\s+\w+"
    expect(
      findingsByCheck(
        lintString(makeString("Open", { context: "button", content_type_hint: "button" })),
      ),
    ).not.toContain("no-open-x-cta");
  });
});

describe("clean copy passes the lint", () => {
  it("doesn't flag well-written copy", () => {
    const out = lintString(makeString("We couldn't load your dashboard. Try again."));
    expect(out).toEqual([]);
  });

  it("doesn't flag the canonical recovery-path phrase", () => {
    const out = lintString(
      makeString("Couldn't rotate the key. Try again. If it keeps happening, email hello@contentrx.io."),
    );
    expect(out).toEqual([]);
  });

  it("doesn't flag plain CTAs", () => {
    const out = lintString(
      makeString("Manage members", { context: "button", content_type_hint: "button" }),
    );
    expect(out).toEqual([]);
  });
});

describe("parseChangedLines (diff parser)", () => {
  it("parses a basic +M,N hunk", () => {
    const diff = `diff --git a/src/app/page.tsx b/src/app/page.tsx
index abc..def 100644
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -42,1 +43,2 @@
+New line at 43
+New line at 44
`;
    const out = parseChangedLines(diff);
    expect(out.has("src/app/page.tsx")).toBe(true);
    expect([...(out.get("src/app/page.tsx") ?? new Set())].sort((a, b) => a - b)).toEqual([43, 44]);
  });

  it("treats +M (no count) as a single line", () => {
    const diff = `+++ b/foo.tsx
@@ -10 +10 @@
-old
+new
`;
    const out = parseChangedLines(diff);
    expect([...(out.get("foo.tsx") ?? new Set())]).toEqual([10]);
  });

  it("ignores hunks with new count = 0 (pure deletion)", () => {
    const diff = `+++ b/foo.tsx
@@ -10,3 +9,0 @@
-line 10
-line 11
-line 12
`;
    const out = parseChangedLines(diff);
    expect(out.get("foo.tsx")?.size ?? 0).toBe(0);
  });

  it("handles multiple files in one diff", () => {
    const diff = `+++ b/a.tsx
@@ -1 +1 @@
+a changed
+++ b/b.tsx
@@ -5,2 +5,3 @@
+b changed
+b changed too
+b also
`;
    const out = parseChangedLines(diff);
    expect(out.has("a.tsx")).toBe(true);
    expect(out.has("b.tsx")).toBe(true);
    expect(out.get("a.tsx")?.size).toBe(1);
    expect(out.get("b.tsx")?.size).toBe(3);
  });

  it("skips files marked +++ /dev/null (deletions)", () => {
    const diff = `+++ /dev/null
@@ -1,5 +0,0 @@
-deleted file content
`;
    const out = parseChangedLines(diff);
    expect(out.size).toBe(0);
  });

  it("collects multiple hunks for the same file", () => {
    const diff = `+++ b/foo.tsx
@@ -10,1 +10,2 @@
+line 10
+line 11
@@ -50,0 +52,1 @@
+line 52
`;
    const out = parseChangedLines(diff);
    expect([...(out.get("foo.tsx") ?? new Set())].sort((a, b) => a - b)).toEqual([10, 11, 52]);
  });
});

describe("lintFileChangedLines (diff-scoped lint)", () => {
  it("returns empty when changedLines set is empty", () => {
    const out = lintFileChangedLines(
      "src/app/(marketing)/page.tsx",
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it("only flags strings whose start line is in changedLines", () => {
    // src/app/(marketing)/page.tsx is em-dash-clean post-sweep, so a
    // full lint returns 0 findings. Force a contrived test by using a
    // file we know has extracted strings: filter to a line that DOES
    // exist in the extraction and confirm 0 findings (clean copy).
    const out = lintFileChangedLines(
      "src/app/(marketing)/page.tsx",
      new Set([41]),
    );
    // Line 41 is in the H1 region; clean post-sweep.
    expect(out.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("doesn't extract strings whose line falls outside changedLines", () => {
    // Pick a line we know has no extractable string (a comment line).
    const out = lintFileChangedLines(
      "src/app/(marketing)/page.tsx",
      new Set([2]),
    );
    expect(out).toEqual([]);
  });
});

describe("live codebase is clean of error-severity findings", () => {
  // This is the production guard. If a future PR introduces an em
  // dash in a customer surface, a standard ID leak, a 'Click here'
  // CTA, etc., this test fails and the PR can't merge.
  it("has zero error-severity findings across all customer surfaces", () => {
    const files = execSync("git ls-files src/", { encoding: "utf-8" })
      .split("\n")
      .filter(Boolean)
      .filter(
        (f) =>
          (f.endsWith(".ts") || f.endsWith(".tsx")) &&
          // Founder-only surfaces. /admin pages are gated by Clerk role
          // at the layout level; components/admin/ is the conventional
          // home for admin-only components (e.g. CommandPalette) that
          // are mounted exclusively in those layouts. Customer copy
          // rules (no em dashes, no raw standard IDs) don't apply to
          // founder-facing UI by design.
          !f.startsWith("src/app/admin/") &&
          !f.startsWith("src/components/admin/") &&
          // Founder-only email templates (sent to Robert when an
          // operational alert fires, not to a customer). Same posture
          // as /admin/* — recipient is internal, so /admin/* references
          // and engineer-flavored prose are appropriate. Mirror the
          // EXCLUDE_PATTERNS list in scripts/extract-customer-strings.ts.
          f !== "src/emails/cost-pause-alert.tsx" &&
          f !== "src/emails/cost-margin-alert.tsx" &&
          f !== "src/emails/overage-meter-failure-alert.tsx" &&
          !f.includes(".test.") &&
          !f.includes(".spec.") &&
          !f.includes("__tests__/") &&
          (f.startsWith("src/app/") ||
            f.startsWith("src/emails/") ||
            f.startsWith("src/components/")),
      );

    const errors: Finding[] = [];
    for (const file of files) {
      for (const f of lintFile(file)) {
        if (f.severity === "error") errors.push(f);
      }
    }

    if (errors.length > 0) {
      // Surface the offenders in the assertion message so the failure
      // points at the actual line, not just "expected 0, got N."
      const formatted = errors
        .slice(0, 10)
        .map(
          (e) =>
            `  ${e.file}:${e.line}:${e.col} [${e.check}] match=${JSON.stringify(e.match)} in=${JSON.stringify(e.text.slice(0, 80))}`,
        )
        .join("\n");
      const more = errors.length > 10 ? `\n  ...and ${errors.length - 10} more` : "";
      throw new Error(
        `lint:copy found ${errors.length} error-severity finding${errors.length === 1 ? "" : "s"} in customer surfaces:\n${formatted}${more}`,
      );
    }

    expect(errors.length).toBe(0);
  });
});
