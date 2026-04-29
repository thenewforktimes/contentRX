/**
 * Extract user-visible strings from customer-facing source files.
 *
 * The foundation for the dogfood loop. Walks customer surfaces (per
 * the audience boundary in docs/copy-vocabulary.md), parses each file
 * with the TypeScript AST, and emits one JSONL row per extracted
 * string. Downstream consumers:
 *
 *   - Mechanical lint (em dashes, prohibited terms) — PR 2
 *   - Engine check via /api/evaluate — PR 4
 *   - Dev tooling (`npm run check-copy`) — PR 5
 *
 * What gets extracted:
 *
 *   - JSX text content. The text between JSX tags. Maps to a
 *     content_type hint based on the wrapping tag (h1 → heading,
 *     button → button, p → body_paragraph, etc.).
 *   - JSX attributes that are user-visible: alt, aria-label,
 *     placeholder, title, tooltip, label. Same scope as the LSP
 *     server's extractor (lsp-server/src/contentrx_lsp/extractor.py).
 *   - Top-level Next.js metadata.title and metadata.description.
 *   - String literals returned as `error:` or `message:` fields inside
 *     NextResponse.json({...}) calls. The customer-visible API errors.
 *
 * What gets skipped:
 *
 *   - Code comments (TypeScript AST drops these naturally).
 *   - /admin/* surfaces (founder voice, deliberately exempt).
 *   - Test files (*.test.ts, *.test.tsx, __tests__/, *.spec.ts).
 *   - Internal lib files unless they hold user-facing canonical
 *     strings (humanize.ts is in scope; most of lib/ is not).
 *   - Dynamic strings (template literals with interpolations).
 *     Static fragments inside template literals are extracted; the
 *     interpolated parts are skipped. Documented limitation.
 *
 * Usage:
 *
 *   npm run extract-strings                 # stdout JSONL
 *   npm run extract-strings -- --pretty     # human-readable
 *   npm run extract-strings -- --files=src/app/page.tsx,src/emails/welcome.tsx
 *
 * The output is stable: same input, same output, line-by-line. Diffs
 * over time tell you what copy changed.
 */

import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { execSync } from "node:child_process";
import ts from "typescript";

// -----------------------------------------------------------------------------
// What's in scope
// -----------------------------------------------------------------------------

const REPO_ROOT = process.cwd();

/**
 * Customer-surface globs. Match the audience boundary in
 * docs/copy-vocabulary.md. The check pattern is "must include AT LEAST
 * ONE of these prefixes AND NOT match any EXCLUDE pattern."
 */
const INCLUDE_PREFIXES: ReadonlyArray<string> = [
  "src/app/",
  "src/emails/",
  "src/components/",
];

const EXCLUDE_PATTERNS: ReadonlyArray<RegExp> = [
  /^src\/app\/admin\//,
  // Admin-tier API routes serve only founders (founder-auth via
  // isContentRXAdmin or CRON_SECRET). Their JSON error responses
  // intentionally use terse copy: 404 for non-founders so the URL
  // doesn't leak (per /admin/layout.tsx posture), generic 500
  // messages so server-side error detail stays in safe-error-log.
  // These don't follow customer-copy rules — same architectural
  // reason /admin pages don't.
  /^src\/app\/api\/admin\//,
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /__tests__\//,
  /\/node_modules\//,
  /\.next\//,
];

/**
 * Files we scan but only for specific patterns. API routes only emit
 * strings in NextResponse.json error/message fields — not random
 * string literals in the route handler.
 */
function isApiRoute(file: string): boolean {
  return /^src\/app\/api\/.*\/route\.ts$/.test(file);
}

// -----------------------------------------------------------------------------
// Output schema
// -----------------------------------------------------------------------------

export type ExtractedString = {
  file: string;
  line: number;
  col: number;
  text: string;
  kind:
    | "jsx-text"
    | "jsx-attribute"
    | "metadata-title"
    | "metadata-description"
    | "api-error";
  /** Tag name, attribute name, or response field. */
  context: string;
  /** Best-guess content type for the engine. May be null. */
  content_type_hint: string | null;
  /** Best-guess moment for the engine. May be null. */
  moment_hint: string | null;
};

// -----------------------------------------------------------------------------
// Tag → content_type / moment heuristics
// -----------------------------------------------------------------------------

const TAG_TO_CONTENT_TYPE: Record<string, string> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  button: "button",
  a: "link",
  p: "body_paragraph",
  li: "body_paragraph",
  label: "form_label",
  legend: "form_label",
  caption: "body_paragraph",
  figcaption: "body_paragraph",
  th: "heading",
  td: "body_paragraph",
};

const ATTR_TO_CONTENT_TYPE: Record<string, string> = {
  alt: "alt_text",
  "aria-label": "ui_label",
  placeholder: "placeholder",
  title: "tooltip",
  tooltip: "tooltip",
  label: "form_label",
};

