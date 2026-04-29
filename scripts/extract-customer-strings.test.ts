/**
 * Smoke test for the customer-string extractor.
 *
 * Locks the extractor's contract — given a known fixture, it produces
 * the expected number of strings with the expected kinds and hints.
 * Doesn't pin every string verbatim (the real source files churn);
 * pins the structure so a regression in the AST walker shows up.
 */

import { describe, expect, it } from "vitest";
import {
  extractFromFile,
  isInScope,
  isTrivial,
  normalizeJsxText,
} from "./extract-customer-strings";

describe("normalizeJsxText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeJsxText("  hello   world  ")).toBe("hello world");
    expect(normalizeJsxText("\n  multi\n  line\n  ")).toBe("multi line");
  });

  it("decodes the JSX-default HTML entities", () => {
    expect(normalizeJsxText("don&apos;t")).toBe("don't");
    expect(normalizeJsxText("&ldquo;quoted&rdquo;")).toBe("“quoted”");
    expect(normalizeJsxText("a &amp; b")).toBe("a & b");
  });

  it("decodes &mdash; on purpose so the lint catches em-dash dodges", () => {
    // If someone writes &mdash; thinking the policy applies only to
    // literal U+2014, the extractor surfaces it as a real em dash.
    expect(normalizeJsxText("yes&mdash;but")).toBe("yes—but");
  });
});

describe("isTrivial", () => {
  it("flags empty, single-char, and pure-punctuation fragments", () => {
    expect(isTrivial("")).toBe(true);
    expect(isTrivial("a")).toBe(true);
    expect(isTrivial(".")).toBe(true);
    expect(isTrivial(" ; ")).toBe(true);
    expect(isTrivial("…")).toBe(true);
  });

  it("keeps real prose, even short", () => {
    expect(isTrivial("Yes")).toBe(false);
    expect(isTrivial("OK")).toBe(false);
    expect(isTrivial("Hi.")).toBe(false);
  });
});

describe("isInScope", () => {
  it("includes customer-facing surfaces", () => {
    expect(isInScope("src/app/(marketing)/page.tsx")).toBe(true);
    expect(isInScope("src/app/(authed)/dashboard/page.tsx")).toBe(true);
    expect(isInScope("src/emails/welcome.tsx")).toBe(true);
    expect(isInScope("src/components/sparkline.tsx")).toBe(true);
  });

  it("excludes /admin", () => {
    expect(isInScope("src/app/admin/page.tsx")).toBe(false);
    expect(isInScope("src/app/admin/queue/page.tsx")).toBe(false);
  });

  it("excludes test files", () => {
    expect(isInScope("src/lib/foo.test.ts")).toBe(false);
    expect(isInScope("src/app/page.spec.ts")).toBe(false);
    expect(isInScope("src/__tests__/foo.tsx")).toBe(false);
  });

  it("excludes non-customer paths", () => {
    expect(isInScope("src/lib/auth.ts")).toBe(false);
    expect(isInScope("src/db/schema.ts")).toBe(false);
    expect(isInScope("scripts/check.ts")).toBe(false);
  });
});

describe("extractFromFile (smoke against the live landing page)", () => {
  it("pulls metadata title + description from src/app/(marketing)/page.tsx", () => {
    const out = extractFromFile("src/app/(marketing)/page.tsx");

    const title = out.find((r) => r.kind === "metadata-title");
    const description = out.find((r) => r.kind === "metadata-description");

    expect(title).toBeDefined();
    expect(title?.content_type_hint).toBe("page_title");
    expect(description).toBeDefined();
    expect(description?.content_type_hint).toBe("body_paragraph");
  });

  it("pulls the H1 with content_type_hint='heading'", () => {
    const out = extractFromFile("src/app/(marketing)/page.tsx");
    const h1 = out.find((r) => r.kind === "jsx-text" && r.context === "h1");
    expect(h1).toBeDefined();
    expect(h1?.content_type_hint).toBe("heading");
  });

  it("never emits a row inside a <code> tag", () => {
    const out = extractFromFile("src/app/(marketing)/page.tsx");
    const fromCode = out.filter((r) => r.context === "code");
    expect(fromCode).toEqual([]);
  });

  it("emits stable, sorted-by-line output", () => {
    const out = extractFromFile("src/app/(marketing)/page.tsx");
    const lines = out.map((r) => r.line);
    const sorted = [...lines].sort((a, b) => a - b);
    expect(lines).toEqual(sorted);
  });
});

describe("extractFromFile (API route narrowing)", () => {
  it("only emits NextResponse.json error/message strings, not random literals", () => {
    const out = extractFromFile("src/app/api/checkout/route.ts");
    // Every emitted row should be `kind: "api-error"` with context
    // either "error" or "message" — proves the API-route walker
    // didn't accidentally fall through to the JSX walker.
    expect(out.length).toBeGreaterThan(0);
    for (const row of out) {
      expect(row.kind).toBe("api-error");
      expect(["error", "message"]).toContain(row.context);
      expect(row.content_type_hint).toBe("error_message");
      expect(row.moment_hint).toBe("error_state");
    }
  });
});

describe("extractFromFile (email templates)", () => {
  it("pulls JSX text from src/emails/welcome.tsx", () => {
    const out = extractFromFile("src/emails/welcome.tsx");
    expect(out.length).toBeGreaterThan(0);
    const button = out.find(
      (r) => r.kind === "jsx-text" && r.context === "Button",
    );
    expect(button).toBeDefined();
    expect(button?.content_type_hint).toBe("button");
  });
});
