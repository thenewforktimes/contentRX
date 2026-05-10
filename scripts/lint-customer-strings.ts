/**
 * Mechanical lint over the extracted customer strings.
 *
 * PR 2/3 of 5 in the dogfood loop. Reads the output of PR 1's
 * extractor (scripts/extract-customer-strings.ts) and runs
 * deterministic checks against each string. Two severity levels:
 *
 *   - error   → CI fails (blocks merge). The non-negotiables.
 *   - warning → CI emits, doesn't block. Style suggestions.
 *
 * The non-mechanical stuff (calm/confident/charming balance,
 * recovery-path quality, prose tone) is what PR 4's engine check
 * will catch. This script handles the high-frequency patterns the
 * audit kept finding.
 *
 * Usage:
 *
 *   npm run lint:copy                          # lint everything
 *   npm run lint:copy -- --pretty              # human-readable
 *   npm run lint:copy -- --warnings-as-errors  # strict mode
 *   npm run lint:copy -- --files=a.tsx,b.ts    # specific files
 *   npm run lint:copy -- --diff                # only strings on
 *                                              # changed lines (vs
 *                                              # origin/main)
 *   npm run lint:copy -- --diff=HEAD~1         # vs a specific ref
 *
 * Exits 0 when no errors, 1 when any error-severity finding fires.
 *
 * Diff mode (PR 3): runs `git diff --unified=0` against the base
 * ref, parses the +M,N hunk headers to compute changed line ranges,
 * and filters extracted strings to those whose start line falls in
 * a changed range. The full-codebase guard in
 * lint-customer-strings.test.ts still enforces zero error-severity
 * findings on main, so we can't accumulate skipped violations
 * silently. CI uses --diff on PRs, full lint on push to main.
 */

import { argv, exit, stderr, stdout } from "node:process";
import { extractFromFile, isInScope, type ExtractedString } from "./extract-customer-strings";
import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();

// -----------------------------------------------------------------------------
// Check definitions
// -----------------------------------------------------------------------------

type Severity = "error" | "warning";

type Check = {
  /** Stable identifier for suppression / reporting. */
  id: string;
  /** error blocks merge; warning surfaces only. */
  severity: Severity;
  /** One-line explanation. Surfaces in lint output. */
  description: string;
  /** Returns the matching substring + its index, or null if no match. */
  match: (s: ExtractedString) => { substring: string; index: number } | null;
};

/**
 * Match a regex; return the first hit's substring + start index. The
 * regex MUST be sticky/global-free for this helper. Use word boundaries
 * (`\b`) for whole-word matches.
 */
function regexMatch(pattern: RegExp): Check["match"] {
  return (s) => {
    const m = pattern.exec(s.text);
    return m ? { substring: m[0], index: m.index } : null;
  };
}

/**
 * Engine standard ID prefixes per src/content_checker/labels.py and
 * the standards library. Anchoring the ID lint to known prefixes
 * avoids false positives on unrelated patterns like "MIT-2.0" or
 * "ISO-9001."
 */
const STANDARD_ID_PATTERN = /\b(GRM|CON|CLR|VT|STR|ACT|ACC|INC|TRN|PRF|TEAM)-\d{2,3}\b/;

