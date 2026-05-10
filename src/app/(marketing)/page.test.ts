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

  it("does NOT render the cut commitments (anti-regression for 2026-05-10)", () => {
    // Three commitments cards were dropped 2026-05-10 per Robo's
    // review:
    //   - "Calibrated judgment" — readers don't drill into kappa
    //     from home; /accuracy still reachable via TrustStrip.
    //   - "Style guides we maintain" — disingenuous (we provide
    //     style guidance to the model, not external style guides).
    //   - "Custom rules in context" — Team-plan feature; /pricing
    //     carries the upsell. Home-page real estate goes further on
    //     universally-relevant outcomes.
    // Anti-regression: future edits should not re-introduce these
    // headings without an explicit ADR.
    expect(visible).not.toMatch(/calibrated judgment/i);
    expect(visible).not.toMatch(/style guides we maintain/i);
    expect(visible).not.toMatch(/custom rules in context/i);
  });

  it("renders the OneApprovalCell with the procurement story", () => {
    // 2026-05-10 quadrant rebuild: "Built for your stack" was a
    // 1-hero-card + 3-trust-cards section; replaced with a single
    // OneApprovalCell paired with AgentSection in a 2-up quadrant
    // row. The procurement angle still leads the lower fold; the
    // trust links moved into TrustStrip below.
    expect(source).toContain("OneApprovalCell");
    const oneApprovalVisible = visibleCopy(
      readSource("src/components/one-approval-cell.tsx"),
    );
    expect(oneApprovalVisible).toMatch(/one approval/i);
    expect(oneApprovalVisible).toMatch(/\$39/);
    // Funnels comparison-shoppers to /pricing.
    expect(oneApprovalVisible).toContain('href="/pricing"');
  });

  it("renders the TrustStrip with four trust links", () => {
    // 2026-05-10: Privacy, Security, Install, Accuracy fold from
    // their prior card / commitment treatments into a single inline
    // link strip. /accuracy moved here when the Calibrated judgment
    // commitment got cut, so the moat link still surfaces from body
    // copy (not just the global footer).
    expect(source).toContain("TrustStrip");
    const trustVisible = visibleCopy(
      readSource("src/components/trust-strip.tsx"),
    );
    for (const label of ["Privacy", "Security", "Install", "Accuracy"]) {
      expect(trustVisible).toContain(`label: "${label}"`);
    }
    expect(trustVisible).toContain('href: "/privacy"');
    expect(trustVisible).toContain('href: "/security"');
    expect(trustVisible).toContain('href: "/install"');
    expect(trustVisible).toContain('href: "/accuracy"');
  });

  it("does NOT use the prior Built-for-stack section frame (anti-regression)", () => {
    // 2026-05-10: the "Built for your stack" eyebrow + "Easier to
    // adopt. Safer to ship." H2 came off the page when One approval
    // moved into its own quadrant cell. Anti-regression: if a future
    // edit re-adds those strings, it's reverting the structure.
    expect(visible).not.toMatch(/built for your stack/i);
    expect(visible).not.toMatch(/easier to adopt.{1,4}safer to ship/i);
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
    // /accuracy and /calibration are inline-linked from the body
    // copy. 2026-05-10: the link moved from the (cut) Calibrated
    // judgment commitment card into the TrustStrip alongside
    // Privacy / Security / Install. The body-copy assertion now
    // reads from the trust-strip component source.
    const trustVisible = visibleCopy(
      readSource("src/components/trust-strip.tsx"),
    );
    expect(trustVisible).toMatch(/href:\s*"\/(accuracy|calibration)"/);
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

  it("surfaces the weekly review agent with the digest mock", () => {
    // 2026-05-09: agent block was extracted into AgentSection.
    // 2026-05-10: AgentSection converted from full-width panel to
    // a single quadrant cell (paired with OneApprovalCell). The 3
    // sub-claim cards (Read-only / Deterministic / 0 checks per
    // run) were dropped; the digest mock + headline + 1-line body
    // + CTA carries the cell now. Sub-claims still live in
    // /dashboard/agent for users who want the full breakdown.
    //
    // Pinned: agent eyebrow, headline, Team-plan pricing read,
    // /dashboard/agent CTA, digest-mock category Pills.
    expect(source).toContain("AgentSection");
    expect(agentSectionVisible).toMatch(/weekly review agent/i);
    expect(agentSectionVisible).toMatch(/drift, caught every monday/i);
    // Pricing read: agent ships on the Team plan. Phrasing relaxed
    // 2026-05-10 from "folded into the Team plan" to allow tighter
    // alternatives ("on the Team plan", etc.).
    expect(agentSectionVisible).toMatch(/(folded\s+into\s+the|on\s+the)\s+team\s+plan/i);
    // Funnels visitors to the dashboard preview surface.
    expect(agentSectionVisible).toContain('href="/dashboard/agent"');
    // Digest mock category Pills (the visual that carries the cell).
    expect(agentSectionVisible).toMatch(/Action verbs/);
    expect(agentSectionVisible).toMatch(/Plain language/);
    expect(agentSectionVisible).toMatch(/Accessibility/);
  });

  it("lower fold sits in the order Surfaces → Outcomes → Agent → TrustStrip → Author", () => {
    // 2026-05-10 quadrant rebuild: the lower fold is now five
    // ordered beats: SurfacesGrid (above-fold ends), OutcomesGrid
    // (4-cell quadrant), AgentSection + OneApprovalCell (2-up
    // quadrant row), TrustStrip (inline link strip), AuthorBlock
    // (compact byline). This pins the order so a future edit can't
    // accidentally reorder the visual rhythm.
    const surfacesIdx = visible.indexOf("SurfacesGrid");
    const outcomesIdx = visible.indexOf("OutcomesGrid");
    const agentIdx = visible.indexOf("AgentSection");
    const oneApprovalIdx = visible.indexOf("OneApprovalCell");
    const trustIdx = visible.indexOf("TrustStrip");
    const authorIdx = visible.indexOf("<AuthorBlock");
    expect(surfacesIdx).toBeGreaterThan(-1);
    expect(outcomesIdx).toBeGreaterThan(surfacesIdx);
    expect(agentIdx).toBeGreaterThan(outcomesIdx);
    expect(oneApprovalIdx).toBeGreaterThan(agentIdx);
    expect(trustIdx).toBeGreaterThan(oneApprovalIdx);
    expect(authorIdx).toBeGreaterThan(trustIdx);
  });

  it("renders the OutcomesGrid with four verb-led outcomes", () => {
    // 2026-05-10 quadrant rebuild: OutcomesGrid is a 2x2 grid of
    // four cells (Save time / Save money / Stay consistent /
    // Long-form review). Each cell has a hero visual filling the
    // bottom half. Verb-led labels per Robo's call: single-noun
    // labels ("Time", "Money") felt undernourished, so the
    // eyebrows landed on action phrases.
    //
    // The structural pin: the import + render exist, and the four
    // verb-led labels surface in the component source.
    expect(source).toContain("OutcomesGrid");
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    expect(outcomesVisible).toMatch(/Save time/);
    expect(outcomesVisible).toMatch(/Save money/);
    expect(outcomesVisible).toMatch(/Stay consistent/);
    expect(outcomesVisible).toMatch(/Long-form review/);
    // Funnels visitors to the long-form gallery (cta is passed as
    // a JS object, so the hrefs surface as `href: "/path"` rather
    // than the JSX-attribute form `href="/path"`).
    expect(outcomesVisible).toContain('href: "/writes"');
    // Funnels comparison-shoppers from the Save money cell to /pricing.
    expect(outcomesVisible).toContain('href: "/pricing"');
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
    //
    // 2026-05-10: the /install link moved from a body-copy card
    // into the TrustStrip + remains via the IntegrationRow at the
    // top of the lower fold. Either path satisfies the funnel; the
    // test reads both component sources.
    const trustVisible = visibleCopy(
      readSource("src/components/trust-strip.tsx"),
    );
    const integrationVisible = visibleCopy(
      readSource("src/components/integration-row.tsx"),
    );
    const installInTrust =
      trustVisible.includes('href: "/install"') ||
      trustVisible.includes('href="/install"');
    const installInIntegrationRow =
      integrationVisible.includes('"/install') ||
      integrationVisible.includes('"/install#');
    expect(installInTrust || installInIntegrationRow).toBe(true);
    // Anti-regression: the hero CTA must not bypass /install and
    // route straight to the public Figma community page.
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
