/**
 * Tests for the pure README-parsing helpers in admin-case-studies.server.
 *
 * The full server-side scan (file system + JSONL) is FS-side; this
 * suite covers the pure-logic helpers that are easy to break with a
 * future README-template tweak.
 */

import { describe, expect, it } from "vitest";
import {
  extractDescription,
  extractRepo,
} from "./admin-case-studies-parser";

describe("extractDescription", () => {
  it("returns the first real paragraph after the H1, skipping metadata bullets", () => {
    const readme = `# Case study: posthog

Working directory for the posthog case study.

## Source

- **Repo:** \`https://github.com/PostHog/posthog\`
- **Last crawled HEAD:** \`abc123\`
`;
    expect(extractDescription(readme)).toBe(
      "Working directory for the posthog case study.",
    );
  });

  it("collects multi-line paragraphs until the first blank line", () => {
    const readme = `# Case study: x

This is a longer description.
It spans multiple lines.
Three lines actually.

## Source

- **Repo:** \`x\`
`;
    expect(extractDescription(readme)).toBe(
      "This is a longer description. It spans multiple lines. Three lines actually.",
    );
  });

  it("returns null when README has only an H1 + section headings", () => {
    expect(
      extractDescription("# Title\n\n## Section\n- bullet\n"),
    ).toBeNull();
  });

  it("returns null when README is empty", () => {
    expect(extractDescription("")).toBeNull();
  });

  it("ignores `**bold**` lead-in bullets that look like metadata", () => {
    const readme = `# Title

**Status:** open

The real description starts here.

## Section
`;
    expect(extractDescription(readme)).toBe(
      "The real description starts here.",
    );
  });
});

describe("extractRepo", () => {
  it("pulls the repo URL from `**Repo:** \`<url>\`` line", () => {
    const readme = `# x

- **Repo:** \`https://github.com/PostHog/posthog\`
- **HEAD:** \`abc\`
`;
    expect(extractRepo(readme)).toBe("https://github.com/PostHog/posthog");
  });

  it("returns null when no Repo line is present", () => {
    expect(extractRepo("# x\n\nno repo declared\n")).toBeNull();
  });

  it("handles whitespace flexibility in the markdown", () => {
    expect(extractRepo("**Repo:**   `https://example.com/r`")).toBe(
      "https://example.com/r",
    );
  });

  it("does not match a Repo mention inside a normal sentence", () => {
    // We require the bold-asterisk markdown shape — a sentence saying
    // "Repo: foo" without the markdown should not match.
    expect(extractRepo("Repo: https://example.com/r")).toBeNull();
  });
});
