import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /dashboard/agent copy-pin test (Phase G3).
 *
 * The roadmap locks the page's intro copy verbatim. The same
 * sentence ships in three places: this page, the install-confirmation
 * modal (G3 follow-up when the GitHub App lands), and the PR-comment
 * footer (src/lib/agent/render-digest.ts). Three places, identical
 * wording. This test pins the page version.
 */

const ROOT = path.join(__dirname, "..", "..", "..", "..", "..");
const PAGE_PATH = path.join(__dirname, "page.tsx");
const ISLAND_PATH = path.join(__dirname, "agent-preview-island.tsx");
const RENDER_PATH = path.join(
  ROOT,
  "src",
  "lib",
  "agent",
  "render-digest.ts",
);

describe("/dashboard/agent (page locked copy + preview interaction)", () => {
  const pageSource = readFileSync(PAGE_PATH, "utf-8");
  const islandSource = readFileSync(ISLAND_PATH, "utf-8");

  it("ships the locked intro copy verbatim from the roadmap", () => {
    // The roadmap pins this sentence; check the load-bearing
    // fragments (page-source uses smart-quote entities for the
    // single quotes in JSX, so we assert against the pieces
    // around them).
    expect(pageSource).toContain(
      "Weekly review agent. A draft pull request every Monday with the patterns ContentRX has flagged across your repo.",
    );
    expect(pageSource).toContain(
      "Read-only. The agent never edits your strings.",
    );
    expect(pageSource).toContain(
      "Cost: 0 checks per run. The agent reads flags your other surfaces have already produced (Figma plugin, GitHub Action, MCP, LSP, CLI, paste mode) and renders them as a weekly digest. Your monthly check limit is unaffected.",
    );
  });

  it("locked footer matches the PR-comment footer (three-place rule)", () => {
    // The roadmap pins this sentence in three places: the dashboard
    // page (here), the install confirmation modal (G3 follow-up),
    // and the PR-comment footer (render-digest.ts). The page and
    // PR-footer instances have to stay aligned.
    const renderSource = readFileSync(RENDER_PATH, "utf-8");
    const lockedFragment =
      "Cost: 0 checks per run. The agent reads flags your other surfaces have already produced (Figma plugin, GitHub Action, MCP, LSP, CLI, paste mode) and renders them as a weekly digest. Your monthly check limit is unaffected.";
    expect(pageSource).toContain(lockedFragment);
    expect(renderSource).toContain(lockedFragment);
  });

  it("renders no em dashes in the page copy (voice rule 2)", () => {
    // visibleCopy = source minus block + line comments; comments may
    // use em dashes editorially, but the rendered page must not.
    const visible = pageSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
    expect(visible).not.toMatch(/—/);
  });

  it("uses 'flags' / 'flagged' vocabulary, never 'violations' or 'verdicts'", () => {
    const visible = pageSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
    expect(visible).not.toMatch(/\bviolations?\b/i);
    expect(visible).not.toMatch(/\bverdicts?\b/i);
    expect(visible.toLowerCase()).toContain("flag");
  });

  it("does not link to the private /admin or /model surfaces", () => {
    expect(pageSource).not.toMatch(/href=["']\/(admin|model)/);
  });

  it("ships the Run preview now interaction in the client island", () => {
    expect(islandSource).toContain('"use client"');
    expect(islandSource).toContain("Run preview now");
    expect(islandSource).toContain("/api/agent/preview");
  });

  it("preview island renders the cost framing alongside the button", () => {
    // The "0 checks consumed" microcopy reinforces the locked-copy
    // promise next to the button so the trust math reads at the
    // moment of click.
    expect(islandSource).toContain("0 checks consumed");
  });
});
