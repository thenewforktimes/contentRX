/**
 * Static-analysis fence: the V1 agent runtime path imports zero
 * Anthropic SDK. Phase G1 acceptance criterion (per the 2026-05-09
 * roadmap):
 *
 *   "Zero checks consumed per run, asserted by the absence of any
 *    Anthropic SDK import in the agent runtime path."
 *
 * The agent is a renderer, not a generator. Every piece of substance
 * in its output already exists in the team's database before the
 * worker runs. This test scans the runtime files and fails loudly if
 * a future change accidentally pulls the SDK into the path — the V1
 * trust math collapses the moment a single LLM call sneaks in.
 *
 * Files in scope:
 *   - src/lib/agent/run-agent.ts          — worker entry
 *   - src/lib/agent/pattern-grouping.ts   — clustering logic
 *   - src/app/api/cron/agent-run/route.ts — cron handler
 *
 * Anything those files import transitively is also banned from
 * containing an Anthropic SDK import; tested at the source level here
 * (a transitive guard would require dependency analysis tooling we
 * haven't wired up).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");

const RUNTIME_FILES: readonly string[] = [
  "src/lib/agent/run-agent.ts",
  "src/lib/agent/pattern-grouping.ts",
  "src/app/api/cron/agent-run/route.ts",
];

const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  // ESM imports
  /from\s+["']@anthropic-ai\//,
  /import\s*\(\s*["']@anthropic-ai\//,
  // require() forms
  /require\s*\(\s*["']@anthropic-ai\//,
  // Direct API URL strings — defense in depth against an HTTP-only
  // implementation that bypasses the SDK.
  /api\.anthropic\.com/,
];

interface Hit {
  file: string;
  lineNumber: number;
  line: string;
  pattern: string;
}

function scan(source: string, file: string): Hit[] {
  const hits: Hit[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip block comment-only lines and pure // comments — comments
    // about the rule itself shouldn't trip the fence.
    if (/^\s*(\/\/|\*|\{\s*\/\*)/.test(line)) continue;
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(line)) {
        hits.push({
          file,
          lineNumber: i + 1,
          line: line.trim(),
          pattern: re.source,
        });
      }
    }
  }
  return hits;
}

describe("agent runtime path zero-LLM fence", () => {
  it("imports zero Anthropic SDK across the worker, grouping, and cron route", () => {
    const allHits: Hit[] = [];
    for (const rel of RUNTIME_FILES) {
      const abs = path.join(ROOT, rel);
      const source = readFileSync(abs, "utf-8");
      allHits.push(...scan(source, rel));
    }
    if (allHits.length > 0) {
      const detail = allHits
        .map(
          (h) =>
            `  ${h.file}:${h.lineNumber}\n` +
            `    pattern: ${h.pattern}\n` +
            `    line:    ${h.line.slice(0, 200)}`,
        )
        .join("\n\n");
      expect.fail(
        `${allHits.length} forbidden import(s) on the agent runtime path.\n\n${detail}\n\n` +
          `Phase G1 acceptance: zero checks consumed per run, ` +
          `asserted by the absence of any Anthropic SDK import in the ` +
          `agent runtime path. If V2 (G3 onward) adds LLM calls per ` +
          `cluster's suggestion, those calls live OUTSIDE these three ` +
          `files and the V1 fence stays green.`,
      );
    }
    expect(allHits).toEqual([]);
  });

  it("the scanner detects a planted import (regex smoke test)", () => {
    const synthetic = `
      import Anthropic from "@anthropic-ai/sdk";
      const url = "https://api.anthropic.com/v1/messages";
    `;
    const hits = scan(synthetic, "synthetic.ts");
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
