import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /writes copy-pin tests (Phase F3a, 2026-05-09 roadmap).
 *
 * The route is the long-form gallery — three examples on day 1
 * (product update, security advisory, internal announcement); F3b
 * appends three more on day 2. Tests pin structure (the three labels,
 * the substrate-clean rendering, the absence of em dashes), not
 * prose. Robert edits the prose; these tests catch regressions like
 * "an example label dropped out" or "substrate IDs leaked in."
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

  it("lands the long-form-audience headline", () => {
    expect(visible).toMatch(
      /longer-form writing your team sends to itself/i,
    );
  });

  it("renders all six gallery example labels", () => {
    // F3a labels (day 1): product update, security advisory, internal
    // announcement. F3b labels (day 2): all-hands pre-read, incident
    // update, policy notice. The gallery is "complete" when all six
    // land — losing one is the regression to catch.
    for (const label of [
      "Product update",
      "Security advisory",
      "Internal announcement",
      "All-hands pre-read",
      "Incident update",
      "Policy notice",
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
      "Product updates",
      "Security advisories",
      "Internal announcements",
      "All-hands pre-reads",
      "Incident updates",
      "Policy notices",
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
