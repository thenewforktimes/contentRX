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
  // rendered HTML (or in JSX text, at least). Also strip top-level
  // import statements, since component file paths frequently contain
  // brand-vocabulary words inside hyphenated kebab-case identifiers
  // (`hero-verdict-mock`, etc.) that look like word boundaries to a
  // naive regex but aren't customer-visible.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/^import\s[^;]+;$/gm, "");
}

describe("landing page (src/app/(marketing)/page.tsx)", () => {
  const source = readSource("src/app/(marketing)/page.tsx");
  const visible = visibleCopy(source);
  // 2026-05-06 design refresh: the named-author block was extracted
  // into its own component (`src/components/author-block.tsx`) so
  // /home and /about share the byline. Tests that previously asserted
  // on inline page copy now read the component source too.
  const authorBlockVisible = visibleCopy(
    readSource("src/components/author-block.tsx"),
  );
  // 2026-05-10 design refresh: the weekly review agent block was
  // extracted into `src/components/agent-section.tsx` so the digest
  // mock and value-prop copy live alongside each other. Tests that
  // previously asserted on inline page copy now read the agent-
  // section source the same way they read the author-block source.
  const agentSectionVisible = visibleCopy(
    readSource("src/components/agent-section.tsx"),
  );

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
    expect(visible).toMatch(/easier to adopt.{1,4}safer to ship/i);
  });

  it("home byline leads with the staff-content-designer claim", () => {
    // 2026-05-05: bio reordered to lead with credentialing before
    // the name. 2026-05-06: the bio moved into <AuthorBlock> so the
    // structural claim now lives in the component, not inline on the
    // page. The claim still hooks readers who don't know who Robert
    // is yet — it just renders through the component.
    expect(source).toContain("AuthorBlock");
    expect(authorBlockVisible).toMatch(/staff content designer/i);
  });

  it("names the four orgs in the founder credit (Intuit, Meta, Opendoor, PayPal)", () => {
    // The named-expert positioning hinges on the org arc. If a
    // future edit drops one of these, the credibility surface
    // narrows. After 2026-05-06 the arc lives in <AuthorBlock>'s
    // CAREER_ARC array; the test reads the component source.
    for (const org of ["Intuit", "Meta", "Opendoor", "PayPal"]) {
      expect(authorBlockVisible).toContain(org);
    }
    // Robert's name lives in the AuthorBlock's display copy.
    expect(authorBlockVisible).toMatch(/Robert\s+Ballard/);
  });

  it("links the public accountability surface from the body copy", () => {
    // /accuracy and /calibration are inline-linked from the
    // "why it works" section. The remaining trust surfaces
    // (/ethics, /privacy, /security) live in the global
    // <SiteFooter>; the body copy doesn't have to carry every
    // cross-link, but it has to walk the reader to at least one
    // accountability surface inline.
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
    // Surface order in the SurfacesGrid: MCP must appear before
    // Figma. Session 29 moved the Figma plugin off the flagship
    // slot, and the post-pivot positioning kept it that way.
    //
    // 2026-05-09 design pass replaced the prior bullet `<strong>` /
    // `<li>` shape with a card grid (`<SurfacesGrid />`); the
    // ordering pin moves to the source of the surfaces array.
    const gridSource = readSource("src/components/surfaces-grid.tsx");
    const mcpIdx = gridSource.indexOf('name: "MCP server"');
    const figmaIdx = gridSource.indexOf('name: "Figma plugin"');
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(figmaIdx).toBeGreaterThan(-1);
    expect(mcpIdx).toBeLessThan(figmaIdx);
  });

  it("renders the SurfacesGrid in place of the prior bullet list", () => {
    // The 2026-05-09 design pass replaced the bullet `<ul>` with a
    // 6-card grid. The structural pin: the import + render exist,
    // and all six surfaces are named in the grid's data array.
    expect(source).toContain("SurfacesGrid");
    const gridSource = readSource("src/components/surfaces-grid.tsx");
    for (const surface of [
      "Dashboard paste mode",
      "MCP server",
      "LSP server",
      "CLI",
      "GitHub Action",
      "Figma plugin",
    ]) {
      expect(gridSource).toContain(`name: "${surface}"`);
    }
  });

  it("surfaces the weekly review agent with three sub-claims", () => {
    // The 2026-05-09 design pass added a section between
    // SurfacesGrid and Built-for-stack to land the agent value prop
    // (formerly absent from the homepage). Three sub-claim cards
    // (Read-only / Deterministic / 0 checks per run) carry the
    // brand promise; the third gets the accent-affirm treatment as
    // the differentiator. The Try-the-preview link funnels to
    // /dashboard/agent's Run-preview-now button.
    //
    // 2026-05-10 refresh: the section was extracted into
    // <AgentSection /> so the digest mock could live alongside the
    // sub-claim cards. The structural pin is unchanged — the same
    // copy still has to surface — but the assertions now read the
    // agent-section component source.
    expect(source).toContain("AgentSection");
    expect(agentSectionVisible).toMatch(/weekly review agent/i);
    expect(agentSectionVisible).toMatch(/drift, caught every monday/i);
    expect(agentSectionVisible).toMatch(/Read-only\./);
    expect(agentSectionVisible).toMatch(/Deterministic\./);
    expect(agentSectionVisible).toMatch(/0 checks per run\./);
    // Pricing read: agent ships on the Team plan.
    expect(agentSectionVisible).toMatch(/folded\s+into\s+the\s+team\s+plan/i);
    // Funnels visitors to the dashboard preview surface.
    expect(agentSectionVisible).toContain('href="/dashboard/agent"');
  });

  it("agent section sits between SurfacesGrid and Built-for-stack", () => {
    // Section ordering check — the agent section is a section-level
    // beat, not a sub-claim of another section. Pinning order:
    // SurfacesGrid → AgentSection → Built for your stack.
    //
    // 2026-05-10: the OutcomesGrid was added between SurfacesGrid
    // and AgentSection (the new value-prop spine sits above the
    // agent's own sub-section). The agent block still has to land
    // before "Built for your stack"; the SurfacesGrid → AgentSection
    // ordering relaxes to "agent block follows surfaces block,
    // outcomes block in between is allowed."
    const surfacesIdx = visible.indexOf("SurfacesGrid");
    const agentIdx = visible.indexOf("AgentSection");
    const builtIdx = visible.indexOf("Built for your stack");
    expect(surfacesIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeGreaterThan(surfacesIdx);
    expect(builtIdx).toBeGreaterThan(agentIdx);
  });

  it("renders the OutcomesGrid with four named outcomes", () => {
    // 2026-05-10 design refresh: the OutcomesGrid was added between
    // SurfacesGrid and AgentSection to land the four customer-facing
    // outcomes (Time / Money / Consistency / Long-form) that the
    // prior page never surfaced. The structural pin: the import +
    // render exist, and the four outcome labels live in the grid's
    // data array.
    expect(source).toContain("OutcomesGrid");
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    for (const label of ["Time", "Money", "Consistency", "Long-form"]) {
      expect(outcomesVisible).toContain(`label: "${label}"`);
    }
    // Funnels visitors to the long-form gallery.
    expect(outcomesVisible).toContain('href="/writes"');
  });

  it("outcomes section sits between SurfacesGrid and AgentSection", () => {
    // Section ordering check — outcomes is the value-prop spine; the
    // agent section is one of the agentic mechanisms behind those
    // outcomes. Outcomes lands first.
    const surfacesIdx = visible.indexOf("SurfacesGrid");
    const outcomesIdx = visible.indexOf("OutcomesGrid");
    const agentIdx = visible.indexOf("AgentSection");
    expect(surfacesIdx).toBeGreaterThan(-1);
    expect(outcomesIdx).toBeGreaterThan(surfacesIdx);
    expect(agentIdx).toBeGreaterThan(outcomesIdx);
  });

  it("AuthorBlock sits at the page foot, after Commitments", () => {
    // 2026-05-10 design refresh: the named-author block moved to the
    // page foot (and switched to the compact variant) so the load-
    // bearing value props lead the page. The structural pin: the
    // AuthorBlock JSX appears AFTER the "Commitments" eyebrow string.
    const commitmentsIdx = visible.indexOf("Commitments");
    const authorIdx = visible.indexOf("<AuthorBlock");
    expect(commitmentsIdx).toBeGreaterThan(-1);
    expect(authorIdx).toBeGreaterThan(commitmentsIdx);
  });

  it("does not render the deprecated UseCaseToggle component", () => {
    // The UseCaseToggle was a tabbed card showing four kinds of
    // writing. Cut 2026-05-09: the IntegrationRow already proves
    // breadth-of-surface, the lede already names long-form writing,
    // and /writes is the dedicated long-form proof page. A third
    // breadth-statement on the homepage hurt pacing.
    //
    // Asserting against `visible` (post-comment-strip) so the
    // comment in page.tsx that explains the cut isn't itself a
    // false-positive trigger.
    expect(visible).not.toContain("UseCaseToggle");
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

  it("lands the long-form audience in the lede (post-2026-05-09 reword)", () => {
    // F1 originally added a separate supporting-line block under the
    // H1 ("And on the longer-form writing your team sends."). That
    // block was dropped 2026-05-09 (third reword same day) for
    // vertical-spacing reasons — it pushed the IntegrationRow chip
    // row below the fold, which fights the marketing north-star.
    //
    // Long-form coverage moved into the lede paragraph itself
    // ("strings and long-form writing"). The structural assertion
    // follows: long-form has to be named in the hero, somewhere.
    expect(visible).toMatch(/long-form writing/i);
    // Anti-regression on the dropped supporting line.
    expect(visible).not.toMatch(/longer-form writing your team sends/i);
  });

  it("hero lede uses customer-facing vocabulary, not 'verdict'", () => {
    // 2026-05-09 brand-vocabulary call: "verdict" reads as judgey
    // and isn't the calm/confident/charming voice the brand sits in.
    // The hero paragraph drops it; suggestions + rationale carry the
    // same load without the courtroom register. This pins the lede
    // against re-introducing the word on the customer-facing surface
    // most eyes hit first.
    //
    // Note: "verdict" still survives in the engine wire format
    // (api/check response field) and in component / variable names
    // (humanizeVerdict, VerdictHeader, etc.) — those are internal,
    // not customer-visible. A broader sweep is a separate follow-up.
    // This assertion scopes to the landing page only.
    expect(visible).not.toMatch(/\bverdict\b/i);
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
    // /ethics) is reachable from the global <SiteFooter> shipped
    // with the (marketing) route group's layout. /about can be
    // lighter on inline cross-refs as a result, but at minimum it
    // should still walk the reader to /accuracy from the body — the
    // page is "about the model" and the model's measurement is the
    // load-bearing claim.
    expect(visible).toMatch(/href="\/(accuracy|calibration)"/);
  });

  it("does not link to the private /model surface", () => {
    expect(visible).not.toMatch(/href=["']\/model/);
  });
});
