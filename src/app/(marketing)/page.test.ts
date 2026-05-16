import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Copy-pin tests for the landing page. (/about retired 2026-05-10.)
 *
 * Updated 2026-05-16 for the locked NORTH STAR reword: "ContentRX
 * is the opinionated editor for the prose that lives in a
 * codebase." The hero h1 + lede were rebuilt around codebase-
 * resident prose (READMEs, API docs, PR/commit copy, error
 * strings) reviewed before anyone else sees it. The prior
 * "staff-level content design review, in every repo" wedge and
 * the "long-form writing your team sends" supporting line were
 * intentionally cut as off-thesis (Docs/Figma is ground we
 * deliberately do not serve). Canonical: _private/product-principles.md.
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
  // 2026-05-10 design refresh: the weekly review agent block was
  // extracted into `src/components/agent-section.tsx` so the digest
  // mock and value-prop copy live alongside each other. Tests that
  // previously asserted on inline page copy now read the agent-
  // section source.
  const agentSectionVisible = visibleCopy(
    readSource("src/components/agent-section.tsx"),
  );

  it("leads with the locked north-star brand promise (codebase-resident prose, before anyone else)", () => {
    // The hero h1 + lede are the brand promise. Per the 2026-05-16
    // NORTH STAR ("the opinionated editor for the prose that lives
    // in a codebase") the durable concepts that must not silently
    // drop out of the hero are: prose, the codebase/repo it lives
    // in, and the before-anyone-else moment. Reword freely — this
    // fails only if the positioning itself walks off the page.
    expect(visible).toMatch(/prose/i);
    expect(visible).toMatch(/codebase|repo/i);
    expect(visible).toMatch(/before (anyone|merge)/i);
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
    // 2026-05-11 six-cell rebuild: OneApprovalCell now lives inside
    // OutcomesGrid (was previously a sibling cell in page.tsx).
    // The structural assertion: outcomes-grid imports + renders it,
    // and the cell's own copy carries the procurement story.
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    expect(outcomesVisible).toContain("OneApprovalCell");
    const oneApprovalVisible = visibleCopy(
      readSource("src/components/one-approval-cell.tsx"),
    );
    expect(oneApprovalVisible).toMatch(/one approval/i);
    expect(oneApprovalVisible).toMatch(/\$39/);
    // Funnels comparison-shoppers to /pricing.
    expect(oneApprovalVisible).toContain('href="/pricing"');
  });

  it("renders the TrustCell with four trust links (Receipts)", () => {
    // 2026-05-11: trust links moved from an inline strip
    // (TrustStrip) into a quadrant cell (TrustCell, eyebrow
    // "Receipts") inside the OutcomesGrid. Privacy, Security,
    // Install, Accuracy still all surface; /accuracy is the moat
    // link the Calibrated judgment commitment used to host.
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    expect(outcomesVisible).toContain("TrustCell");
    const trustVisible = visibleCopy(
      readSource("src/components/trust-cell.tsx"),
    );
    expect(trustVisible).toMatch(/Receipts/);
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

  it("home page no longer renders the AuthorBlock byline", () => {
    // 2026-05-11: the named-author byline was cut from the landing
    // page. /accuracy still surfaces it (the methodology binds
    // tightly to the named author). /about was retired 2026-05-10
    // → /ethics. Anti-regression: the landing should not re-import
    // or re-render AuthorBlock without an explicit ADR.
    expect(visible).not.toContain("AuthorBlock");
    expect(visible).not.toMatch(/Robert Ballard/);
  });

  it("links the public accountability surface from the body copy", () => {
    // /accuracy and /calibration are inline-linked from the body
    // copy. 2026-05-10: link moved from the (cut) Calibrated judgment
    // commitment card into the trust strip. 2026-05-11: trust strip
    // became TrustCell (a quadrant cell inside OutcomesGrid). The
    // body-copy assertion reads from the trust-cell component.
    const trustVisible = visibleCopy(
      readSource("src/components/trust-cell.tsx"),
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
      "Dashboard",
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
    // 2026-05-09: agent extracted into AgentSection.
    // 2026-05-10: converted from panel to quadrant cell.
    // 2026-05-11: AgentSection now renders inside OutcomesGrid
    // (was previously a sibling in page.tsx). Outcomes-grid imports
    // it; agent-section.tsx still owns the copy + digest mock.
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    expect(outcomesVisible).toContain("AgentSection");
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

  it("lower fold sits in the order Surfaces → Outcomes in page.tsx", () => {
    // 2026-05-11 final polish: page.tsx's lower fold is just two
    // ordered beats — SurfacesGrid, OutcomesGrid (the six quadrant
    // cells). The author byline got cut; agent / one-approval /
    // trust cells live INSIDE OutcomesGrid.
    const surfacesIdx = visible.indexOf("SurfacesGrid");
    const outcomesIdx = visible.indexOf("OutcomesGrid");
    expect(surfacesIdx).toBeGreaterThan(-1);
    expect(outcomesIdx).toBeGreaterThan(surfacesIdx);
  });

  it("OutcomesGrid renders the six cells in row order", () => {
    // Cell order inside OutcomesGrid (the six-cell 2x3 grid):
    //   Row 1: SaveTimeCell, SaveMoneyCell
    //   Row 2: OneApprovalCell, AgentSection
    //   Row 3: TrustCell, LongFormCell
    // Pin enforced via JSX-element ordering in the component source.
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    const order = [
      "<SaveTimeCell />",
      "<SaveMoneyCell />",
      "<OneApprovalCell />",
      "<AgentSection />",
      "<TrustCell />",
      "<LongFormCell />",
    ];
    let lastIdx = -1;
    for (const cell of order) {
      const idx = outcomesVisible.indexOf(cell);
      expect(idx, `expected ${cell} in OutcomesGrid`).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("OutcomesGrid surfaces the eyebrow set across the six cells", () => {
    // 2026-05-11 six-cell rebuild. The grid is now 2x3:
    //   Row 1: Save time, Save money (verb-led)
    //   Row 2: One approval, Weekly review agent (mixed)
    //   Row 3: Receipts, Long-form review (mixed)
    //
    // Stay consistent was cut (the WHERE IT RUNS section above
    // already lands the cross-surface story). Anti-regression
    // enforced separately below.
    expect(source).toContain("OutcomesGrid");
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    expect(outcomesVisible).toMatch(/Save time/);
    expect(outcomesVisible).toMatch(/Save money/);
    expect(outcomesVisible).toMatch(/Long-form review/);
    // The Save money cell's CTA funnels to /pricing; the Long-form
    // cell's CTA funnels to /writes. Both CTAs land via the cta
    // prop, so the hrefs surface as `href: "/path"` (JS object
    // form) rather than `href="/path"` (JSX attribute form).
    expect(outcomesVisible).toContain('href: "/writes"');
    expect(outcomesVisible).toContain('href: "/pricing"');
  });

  it("Stay consistent was cut from OutcomesGrid (anti-regression)", () => {
    // 2026-05-11 cut. The WHERE IT RUNS section above the lower
    // fold already lands the cross-surface story (six surface
    // cards in a grid, each with the same engine claim). Adding
    // a second "Stay consistent" cell in the grid duplicated.
    //
    // Anti-regression: a future edit shouldn't quietly re-add
    // this cell without an explicit ADR.
    const outcomesVisible = visibleCopy(
      readSource("src/components/outcomes-grid.tsx"),
    );
    expect(outcomesVisible).not.toMatch(/Stay consistent/);
    expect(outcomesVisible).not.toMatch(/Same call across surfaces/);
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
      readSource("src/components/trust-cell.tsx"),
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

  it("names the codebase-prose artifact range in the lede (2026-05-16 north-star reword)", () => {
    // The old guard pinned "long-form writing" in the lede (F1,
    // 2026-05-09). The 2026-05-16 NORTH STAR retired that frame.
    // The guard's intent is unchanged — the hero must establish
    // breadth, not a single artifact — but the breadth it pins
    // moved from "long-form" to the codebase-prose artifact range.
    // The lede now names READMEs, API docs, and PR/commit copy.
    expect(visible).toMatch(/READMEs/i);
    expect(visible).toMatch(/PR and commit copy|PR\/commit copy|commit copy/i);
    // Anti-regression: the dropped long-form supporting line is now
    // off-thesis (Docs/Figma is ground we deliberately do not
    // serve, per _private/product-principles.md). It must not return.
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

// /about retired 2026-05-10. The page's two paragraphs duplicated
// /ethics (calibration commitment) and /accuracy (the nightly kappa
// publication), and the named-byline moat already lives on the
// homepage via AuthorBlock. The route 308s to /ethics in
// next.config.ts; the prior describe block is dropped here so the
// test surface tracks the live page set.
