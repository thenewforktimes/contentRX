import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Copy + structure pins for /dashboard/explain (Phase F2).
 *
 * The roadmap (`_private/roadmap-update-2026-05-09.md`) locks the
 * marketing-copy banner wording verbatim. This file pins it. The
 * banner copy lives in three places per the integrity bar (paste-mode
 * banner, install confirmation, PR comment footer) — the latter two
 * land in F4/G3. This test pins the paste-mode placement.
 */

const CLIENT_PATH = path.join(__dirname, "explain-client.tsx");
const PAGE_PATH = path.join(__dirname, "page.tsx");

describe("explain-client.tsx (F2 paste-mode banner)", () => {
  const source = fs.readFileSync(CLIENT_PATH, "utf-8");

  it("ships the marketing-copy banner copy verbatim", () => {
    // Roadmap locks the wording. Drift in this string is a regression.
    // The JSX uses &lsquo; and &rsquo; for the inner curly quotes;
    // the assertion targets the pieces around them so the entity-
    // encoded apostrophes don't trip a literal substring match.
    expect(source).toContain("This looks like persuasive marketing copy.");
    expect(source).toContain(
      "ContentRX is\n        calibrated for product and internal writing",
    );
    expect(source).toContain("expect more");
    expect(source).toContain("worth a look");
    expect(source).toContain("flags than usual.");
  });

  it("imports the shouldShowMarketingBanner trigger from the shared lib", () => {
    // Single source of truth for the trigger logic — the heuristic
    // and engine-moment fallthrough live in src/lib/marketing-copy-detect.
    // The dashboard imports it; future surfaces (PR comment footer,
    // install confirmation) should import the same function.
    expect(source).toContain(
      'import { shouldShowMarketingBanner } from "@/lib/marketing-copy-detect"',
    );
  });

  it("textarea is sized for long-form pasting (rows={10})", () => {
    // F2 acceptance: "First-class paste-a-document UI optimized for
    // long-form." The 4-row textarea read as a string-check field;
    // 10 rows reads as a paste target.
    expect(source).toMatch(/rows=\{10\}/);
  });

  it("placeholder mentions the long-form examples the gallery covers", () => {
    // The placeholder is the second invitation surface (after the
    // page header) for the long-form use case. /writes carries the
    // gallery; the placeholder names the same kinds of writing in a
    // single line so the connection is obvious.
    expect(source).toMatch(/product update email/i);
    expect(source).toMatch(/security advisory/i);
    expect(source).toMatch(/announcement/i);
  });
});

describe("explain/page.tsx (F2 paste-mode header)", () => {
  const source = fs.readFileSync(PAGE_PATH, "utf-8");

  it("invites long-form pasting in the page header", () => {
    // JSX wraps lines mid-phrase; the regexes allow whitespace
    // between words so a future re-wrap doesn't drop the assertion.
    //
    // 2026-05-09 vocab pass: dropped "announcement" from the lede
    // (the word read narrow; "long-form writing your team is
    // shipping" covers the same range without scoping). Pinning
    // "long-form writing" as the structural beat instead.
    expect(source).toMatch(/product\s+update\s+email/i);
    expect(source).toMatch(/security\s+advisory/i);
    expect(source).toMatch(/long-form\s+writing/i);
  });

  it("calls out the document-level outputs that long-form unlocks", () => {
    // The dashboard renders a document-level diagnostic + clean
    // rewrite + categorized flags for inputs over 200 chars. Naming
    // those outputs in the lede tells the user what to expect when
    // they paste a draft.
    expect(source).toMatch(/diagnostic/i);
    expect(source).toMatch(/clean\s+rewrite/i);
    expect(source).toMatch(/categorized\s+flags/i);
  });

  it("does not link to the private /model surface", () => {
    expect(source).not.toMatch(/href=["']\/model/);
  });
});