const CHECKS: Check[] = [
  // ---------------------------------------------------------------------------
  // Errors (CI fails)
  // ---------------------------------------------------------------------------
  {
    id: "no-em-dash",
    severity: "error",
    description: "Em dashes (U+2014) read as LLM-flavored. Use period, comma, colon, parens, or a sentence break.",
    match: regexMatch(/—/),
  },
  {
    id: "no-standard-id",
    severity: "error",
    description: "Substrate IDs (CLR-01, PRF-03, etc.) never appear on customer surfaces per ADR 2026-04-25.",
    match: regexMatch(STANDARD_ID_PATTERN),
  },
  {
    id: "inclusive-gender",
    severity: "error",
    description: "Gender-exclusive language. See docs/copy-vocabulary.md prohibited terms.",
    match: regexMatch(
      /\b(guys|dudes|bros|mankind|manpower|man-hours|businessman|businessmen|chairman|chairmen|salesman|salesmen|freshman|freshmen)\b/i,
    ),
  },
  {
    id: "inclusive-tech-legacy",
    severity: "error",
    description: "Tech legacy terminology has settled industry replacements (master/slave → primary/secondary; blacklist/whitelist → blocklist/allowlist).",
    match: regexMatch(/\b(master\/slave|slave\/master|blacklist|whitelist|blacklisted|whitelisted)\b/i),
  },
  {
    id: "inclusive-ableist",
    severity: "error",
    description: "Casual ableism. See docs/copy-vocabulary.md prohibited terms.",
    match: regexMatch(/\b(crazy|insane|tone-deaf|dummy|dumb)\b/i),
  },
  {
    id: "no-plural-bug",
    severity: "error",
    description: "Plural-bug pattern. Use a ternary instead of (s).",
    match: regexMatch(/\b\d+ \w+\(s\)/),
  },
  {
    id: "no-violation-customer-word",
    severity: "error",
    description:
      'Customer surfaces use "Findings" (and the new severity ladder: "Don\'t ship" / "Worth adjusting" / "Quick polish"). "Violation" / "Violations" stays in the API + DB only. See docs/copy-vocabulary.md and ADR 2026-04-29 §9.',
    // Match standalone "Violation" / "Violations" / "violation" /
    // "violations" — not part of a larger word like "violationary"
    // or "non-violation-y". Inline code spans + raw enum values
    // (passed through as JSX text) get caught; comments are
    // pre-stripped by the extractor.
    match: regexMatch(/\bViolations?\b/),
  },
  {
    id: "no-internal-substrate-vocab",
    severity: "error",
    description:
      'Reserved internal architecture term per ADR 2026-04-25. The customer-facing language for what the model leans on is "calibration log" / "accuracy snapshot" / "refinement log" / "standards" — never "substrate." See docs/copy-vocabulary.md.',
    // Word-boundary match so "substrate-aware" or "substrate" both
    // catch, but not random substrings.
    match: regexMatch(/\bsubstrate\b/i),
  },
  {
    id: "checks-not-strings",
    severity: "error",
    description:
      'Customer surfaces call user-submitted content "checks," not "strings." Robert\'s call: a pasted essay or PRD is not a string. The word "string" is a developer-API term and stays in API docs, type signatures, and DB schema. Customer prose uses "check" (singular) or "checks" (plural). See docs/copy-vocabulary.md.',
    // Word-boundary match catches "string" / "strings" but not
    // "stringify" / "stringent" / hyphenated technical compounds.
    match: regexMatch(/\bstrings?\b/i),
  },
  {
    id: "no-internal-admin-route",
    severity: "error",
    description:
      'Founder-only authenticated route. Pointing customers at /admin/* leaks internal admin tooling and gives them dead-end clicks. If the underlying capability needs a customer surface, build the customer surface — don\'t link the admin one.',
    // Match the path prefix; caller can add specific subpaths
    // (`/admin/queue`, `/admin/reports`) under the same rule.
    match: regexMatch(/\/admin\//),
  },

  // ---------------------------------------------------------------------------
  // Warnings (CI emits, doesn't block)
  // ---------------------------------------------------------------------------
  {
    id: "plain-language",
    severity: "warning",
    description: "Jargon has plain-language alternatives (utilize → use, leverage → use, facilitate → help, optimize → improve, etc.).",
    match: regexMatch(
      /\b(utilize|utilise|leverage|leveraging|facilitate|facilitating|streamline|streamlining|synergize|synergise|ideate|paradigm|methodology|robust|scalable|world-class|cutting-edge|seamless|seamlessly)\b/i,
    ),
  },
  {
    id: "pronoun-guidance",
    severity: "warning",
    description: "Singular they reads better than he/she when audience is unknown.",
    match: regexMatch(/\b(he\/she|she\/he|his\/her|her\/his|him\/her|her\/him|s\/he)\b/i),
  },
];

// -----------------------------------------------------------------------------
// Context-sensitive checks (run on specific kinds / hints)
// -----------------------------------------------------------------------------

/**
 * Generic CTA labels in button context. Scoped to button-flavored
 * strings so we don't flag the word "Submit" appearing in prose
 * (e.g. /about explaining what NOT to call a button).
 */
function isButtonContext(s: ExtractedString): boolean {
  return (
    s.content_type_hint === "button" ||
    /^(button|Button)$/.test(s.context) ||
    s.context === "Link" // Next.js Link components carry button-shaped CTAs
  );
}

const BUTTON_CHECKS: Check[] = [
  {
    id: "no-generic-cta",
    severity: "error",
    description: "Generic CTA. Use the verb that names the outcome (Save changes, Send invite, Continue to checkout).",
    match: (s) => {
      if (!isButtonContext(s)) return null;
      const trimmed = s.text.trim().replace(/[.…!]+$/, "");
      if (/^(Submit|OK|Ok|Click here|Click)$/i.test(trimmed)) {
        return { substring: trimmed, index: 0 };
      }
      return null;
    },
  },
  {
    id: "no-open-x-cta",
    severity: "warning",
    description: "'Open X' tells the user nothing about what's behind the link. Use Manage / Edit / View / Start.",
    match: (s) => {
      if (!isButtonContext(s)) return null;
      const trimmed = s.text.trim();
      const m = /^Open\s+\w+/.exec(trimmed);
      return m ? { substring: m[0], index: 0 } : null;
    },
  },
];

// -----------------------------------------------------------------------------
// Lint runner
// -----------------------------------------------------------------------------

export type Finding = {
  file: string;
  line: number;
  col: number;
  text: string;
  context: string;
  check: string;
  severity: Severity;
  description: string;
  match: string;
};

export function lintString(s: ExtractedString): Finding[] {
  const findings: Finding[] = [];
  for (const check of [...CHECKS, ...BUTTON_CHECKS]) {
    const hit = check.match(s);
    if (hit) {
      findings.push({
        file: s.file,
        line: s.line,
        col: s.col,
        text: s.text,
        context: s.context,
        check: check.id,
        severity: check.severity,
        description: check.description,
        match: hit.substring,
      });
    }
  }
  return findings;
}

export function lintFile(file: string): Finding[] {
  const extracted = extractFromFile(file);
  const out: Finding[] = [];
  for (const s of extracted) {
    out.push(...lintString(s));
  }
  return out;
}

/**
 * Lint a file but only emit findings whose start line falls in
 * `changedLines`. Used by --diff mode so PRs only block on their
 * own additions, not pre-existing violations.
 */
export function lintFileChangedLines(
  file: string,
  changedLines: Set<number>,
): Finding[] {
  if (changedLines.size === 0) return [];
  const extracted = extractFromFile(file);
  const out: Finding[] = [];
  for (const s of extracted) {
    if (!changedLines.has(s.line)) continue;
    out.push(...lintString(s));
  }
  return out;
}

// -----------------------------------------------------------------------------
// Diff scoping (PR 3)
// -----------------------------------------------------------------------------

/**
 * Parse `git diff --unified=0` output into a map of file → changed
 * line numbers (in the new file). Hunk headers look like:
 *
 *   @@ -42,1 +43,2 @@           old: 42,1 → new: 43,2
 *   @@ -50 +51,3 @@             old: 50,1 (default) → new: 51,3
 *   @@ -100,5 +99,0 @@          new count = 0 (pure deletion)
 *
 * We collect the new-side lines: starting at the +M position, for N
 * lines. New count of 0 means a pure deletion; nothing to lint there.
 *
 * Files appear under `+++ b/<path>`. The leading `+++ /dev/null`
 * (deleted file) and trailing newlines are skipped.
 */
export function parseChangedLines(diffOutput: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("+++ ")) {
      const m = /^\+\+\+ b\/(.+)$/.exec(line);
      if (m) {
        currentFile = m[1];
        if (!out.has(currentFile)) {
          out.set(currentFile, new Set());
        }
      } else {
        // +++ /dev/null (file deleted) — drop currentFile
        currentFile = null;
      }
    } else if (line.startsWith("@@") && currentFile) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        const start = Number(m[1]);
        const count = m[2] !== undefined ? Number(m[2]) : 1;
        if (count === 0) continue; // pure deletion
        const set = out.get(currentFile)!;
        for (let i = start; i < start + count; i++) {
          set.add(i);
        }
      }
    }
  }
  return out;
}

