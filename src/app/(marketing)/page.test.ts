import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Copy-pin tests for the landing page + /about page.
 *
 * Updated 2026-04-29 for Robert's landing rewrite (cut Grammarly
 * contrast + Stripe Radar frame; rebuilt around the brand promise
 * "staff-level content design review, in every repo"). The wedge
 * vocabulary changed: "situation-aware" stayed, "judgment calls"
 * was reframed as "the work without the maintenance" (the prior
 * frame implicitly disrespected style guides; the new frame says
 * the rules are real and ContentRX takes the work of managing
 * them off the human).
 *
 * Tests pin structure, not prose. Robert edits the prose; the
 * tests catch regressions like "the brand promise dropped out of
 * the hero" or "the org callouts walked off the page."
 *
 * Bracketed placeholders (e.g. `{years shipping…}`) must never
 * ship; the shape lets Robert leave fill-in-later notes in the
 * source without shipping them to production.
 */

const ROOT = path.join(__dirname, "..", "..", "..");

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

describe("landing page (src/app/(marketing)/page.tsx)", () => {
  const source = readSource("src/app/(marketing)/page.tsx");
  const visible = visibleCopy(source);

  it("leads with the brand promise (staff-level content design review, in every repo)", () => {
    // The hero h1 is the brand promise. If a future edit weakens
    // the headline (drops "staff" or drops "every repo"), this
    // test fails — staff-level positioning is the whole hook.
    expect(visible).toMatch(/Staff[- ]level content design review/i);
    expect(visible).toMatch(/in every repo/i);
  });

  it("frames the wedge as a style guide you don't have to update", () => {
    // The "situation-aware" term stays as a load-bearing concept;
    // the customer-facing reframe is "style guide you don't have
    // to update" plus "voice in the room when you don't have a
    // content designer at the table."
    expect(visible).toMatch(/style guide/i);
    expect(visible).toMatch(/voice in the room/i);
  });

  it("calls out the model around the model with the diagram", () => {
    // The how-it-works section visualises the pipeline. The
    // <HowItWorksDiagram /> import + render are the structural
    // gate against accidentally dropping the diagram.
    expect(source).toContain("HowItWorksDiagram");
    expect(visible).toMatch(/the model around the model/i);
  });

  it("names the four orgs in the founder credit (Intuit, Meta, Opendoor, PayPal)", () => {
    // The named-expert positioning hinges on the org arc. If a
    // future edit drops one of these, the credibility surface
    // narrows.
    for (const org of ["Intuit", "Meta", "Opendoor", "PayPal"]) {
      expect(visible).toContain(org);
    }
    expect(visible).toMatch(/Robert Ballard/);
  });

  it("links the public accountability surface from the body copy", () => {
    // /accuracy and /calibration are inline-linked from the
    // "why it works" section. The remaining trust surfaces
    // (/sources, /ethics, /privacy, /security) live in the
    // global <SiteFooter>; the body copy doesn't have to carry
    // every cross-link, but it has to walk the reader to at
    // least one accountability surface inline.
    expect(visible).toMatch(/href="\/(accuracy|calibration)"/);
  });

  it("does not link to the private /model surface", () => {
    expect(visible).not.toMatch(/href=["']\/model/);
  });

  it("drops the Session-0 placeholder footer", () => {
    expect(visible).not.toMatch(/placeholder landing/i);
    expect(visible).not.toMatch(/real marketing copy ships in Session/i);
  });

  it("leads with generation-layer surfaces (MCP before Figma)", () => {
    // The Surfaces list must list MCP before Figma — Session 29
    // moved the Figma plugin off the flagship slot, and the
    // post-pivot positioning kept it that way. The surface labels
    // were restructured 2026-04-29 from "<strong>Name.</strong>
    // sentence" to "<strong>Name</strong> for/that-clause" because
    // trailing periods on bold labels read as terminal punctuation
    // (engine flagged them; copy-vocabulary.md confirms).
    const mcpIdx = visible.indexOf("<strong>MCP server</strong>");
    const figmaIdx = visible.indexOf("<strong>Figma plugin</strong>");
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(figmaIdx).toBeGreaterThan(-1);
    expect(mcpIdx).toBeLessThan(figmaIdx);
  });

  it("hero CTA points to /install, not straight to the Figma community page", () => {
    // The hero funnels through /install so first-time visitors
    // see MCP/CLI/Action before Figma.
    expect(visible).toContain('href="/install"');
    expect(visible).not.toMatch(
      /href=["']https?:\/\/(www\.)?figma\.com\/community[^"']*["']\s+className=[^>]*bg-black/,
    );
  });

  it("contains no unresolved bracket placeholders", () => {
    // Unescaped `{…}` pairs that carry TODO-ish notes.
    const matches = visible.match(/\{[^}]*\b(TBD|TODO|placeholder|fill in|bio)[^}]*\}/gi);
    expect(matches ?? []).toEqual([]);
  });
});

describe("/about page (src/app/(marketing)/about/page.tsx)", () => {
  const source = readSource("src/app/(marketing)/about/page.tsx");
  const visible = visibleCopy(source);

  it("is present + names Robert", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(visible).toMatch(/Robert\b/);
  });

  it("flags pending bio content with a placeholder", () => {
    // The copy-pin invariant: Robert's bio stays bracketed until
    // Robert fills it in. Once Robert edits this copy, the
    // placeholder disappears AND this test is replaced with a
    // stronger assertion (author name, specific company, etc.).
    const hasPlaceholder = /\{[^}]*\bbio\b[^}]*\}/.test(visible);
    const hasAuthorStatement = /written by Robert/i.test(visible);
    expect(hasPlaceholder || hasAuthorStatement).toBe(true);
  });

  it("opens a path for disagreement (override, correct, explain)", () => {
    expect(visible).toMatch(/disagree/i);
    expect(visible).toMatch(/correct/i);
    expect(visible).toMatch(/rationale/i);
  });

  it("inline-links at least one accountability surface from the body copy", () => {
    // The full accountability surface (/accuracy, /calibration,
    // /sources, /ethics) is reachable from the global <SiteFooter>
    // shipped with the (marketing) route group's layout. /about can
    // be lighter on inline cross-refs as a result, but at minimum it
    // should still walk the reader to /accuracy from the body — the
    // page is "about the model" and the model's measurement is the
    // load-bearing claim.
    expect(visible).toMatch(/href="\/(accuracy|calibration)"/);
  });

  it("does not link to the private /model surface", () => {
    expect(visible).not.toMatch(/href=["']\/model/);
  });
});
