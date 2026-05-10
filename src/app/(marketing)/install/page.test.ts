import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /install page copy-pin. Session 29's acceptance criterion is that
 * a first-time visitor sees MCP / CLI / GitHub Action as the primary
 * surfaces, with Figma alongside rather than leading. This test
 * locks the section order + the real install snippet for each.
 */

const SOURCE = fs.readFileSync(
  path.join(__dirname, "page.tsx"),
  "utf-8",
);

// Visible copy = source minus block/line comments so authorial
// framing notes don't trigger false positives.
const visible = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/.*$/gm, "$1");

describe("/install page source", () => {
  it("renders MCP before GitHub Action before CLI before LSP before Figma", () => {
    // 2026-05-11 reorder. Rationale: every team using MCP probably
    // already has the IDE story covered, so LSP doesn't need to lead;
    // the GitHub Action gates merge on every PR and earns the higher
    // slot. Figma stays last (Coming soon) until publication clears,
    // then flips up.
    const mcpIdx = visible.indexOf('id="mcp"');
    const actionIdx = visible.indexOf('id="action"');
    const cliIdx = visible.indexOf('id="cli"');
    const lspIdx = visible.indexOf('id="lsp"');
    const figmaIdx = visible.indexOf('id="figma"');
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(actionIdx).toBeGreaterThan(mcpIdx);
    expect(cliIdx).toBeGreaterThan(actionIdx);
    expect(lspIdx).toBeGreaterThan(cliIdx);
    expect(figmaIdx).toBeGreaterThan(lspIdx);
  });

  it("carries the real MCP install command", () => {
    expect(visible).toContain("uvx contentrx-mcp");
  });

  it("carries a real LSP install command", () => {
    // 2026-05-11: canonical command moved to `uvx contentrx-lsp`
    // (matches lsp-server/CLAUDE.md and README); `pipx install` and
    // `uv tool install` survive as alternatives. Test accepts any
    // of the three.
    expect(visible).toMatch(
      /uvx contentrx-lsp|uv tool install contentrx-lsp|pipx install contentrx-lsp/,
    );
  });

  it("carries the real CLI install command", () => {
    expect(visible).toContain("pip install contentrx-cli");
  });

  it("carries the GitHub Action snippet with CONTENTRX_API_KEY", () => {
    expect(visible).toContain(".github/workflows/");
    expect(visible).toContain("CONTENTRX_API_KEY");
    expect(visible).toContain("fail-on: violation");
  });

  it("frames the Figma plugin as design-time", () => {
    // Session 29's reframe positioned Figma as design-time, not the
    // flagship. 2026-05-11 polish: Figma is "Coming soon" with a
    // Pill; "alongside" survived in the section title. The test
    // pins design-time framing only — the legacy "alongside" pin
    // is no longer load-bearing.
    expect(visible).toMatch(/design-time/i);
  });

  it("cross-links the public accountability surface", () => {
    for (const href of ["/accuracy", "/dashboard"]) {
      expect(visible).toContain(`href="${href}"`);
    }
  });

  it("does not link to the private /model surface", () => {
    expect(visible).not.toMatch(/href=["']\/model/);
  });

  it("surfaces the dashboard paste flow before the install surfaces (F5)", () => {
    // Phase F5 (2026-05-09 roadmap) lands the dashboard paste flow
    // alongside the developer surfaces. Order pin: paste section
    // sits above MCP so the no-install path is the first thing a
    // founder/PM/ops buyer sees.
    const pasteIdx = visible.indexOf('id="paste"');
    const mcpIdx = visible.indexOf('id="mcp"');
    expect(pasteIdx).toBeGreaterThan(-1);
    expect(pasteIdx).toBeLessThan(mcpIdx);
    // The section's anchor links to /dashboard/explain (the paste-
    // mode surface) and the chip nav adds a Dashboard chip pointing
    // at the new section.
    expect(visible).toContain('href="/dashboard/explain"');
    // 2026-05-11: surface renamed "Dashboard paste mode" → "Dashboard"
    // (the "paste mode" qualifier added noise; the description
    // already explains the no-install paste workflow). The
    // structural pin loosens to "Dashboard" + paste-flow language
    // somewhere in the section.
    expect(visible).toMatch(/Dashboard\.\s+Sign in, paste/i);
  });
});