/**
 * Resolve a base ref to a SHA. Falls back through a couple of
 * sensible defaults so contributors don't have to know that
 * `origin/main` doesn't exist on a fresh clone.
 */
function resolveDiffBase(arg: string | true): string {
  if (typeof arg === "string" && arg.length > 0) {
    return arg;
  }
  const candidates = ["origin/main", "main", "HEAD~1"];
  for (const ref of candidates) {
    try {
      execSync(`git rev-parse --verify ${ref}`, { stdio: "ignore" });
      return ref;
    } catch {
      continue;
    }
  }
  throw new Error(
    "Could not resolve a diff base. Tried origin/main, main, HEAD~1. Pass --diff=<ref> explicitly.",
  );
}

/**
 * Run `git diff --unified=0` between the base ref and HEAD, return
 * the changed-lines map.
 */
export function getChangedLinesFromGit(baseArg: string | true): Map<string, Set<number>> {
  const base = resolveDiffBase(baseArg);
  // --no-color: clean output for parsing
  // --unified=0: minimum context, hunk headers only show changed lines
  // -- src/: scope the diff to the source tree (small speedup on big repos)
  const out = execSync(
    `git diff --unified=0 --no-color ${base}...HEAD -- src/`,
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  return parseChangedLines(out);
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

type CliArgs = {
  pretty: boolean;
  warningsAsErrors: boolean;
  files: string[] | null;
  /** false → no diff mode. true → resolve a default base. string → use this ref. */
  diff: boolean | string;
};

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {
    pretty: false,
    warningsAsErrors: false,
    files: null,
    diff: false,
  };
  for (const a of args) {
    if (a === "--pretty") out.pretty = true;
    else if (a === "--warnings-as-errors") out.warningsAsErrors = true;
    else if (a === "--diff") out.diff = true;
    else if (a.startsWith("--diff=")) out.diff = a.slice("--diff=".length);
    else if (a.startsWith("--files=")) {
      out.files = a.slice("--files=".length).split(",").filter(Boolean);
    }
  }
  return out;
}

function listAllCustomerFiles(): string[] {
  const out = execSync("git ls-files src/", { encoding: "utf-8" });
  return out.split("\n").filter(Boolean).filter(isInScope);
}

function main(): void {
  const args = parseArgs(argv.slice(2));

  // Diff mode: scope to changed lines per file. If --files is also
  // passed, intersect — only lint those files AND only on their
  // changed lines.
  let changedLines: Map<string, Set<number>> | null = null;
  if (args.diff) {
    try {
      changedLines = getChangedLinesFromGit(args.diff);
    } catch (err) {
      stderr.write(
        `${err instanceof Error ? err.message : String(err)}\n`,
      );
      exit(2);
    }
  }

  let files: string[];
  if (args.files) {
    files = args.files
      .map((f) => relative(REPO_ROOT, join(REPO_ROOT, f)))
      .filter((f) => {
        try {
          return statSync(join(REPO_ROOT, f)).isFile();
        } catch {
          return false;
        }
      })
      .filter(isInScope);
    if (changedLines) {
      files = files.filter((f) => changedLines!.has(f));
    }
  } else if (changedLines) {
    files = [...changedLines.keys()].filter(isInScope);
  } else {
    files = listAllCustomerFiles();
  }

  if (files.length === 0) {
    if (changedLines) {
      stderr.write("No customer-facing files changed in this diff.\n");
    } else {
      stderr.write("No customer-facing files matched.\n");
    }
    exit(0);
  }

  let errors = 0;
  let warnings = 0;

  for (const file of files) {
    const findings = changedLines
      ? lintFileChangedLines(file, changedLines.get(file) ?? new Set())
      : lintFile(file);
    for (const finding of findings) {
      if (finding.severity === "error") errors++;
      else warnings++;

      if (args.pretty) {
        const tag =
          finding.severity === "error" ? "\x1b[31merror\x1b[0m" : "\x1b[33mwarn\x1b[0m";
        stdout.write(
          `${finding.file}:${finding.line}:${finding.col} ${tag} [${finding.check}] ${finding.description}\n  match: ${JSON.stringify(finding.match)}\n  in:    ${JSON.stringify(finding.text)}\n`,
        );
      } else {
        stdout.write(`${JSON.stringify(finding)}\n`);
      }
    }
  }

  const mode = changedLines ? "diff-scoped" : "full";
  const summary = `Linted ${files.length} file${files.length === 1 ? "" : "s"} (${mode}): ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`;
  stderr.write(`${summary}\n`);

  if (errors > 0 || (args.warningsAsErrors && warnings > 0)) {
    exit(1);
  }
  exit(0);
}

// Only run as CLI; let tests import the helpers above.
const invokedAsCli =
  import.meta.url === `file://${argv[1]}` ||
  (import.meta.url.endsWith("/lint-customer-strings.ts") &&
    argv[1]?.endsWith("lint-customer-strings.ts"));
if (invokedAsCli) {
  main();
}