/**
 * File-path heuristics for moment inference. Only used when the AST
 * doesn't give us a stronger signal.
 */
function fileMomentHint(file: string): string | null {
  if (file.startsWith("src/emails/")) return null; // depends on which email
  if (file.includes("error") || file.includes("not-found")) return "error_state";
  if (file.includes("loading.tsx")) return "loading";
  if (file.includes("onboard") || file.includes("welcome")) return "onboarding";
  return null;
}

// -----------------------------------------------------------------------------
// Walking files
// -----------------------------------------------------------------------------

function isInScope(file: string): boolean {
  if (!INCLUDE_PREFIXES.some((p) => file.startsWith(p))) return false;
  if (EXCLUDE_PATTERNS.some((re) => re.test(file))) return false;
  return file.endsWith(".ts") || file.endsWith(".tsx");
}

/**
 * Find every customer-facing source file under the repo. Uses git
 * ls-files for speed and to honor .gitignore (avoids walking
 * node_modules etc.).
 */
function listCustomerFiles(): string[] {
  const out = execSync("git ls-files src/", { encoding: "utf-8" });
  return out
    .split("\n")
    .filter(Boolean)
    .filter(isInScope);
}

// -----------------------------------------------------------------------------
// AST helpers
// -----------------------------------------------------------------------------

function parseFile(file: string): ts.SourceFile {
  const absolute = join(REPO_ROOT, file);
  const source = readFileSync(absolute, "utf-8");
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function getLineCol(
  sourceFile: ts.SourceFile,
  pos: number,
): { line: number; col: number } {
  const lc = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

function getTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tag =
    "openingElement" in node ? node.openingElement.tagName : node.tagName;
  if (ts.isIdentifier(tag)) return tag.text;
  // Component or namespaced. Return the rightmost name for content_type
  // inference; the full path is less useful for hinting.
  return tag.getText(node.getSourceFile());
}

/**
 * Reduce JSX text to its actual visible content. Three steps:
 *
 *   1. Collapse runs of whitespace (JSX text spans newlines + indents).
 *   2. Decode the HTML entities the JSX parser leaves intact
 *      (&apos;, &quot;, &ldquo;, &rdquo;, &mdash;, &amp;).
 *   3. Trim.
 *
 * The em-dash entity is intentionally on the decode list. If someone
 * writes `&mdash;` thinking it dodges the no-em-dash rule, the
 * extractor surfaces it as a real em dash so the lint catches it.
 */
function normalizeJsxText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ");
  const decoded = collapsed
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&");
  return decoded.trim();
}

/**
 * True if the text has no real prose to evaluate. We skip:
 *
 *   - Empty strings
 *   - Single characters
 *   - Strings that are only punctuation or whitespace (sentence
 *     fragments from JSX splitting around inline tags)
 *
 * The threshold is permissive on purpose. A 3-character button label
 * ("Yes", "No") is real copy; a 1-character punctuation orphan is not.
 */
function isTrivial(text: string): boolean {
  if (text.length < 2) return true;
  if (/^[\s\p{P}]+$/u.test(text)) return true;
  return false;
}

/**
 * Tags whose JSX text is technical content, not prose. The extractor
 * skips text inside these so the dogfood loop doesn't flag code
 * samples in marketing pages or shell snippets in install docs.
 */
const TECHNICAL_TAGS = new Set(["code", "pre", "kbd", "samp", "var"]);

function isInsideTechnicalTag(node: ts.JsxText): boolean {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isJsxElement(parent)) {
      const tag = getTagName(parent).toLowerCase();
      if (TECHNICAL_TAGS.has(tag)) return true;
    }
    parent = parent.parent;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Extractors
// -----------------------------------------------------------------------------

function extractFromFile(file: string): ExtractedString[] {
  const sourceFile = parseFile(file);
  const fileMoment = fileMomentHint(file);
  const out: ExtractedString[] = [];

  // API routes use a narrower extraction: only NextResponse.json
  // string literals in `error:` / `message:` fields. Skipping the
  // generic JSX walker prevents false positives from JSDoc examples
  // or zod-issue strings.
  if (isApiRoute(file)) {
    extractApiErrors(sourceFile, file, out);
    return out;
  }

  // Non-API files: full JSX text + attributes + Next.js metadata.
  walkForJsxAndMetadata(sourceFile, file, fileMoment, out);
  return out;
}

