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

  it("calls out the model around the model with the diagram", () => {
    // The how-it-works section visualises the pipeline. The
    // <HowItWorksDiagram /> import + render are the structural
    // gate against accidentally dropping the diagram.
    expect(source).toContain("HowItWorksDiagram");
    expect(visible).toMatch(/the model around the model/i);
  });

  it("closes with three value-prop cards", () => {
    // The "Why it works" section is the closer. Three load-bearing
    // value props:
    //   1. Calibrated judgment
    //   2. Style guides we maintain
    //   3. Custom rules in context
    // (2026-05-05: third card was "Custom rules in the moment" until
    // the moments→context sweep — `moment` is reserved internal vocab.)
    expect(visible).toMatch(/calibrated judgment/i);
    expect(visible).toMatch(/style guides we maintain/i);
    expect(visible).toMatch(/custom rules in context/i);
  });

  it("surfaces the four buyer/IT value props (One approval, Privacy, Security, Integrations)", () => {
    // The "Built for your stack" section bundles One approval (the
    // procurement-friction killer, promoted from /about), Privacy,
    // Security, and Integrations as one block of 2x2 cards. If a
    // future edit drops one of these card titles, the section goes
    // soft.
    expect(visible).toMatch(/one approval/i);
    expect(visible).toMatch(/\bprivacy\./i);
    expect(visible).toMatch(/\bsecurity\./i);
    expect(visible).toMatch(/\bintegrations\./i);
    // The eyebrow + title hold the section together; if either
    // changes, the section is being meaningfully edited.
    expect(visible).toMatch(/built for your stack/i);
    expect(visible).toMatch(/easier to buy.{1,4}safer to ship/i);
  });

  it("home bio leads with the staff-content-designer claim, not the name", () => {
    // 2026-05-05: bio reordered to lead with credentialing
    // ("ContentRX was built by a staff content designer.") before
    // the name. The claim hooks readers who don't know who Robert
    // is yet.
    expect(visible).toMatch(/ContentRX was built by a staff content designer/);
  });

  it("names the four orgs in the founder credit (Intuit, Meta, Opendoor, PayPal)", () => {
    // The named-expert positioning hinges on the org arc. If a
    // future edit drops one of these, the credibility surface
    // narrows.
    for (const org of ["Intuit", "Meta", "Opendoor", "PayPal"]) {
      expect(visible).toContain(org);
    }
    // "Robert Ballard" can wrap across lines in the JSX source —
    // match across whitespace.
    expect(visible).toMatch(/Robert\s+Ballard/);
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

  it("is present and goes to the moat argument (one designer's judgment)", () => {
    // 2026-05-05: /about was restructured to first-person voice;
    // the named-expert credentialing moved to the home bio. /about
    // now goes straight to the philosophical claim — the rules
    // are looked up, the *judgment* is the moat.
    expect(source.length).toBeGreaterThan(0);
    // Bridges the HTML-encoded apostrophe (`&rsquo;`) with `.{1,10}`
    // so the regex matches both raw `'` and entity-encoded variants.
    expect(visible).toMatch(/one designer.{1,10}s judgment/i);
  });

  it("scrubs the bracketed bio placeholder", () => {
    // 2026-05-05: the {bio: …} placeholder was removed when /about
    // was rewritten — the home bio now does the credentialing work
    // and /about goes straight to the moat argument
    // ("Why one designer's judgment"). This test pins the
    // anti-regression: the bracket-style placeholder must not
    // re-enter /about.
    expect(visible).not.toMatch(/\{[^}]*\bbio\b[^}]*\}/);
  });

  // 2026-05-05: "How to disagree with the model" was dropped (mechanics
  // belong on dashboard help, not the trust page). The disagreement
  // contract now lives implicitly in "Why the model stays honest" via
  // the override signal + calibration log links.

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
