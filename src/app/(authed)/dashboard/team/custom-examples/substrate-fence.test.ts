/**
 * Static-analysis fence: the custom-examples audit surface must not
 * render `e.standardId` (or any other substrate field) as user-visible
 * content.
 *
 * Per ADR 2026-04-25 (private-taxonomy pivot) and CLAUDE.md, taxonomy
 * IDs (CC-12, etc.) are private substrate. The team-rule management UI
 * at `/dashboard/rules` has a documented exception because users
 * need an identifier to enable/disable rules — this page does not.
 * Custom examples are exact-string short-circuits keyed on text +
 * verdict + (optional) moment + content_type. The team owner does not
 * act on the standard ID; rendering it leaks private vocabulary.
 *
 * Originally regressed when this page rendered `<code>{e.standardId}</code>`
 * in the table; fix removed the column. This test catches a future
 * re-add by failing CI before it deploys.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PAGE_PATH = path.resolve(__dirname, "page.tsx");

const SUBSTRATE_FIELDS = [
  "standardId",
  "ruleVersion",
  "relatedStandards",
  "rationaleChain",
  "docsUrl",
] as const;

/** Patterns that indicate a substrate field is being rendered (vs.
 * referenced in a comment, schema definition, or imported type). */
function buildRenderPatterns(field: string): RegExp[] {
  return [
    // `{e.field}` or `{entry.field}` JSX interpolation (the table cell shape)
    new RegExp(`\\{[a-zA-Z_$][\\w$]*\\.${field}\\}`),
    // `<code>...{e.field}...</code>` more generally
    new RegExp(`<[^>]+>\\s*\\{[^}]*\\.${field}[^}]*\\}\\s*<`),
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
    const patterns = buildRenderPatterns(field);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip pure comments
      if (/^\s*(\/\/|\*|\{\s*\/\*)/.test(line)) continue;
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

describe("custom-examples page substrate-leak fence", () => {
  it("does not render substrate fields (standardId, etc.) in the table", () => {
    const source = readFileSync(PAGE_PATH, "utf-8");
    const hits = scan(source);
    if (hits.length > 0) {
      const detail = hits
        .map(
          (h) =>
            `  ${PAGE_PATH}:${h.lineNumber}\n` +
            `    field:  ${h.field}\n` +
            `    line:   ${h.line.slice(0, 200)}`,
        )
        .join("\n\n");
      expect.fail(
        `${hits.length} substrate-leak interpolation(s) on the custom-examples audit surface.\n\n${detail}\n\n` +
          `Per ADR 2026-04-25, private-taxonomy IDs (CC-12, etc.) must ` +
          `not render to product users. If a future product decision ` +
          `requires showing one, document the exception in CLAUDE.md ` +
          `(see the /dashboard/rules carve-out as the precedent).`,
      );
    }
    expect(hits).toEqual([]);
  });

  it("the scanner detects a planted leak (regex smoke test)", () => {
    const synthetic = `
      <code className="font-mono">{e.standardId}</code>
      <span>{entry.ruleVersion}</span>
    `;
    const hits = scan(synthetic);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const fields = new Set(hits.map((h) => h.field));
    expect(fields.has("standardId")).toBe(true);
    expect(fields.has("ruleVersion")).toBe(true);
  });
});
