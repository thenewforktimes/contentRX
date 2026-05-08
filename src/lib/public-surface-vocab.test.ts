/**
 * Cross-surface anti-regression: no internal vocabulary in any
 * committed public-facing artifact.
 *
 * Per ADR 2026-04-25 (private taxonomy) and docs/copy-vocabulary.md,
 * a small set of architecture terms and routes are reserved for
 * internal/founder-side surfaces only. The public surfaces — the
 * /accuracy snapshot, weekly /calibration logs, quarterly reports —
 * are the customer-facing render targets and must stay clear of
 * those terms.
 *
 * This test module scans every committed file under those known
 * public surfaces and fires CI failure if it finds any of:
 *
 *   - `substrate`  — internal architecture term (ADR 2026-04-25)
 *   - `/admin/`    — founder-only authenticated routes
 *   - `rationale_chain`, `rule_version`, `related_standards`
 *                  — wire envelope substrate fields, stripped from
 *                    public per ADR 2026-04-25
 *   - `PUBLIC_TAXONOMY` — internal feature-flag env var
 *   - `private taxonomy` — architecture term
 *
 * Real instance of the leak this module guards against: a single
 * line on /calibration/2026-19 read "Override-by-subtype rollups
 * land once the substrate API exposes them. Until then refer to
 * `/admin/queue` for the live count." Two leaks in one sentence.
 * That fix shipped per-generator (PR #388); this module
 * generalizes the guard so the next leak — wherever it tries to
 * land — fails the build before it deploys.
 *
 * What this does NOT scan:
 *   - .tsx / .ts source files. The existing `lint:copy` script
 *     covers customer-visible strings extracted from TSX (see
 *     scripts/lint-customer-strings.ts; this PR extends it with
 *     the same denylist).
 *   - Generator scripts (.py) and READMEs. Those are internal
 *     documentation; "substrate" and "/admin/" are appropriate
 *     there.
 *   - The substrate repo itself (gitignored at runtime). It's
 *     not committed here.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

interface PublicSurface {
  /** Repo-relative directory path. */
  dir: string;
  /** Only files whose basename matches this pattern are scanned.
   * Excludes READMEs, generators, .gitkeep, build artifacts. */
  filePattern: RegExp;
  /** Public route(s) that render this directory's output. Used in
   * the failure message so future readers know what's at stake. */
  rendersAt: string;
}

const PUBLIC_SURFACES: PublicSurface[] = [
  {
    dir: "reports/calibration",
    filePattern: /^\d{4}-\d{2}\.md$/,
    rendersAt: "/calibration/[week]",
  },
  {
    dir: "reports/quarterly",
    filePattern: /^\d{4}-Q\d\.md$/,
    rendersAt: "/reports/quarterly/[id] (when wired)",
  },
  {
    dir: "reports/accuracy",
    filePattern: /^(latest|\d{4}-\d{2})\.json$/,
    rendersAt: "/accuracy",
  },
  {
    dir: "evals/drift/reports",
    filePattern: /^\d{4}-q\d\.json$/,
    rendersAt: "(input to /accuracy via reports/accuracy/generate.py)",
  },
];

interface InternalTerm {
  term: string;
  caseSensitive: boolean;
  reason: string;
}

const INTERNAL_VOCABULARY: InternalTerm[] = [
  {
    term: "substrate",
    caseSensitive: false,
    reason:
      "Reserved internal architecture term per ADR 2026-04-25. " +
      "Public copy refers to specific artifacts (calibration log, " +
      "accuracy snapshot, refinement log) by their customer-facing names.",
  },
  {
    term: "/admin/",
    caseSensitive: true,
    reason:
      "Founder-only authenticated routes. Pointing customers at " +
      "them leaks the existence of internal admin tooling and " +
      "produces dead-end clicks.",
  },
  {
    term: "rationale_chain",
    caseSensitive: true,
    reason:
      "Wire-envelope substrate field stripped from the public API " +
      "envelope per ADR 2026-04-25.",
  },
  {
    term: "rule_version",
    caseSensitive: true,
    reason:
      "Wire-envelope substrate field stripped from the public API " +
      "envelope per ADR 2026-04-25.",
  },
  {
    term: "related_standards",
    caseSensitive: true,
    reason:
      "Wire-envelope substrate field stripped from the public API " +
      "envelope per ADR 2026-04-25.",
  },
  {
    term: "PUBLIC_TAXONOMY",
    caseSensitive: true,
    reason:
      "Internal feature-flag env var name. Customers don't have " +
      "context for it; if the meaning matters publicly, name the " +
      "behaviour without naming the flag.",
  },
  {
    term: "private taxonomy",
    caseSensitive: false,
    reason:
      "Internal architecture term per ADR 2026-04-25. The customer-" +
      "facing framing is 'measured accuracy and calibration log.'",
  },
];

function listPublicFiles(surface: PublicSurface): string[] {
  const fullDir = path.join(REPO_ROOT, surface.dir);
  if (!fs.existsSync(fullDir)) return [];
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!surface.filePattern.test(entry.name)) continue;
    files.push(path.join(fullDir, entry.name));
  }
  return files.sort();
}

function findLeak(
  contents: string,
  term: InternalTerm,
): { line: number; snippet: string } | null {
  const haystack = term.caseSensitive ? contents : contents.toLowerCase();
  const needle = term.caseSensitive ? term.term : term.term.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx < 0) return null;
  const lineStart = contents.lastIndexOf("\n", idx) + 1;
  const lineEnd = contents.indexOf("\n", idx);
  const snippet = contents.slice(
    lineStart,
    lineEnd === -1 ? contents.length : lineEnd,
  );
  const line = contents.slice(0, idx).split("\n").length;
  return { line, snippet: snippet.trim() };
}

describe("public-surface internal vocabulary scan", () => {
  for (const surface of PUBLIC_SURFACES) {
    const files = listPublicFiles(surface);
    if (files.length === 0) {
      // Surface has no files yet (e.g. quarterly reports before the
      // first run). Skip silently — the scan auto-engages once a
      // matching file lands.
      continue;
    }

    describe(`${surface.dir} (renders at ${surface.rendersAt})`, () => {
      for (const file of files) {
        const rel = path.relative(REPO_ROOT, file);
        const contents = fs.readFileSync(file, "utf-8");

        for (const term of INTERNAL_VOCABULARY) {
          it(`${rel} contains no '${term.term}'`, () => {
            const leak = findLeak(contents, term);
            if (leak) {
              throw new Error(
                `\n  ${rel}:${leak.line} contains '${term.term}'.\n` +
                  `  Line: ${leak.snippet}\n` +
                  `  Reason: ${term.reason}\n` +
                  `  Fix: if this file comes from a generator, the ` +
                  `template at the generator source needs updating ` +
                  `(grep for the leaking phrase in reports/*/generate.py). ` +
                  `If hand-edited, replace with customer-facing language.`,
              );
            }
            expect(leak).toBeNull();
          });
        }
      }
    });
  }
});
