import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /writes copy-pin tests. REFRAMED 2026-05-16 to the locked north
 * star: the gallery now covers the long-form prose that lives in the
 * codebase (README, API reference, PR description, design doc,
 * runbook, changelog), not the 2026-05-09 company-comms set. Tests
 * pin structure (the six labels, the codebase-prose headline, the
 * substrate-clean rendering, the absence of em dashes), not prose.
 * Robert edits the prose; these catch regressions like "an example
 * label dropped out" or "substrate IDs leaked in."
 */

const ROOT = path.join(__dirname, "..", "..", "..", "..");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

function visibleCopy(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("/writes (src/app/(marketing)/writes/page.tsx)", () => {
  const source = readSource("src/app/(marketing)/writes/page.tsx");
  const visible = visibleCopy(source);

  it("lands the codebase-prose headline (north-star reframe 2026-05-16)", () => {
    // Was "longer-form writing your team sends to itself" (company
    // comms, off-thesis); briefly "long-form prose…" before the
    // form-taxonomy framing was dropped 2026-05-16. The locked north
    // star is "the prose that lives in a codebase"; the headline
    // pins that, no "long-form" qualifier.
    expect(visible).toMatch(
      /prose that lives in your codebase/i,
    );
    expect(visible).not.toMatch(/long-form/i);
  });

  it("renders all six gallery example labels", () => {
    // Reframed 2026-05-16 to codebase-resident long-form. The gallery
    // is "complete" when all six land; losing one is the regression
    // to catch.
    for (const label of [
      "README",
      "API reference",
      "PR description",
      "Design doc",
      "Runbook",
      "Changelog",
    ]) {
      expect(visible).toContain(label);
    }
  });

  it("lede mentions every kind of writing the gallery covers", () => {
    // The lede is the one-sentence promise of the page. If a future
    // edit adds an example without naming it in the lede, readers
    // won't know what kind of writing the page covers without
    // scrolling. Pin the lede / use-case names together.
    for (const label of [
      "READMEs",
      "API docs",
      "PR descriptions",
      "Design docs",
      "Runbooks",
      "Changelogs",
    ]) {
      expect(visible).toContain(label);
    }
  });

  it("uses the customer-facing 'Flags' vocabulary, not 'violations'", () => {
    // docs/copy-vocabulary.md and ADR 2026-04-25 fix the
    // customer-facing vocabulary at "flags" and "findings"; the
    // gallery mustn't slip into substrate words.
    expect(visible).not.toMatch(/\bviolations?\b/i);
  });

  it("does not leak engine substrate IDs to the marketing surface", () => {
    // No standard_id, no rule_version, no docs_url — ADR 2026-04-25.
    expect(visible).not.toMatch(/standard_id|rule_version|docs_url/);
  });

  it("does not contain em dashes in customer-visible text", () => {
    // docs/copy-vocabulary.md voice rule 2: no em dashes ever in
    // customer-facing strings. The em dash reads as LLM-flavored
    // prose. Periods, commas, colons, parens, sentence breaks.
    //
    // Comments and JSDoc are stripped by visibleCopy(); this asserts
    // against the rendered text only. Source comments above this
    // file deliberately use em dashes for editorial flow — the
    // visibleCopy() strip means they don't trip the assertion.
    expect(visible).not.toMatch(/—/);
  });

  it("uses the PageHeader primitive (no inlined header)", () => {
    // PageHeader is the canonical owner of every public page's top
    // block — pin the import so the page doesn't drift back to
    // inline header markup.
    expect(source).toContain("PageHeader");
  });
});
