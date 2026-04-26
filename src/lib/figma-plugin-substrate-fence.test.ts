/**
 * Static-analysis fence: substrate field names must never reach the
 * Figma plugin's rendered HTML.
 *
 * Audit 2026-04-26 P1: every other user-facing surface (web app,
 * MCP, CLI, GitHub Action, LSP) has substrate-absence assertions.
 * The Figma plugin is HTML — testing it via vitest's node env can't
 * exercise rendered DOM without a browser harness (Playwright/jsdom),
 * which the team intentionally hasn't adopted.
 *
 * This test does the next-best thing: parses the plugin's source as
 * text and asserts no substrate field name appears inside an HTML
 * template-literal interpolation (`${...substrate_field...}`) or
 * inside an `escapeHtml(...)` call. If a future regression adds e.g.
 * `<span>${v.standard_id}</span>` to a render function, this fence
 * fires loudly.
 *
 * What it does NOT catch:
 *   - Substrate fields stored on `data-*` attributes (e.g.
 *     `data-standard-id="${v.standard_id}"`). Those don't render
 *     visibly but ARE in the DOM. See the targeted exclusion list
 *     below for known-allowed local-storage data attributes.
 *   - Indirect renders via DOM APIs (`element.textContent = ...`).
 *
 * If the plugin grows enough that this static check produces false
 * positives, the right next step is a Playwright fence — until then
 * the static analysis catches the realistic regressions (someone
 * pastes a new render template with substrate fields in it).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PLUGIN_PATH = path.resolve(
  process.cwd(),
  "figma-plugin",
  "ui.html",
);

const SUBSTRATE_FIELDS = [
  "standard_id",
  "rule_version",
  "related_standards",
  "rationale_chain",
  "docs_url",
  "ambiguity_flag",
  "validate_rejection_reason",
] as const;

/** Allowed locations where the field name appears as bookkeeping
 * (not rendered to the user). Each entry is a substring match — if
 * the matched line contains any of these, it's intentionally allowed.
 *
 * Keep this tight. Each entry should be a deliberate, audited use.
 */
const ALLOWED_CONTEXTS = [
  // Comments — pure prose, never rendered.
  /^\s*\/\//,
  /^\s*\*/,
  // The scan-results clipboard export — explicitly developer/triage
  // tooling, not a user-facing render path. Documented in the audit
  // as low-risk (clipboard-only, dev gated).
  /standard_id:\s*v\.standard_id,/,
  /standard_id:\s*r\.standardId,/,
  /standard_id:\s*null,/,
  /display_label:\s*getDisplayLabel\(v\.standard_id\)/,
  // Local-only data assignments — pulled into JS variables for
  // grammar-aware suggestion enrichment, never interpolated into HTML.
  /v\.standard_id\s*\|\|\s*"",\s*v\.suggestion/,
  /standard_id:\s*card\.dataset\.standardId/,
];

/** Regex shapes that, if matched on a non-allowed line, indicate a
 * substrate field has reached a rendered HTML interpolation. */
function buildHtmlInterpolationPatterns(field: string): RegExp[] {
  return [
    // `${...field...}` inside a template literal
    new RegExp(`\\$\\{[^}]*\\b${field}\\b[^}]*\\}`),
    // escapeHtml(v.field) or escapeHtml(...field...)
    new RegExp(`escapeHtml\\([^)]*\\b${field}\\b[^)]*\\)`),
    // innerHTML / outerHTML assignments referencing the field
    new RegExp(`\\.(?:inner|outer)HTML\\s*=\\s*[^;]*\\b${field}\\b`),
  ];
}

interface Hit {
  field: string;
  lineNumber: number;
  line: string;
  shape: string;
}

function scan(source: string): Hit[] {
  const hits: Hit[] = [];
  const lines = source.split("\n");
  for (const field of SUBSTRATE_FIELDS) {
    const patterns = buildHtmlInterpolationPatterns(field);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (ALLOWED_CONTEXTS.some((re) => re.test(line))) continue;
      for (const re of patterns) {
        if (re.test(line)) {
          hits.push({
            field,
            lineNumber: i + 1,
            line: line.trim(),
            shape: re.source,
          });
        }
      }
    }
  }
  return hits;
}

describe("Figma plugin substrate-leak fence", () => {
  it("does not render any substrate field name into HTML", () => {
    const source = readFileSync(PLUGIN_PATH, "utf-8");
    const hits = scan(source);
    if (hits.length > 0) {
      const detail = hits
        .map(
          (h) =>
            `  ${PLUGIN_PATH}:${h.lineNumber}\n` +
            `    field:  ${h.field}\n` +
            `    shape:  ${h.shape}\n` +
            `    line:   ${h.line.slice(0, 200)}`,
        )
        .join("\n\n");
      expect.fail(
        `${hits.length} substrate-leak interpolation(s) detected in figma-plugin/ui.html.\n\n${detail}\n\n` +
          `If this is intentional (developer-only tooling), add a narrow ` +
          `pattern to ALLOWED_CONTEXTS in this test file with a comment ` +
          `explaining why the use is safe.`,
      );
    }
    expect(hits).toEqual([]);
  });

  it("scans the file (smoke test that the path resolves correctly)", () => {
    const source = readFileSync(PLUGIN_PATH, "utf-8");
    expect(source.length).toBeGreaterThan(10_000);
    expect(source).toContain("escapeHtml");
  });

  it("the scanner detects a planted substrate-leak (smoke test for the regex)", () => {
    // Synthetic source with a single deliberate leak — proves the
    // regex actually triggers when it should. Without this, a regex
    // typo could let real leaks pass silently.
    const synthetic = `
      <div>\${v.standard_id}</div>
      <p>\${escapeHtml(v.rule_version)}</p>
    `;
    const hits = scan(synthetic);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const fields = new Set(hits.map((h) => h.field));
    expect(fields.has("standard_id")).toBe(true);
    expect(fields.has("rule_version")).toBe(true);
  });
});