function extractApiErrors(
  sourceFile: ts.SourceFile,
  file: string,
  out: ExtractedString[],
): void {
  function visit(node: ts.Node): void {
    // NextResponse.json({ error: "...", message: "..." }, ...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "NextResponse" &&
      node.expression.name.text === "json"
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
          ) {
            const key = ts.isIdentifier(prop.name)
              ? prop.name.text
              : prop.name.text;
            if (key === "error" || key === "message") {
              const value = prop.initializer;
              if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
                const { line, col } = getLineCol(sourceFile, value.getStart(sourceFile));
                out.push({
                  file,
                  line,
                  col,
                  text: value.text,
                  kind: "api-error",
                  context: key,
                  content_type_hint: "error_message",
                  moment_hint: "error_state",
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function walkForJsxAndMetadata(
  sourceFile: ts.SourceFile,
  file: string,
  fileMoment: string | null,
  out: ExtractedString[],
): void {
  function visit(node: ts.Node): void {
    // export const metadata = { title: "...", description: "..." }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === "metadata" &&
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer)
        ) {
          for (const prop of decl.initializer.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              (prop.name.text === "title" || prop.name.text === "description")
            ) {
              const value = prop.initializer;
              if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
                const { line, col } = getLineCol(sourceFile, value.getStart(sourceFile));
                const kind =
                  prop.name.text === "title"
                    ? "metadata-title"
                    : "metadata-description";
                out.push({
                  file,
                  line,
                  col,
                  text: value.text,
                  kind,
                  context: prop.name.text,
                  content_type_hint:
                    prop.name.text === "title" ? "page_title" : "body_paragraph",
                  moment_hint: fileMoment,
                });
              }
            }
          }
        }
      }
    }

    // JSX text
    if (ts.isJsxText(node)) {
      const text = normalizeJsxText(node.text);
      if (!isTrivial(text) && !isInsideTechnicalTag(node)) {
        // Walk up to find the wrapping tag for content_type inference.
        const parent: ts.Node | undefined = node.parent;
        let tagName: string | null = null;
        if (parent && ts.isJsxElement(parent)) {
          tagName = getTagName(parent);
        }
        const { line, col } = getLineCol(sourceFile, node.getStart(sourceFile));
        out.push({
          file,
          line,
          col,
          text,
          kind: "jsx-text",
          context: tagName ?? "(unknown)",
          content_type_hint: tagName
            ? TAG_TO_CONTENT_TYPE[tagName.toLowerCase()] ?? null
            : null,
          moment_hint: fileMoment,
        });
      }
    }

    // JSX attributes (alt, aria-label, placeholder, title, tooltip, label)
    if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name)
        ? node.name.text
        : node.name.getText(sourceFile);
      if (name in ATTR_TO_CONTENT_TYPE) {
        const init = node.initializer;
        let stringNode: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | null = null;
        if (init && ts.isStringLiteral(init)) {
          stringNode = init;
        } else if (
          init &&
          ts.isJsxExpression(init) &&
          init.expression &&
          (ts.isStringLiteral(init.expression) ||
            ts.isNoSubstitutionTemplateLiteral(init.expression))
        ) {
          stringNode = init.expression;
        }
        if (stringNode) {
          const { line, col } = getLineCol(sourceFile, stringNode.getStart(sourceFile));
          out.push({
            file,
            line,
            col,
            text: stringNode.text,
            kind: "jsx-attribute",
            context: name,
            content_type_hint: ATTR_TO_CONTENT_TYPE[name],
            moment_hint: fileMoment,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

type CliArgs = {
  pretty: boolean;
  files: string[] | null;
};

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = { pretty: false, files: null };
  for (const a of args) {
    if (a === "--pretty") out.pretty = true;
    else if (a.startsWith("--files=")) {
      out.files = a.slice("--files=".length).split(",").filter(Boolean);
    }
  }
  return out;
}

// Public for tests + downstream tooling. Re-exporting the workhorses
// so a future PR can import `extractFromFile` directly without
// shelling out to the CLI.
export { extractFromFile, normalizeJsxText, isTrivial, isInScope };

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
    files = listCustomerFiles();
  }

  if (files.length === 0) {
    stderr.write("No customer-facing files matched.\n");
    exit(0);
  }

  let totalStrings = 0;
  for (const file of files) {
    const extracted = extractFromFile(file);
    totalStrings += extracted.length;
    for (const row of extracted) {
      if (args.pretty) {
        stdout.write(
          `${row.file}:${row.line}:${row.col} [${row.kind}/${row.context}] ${row.content_type_hint ?? "?"}${row.moment_hint ? ` @ ${row.moment_hint}` : ""}\n  ${JSON.stringify(row.text)}\n`,
        );
      } else {
        stdout.write(`${JSON.stringify(row)}\n`);
      }
    }
  }

  stderr.write(
    `Extracted ${totalStrings} string${totalStrings === 1 ? "" : "s"} from ${files.length} file${files.length === 1 ? "" : "s"}.\n`,
  );
}

// Only run when invoked as a CLI. Lets tests / downstream tooling
// import the helpers above without triggering a full repo scan.
const invokedAsCli =
  import.meta.url === `file://${argv[1]}` ||
  import.meta.url.endsWith("/extract-customer-strings.ts") &&
    argv[1]?.endsWith("extract-customer-strings.ts");
if (invokedAsCli) {
  main();
}
