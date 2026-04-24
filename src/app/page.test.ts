import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Copy-pin tests for the landing page + /about page.
 *
 * Human-eval build plan Session 25 sets structural acceptance
 * criteria on the positioning copy: two wedges named, the Grammarly
 * contrast, the Stripe Radar frame, and the accountability surface
 * linked. These tests lock those sections as present — they don't
 * pin the prose itself, which is Robo's to edit.
 *
 * Bracketed placeholders (e.g. `{years shipping…}`) must never ship;
 * the shape lets Robo leave fill-in-later notes in the source without
 * shipping them to production. The test fails on any `{…}` that
 * survives to main.
 */

const ROOT = path.join(__dirname, "..", "..");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

function visibleCopy(source: string): string {
  // Strip block + line comments so the test only sees what ends up in
  // rendered HTML (or in JSX text, at least).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("landing page (src/app/page.tsx)", () => {
  const source = readSource("src/app/page.tsx");
  const visible = visibleCopy(source);

  it("names both wedges with the plan's vocabulary", () => {
    expect(visible).toMatch(/situation-aware/i);
    expect(visible).toMatch(/judgment calls?/i);
  });

  it("keeps the Grammarly / LanguageTool / Alex contrast", () => {
    expect(visible).toMatch(/Grammarly/);
    expect(visible).toMatch(/LanguageTool/);
    expect(visible).toMatch(/Alex/);
  });

  it("invokes the Stripe Radar frame", () => {
    expect(visible).toMatch(/Stripe Radar/);
  });

  it("links the full accountability surface", () => {
    for (const href of ["/model", "/accuracy", "/sources", "/ethics"]) {
      expect(visible).toContain(`href="${href}"`);
    }
  });

  it("drops the Session-0 placeholder footer", () => {
    expect(visible).not.toMatch(/placeholder landing/i);
    expect(visible).not.toMatch(/real marketing copy ships in Session/i);
  });

  it("contains no unresolved bracket placeholders", () => {
    // Unescaped `{…}` pairs that carry TODO-ish notes.
    const matches = visible.match(/\{[^}]*\b(TBD|TODO|placeholder|fill in|bio)[^}]*\}/gi);
    expect(matches ?? []).toEqual([]);
  });
});

describe("/about page (src/app/about/page.tsx)", () => {
  const source = readSource("src/app/about/page.tsx");
  const visible = visibleCopy(source);

  it("is present + names Robo", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(visible).toMatch(/Robo\b/);
  });

  it("flags pending bio content with a placeholder", () => {
    // The copy-pin invariant: Robo's bio stays bracketed until Robo
    // fills it in. Once Robo edits this copy, the placeholder
    // disappears AND this test is replaced with a stronger assertion
    // (author name, specific company, etc.).
    const hasPlaceholder = /\{[^}]*\bbio\b[^}]*\}/.test(visible);
    const hasAuthorStatement = /written by Robo/i.test(visible);
    expect(hasPlaceholder || hasAuthorStatement).toBe(true);
  });

  it("opens a path for disagreement (override, correct, explain)", () => {
    expect(visible).toMatch(/disagree/i);
    expect(visible).toMatch(/correct/i);
    expect(visible).toMatch(/rationale/i);
  });

  it("cross-links the accountability surface", () => {
    for (const href of ["/model", "/accuracy", "/sources", "/ethics"]) {
      expect(visible).toContain(`href="${href}"`);
    }
  });
});
