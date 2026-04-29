/**
 * Mechanical lint over the extracted customer strings.
 *
 * PR 2 of 5 in the dogfood loop. Reads the output of PR 1's
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
 *   npm run lint:copy                    # lint everything
 *   npm run lint:copy -- --pretty        # human-readable
 *   npm run lint:copy -- --warnings-as-errors  # strict mode
 *   npm run lint:copy -- --files=a.tsx,b.ts    # specific files
 *
 * Exits 0 when no errors, 1 when any error-severity finding fires.
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

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

type CliArgs = {
  pretty: boolean;
  warningsAsErrors: boolean;
  files: string[] | null;
};

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = { pretty: false, warningsAsErrors: false, files: null };
  for (const a of args) {
    if (a === "--pretty") out.pretty = true;
    else if (a === "--warnings-as-errors") out.warningsAsErrors = true;
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
  } else {
    files = listAllCustomerFiles();
  }

  if (files.length === 0) {
    stderr.write("No customer-facing files matched.\n");
    exit(0);
  }

  let errors = 0;
  let warnings = 0;

  for (const file of files) {
    for (const finding of lintFile(file)) {
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

  const summary = `Linted ${files.length} file${files.length === 1 ? "" : "s"}: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`;
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
