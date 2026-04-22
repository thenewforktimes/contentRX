#!/usr/bin/env node
/**
 * extract.mjs — Babel-based UI-copy extractor.
 *
 * Reads one or more file paths from argv (absolute or repo-relative),
 * parses each with @babel/parser (JSX/TSX plugin) and walks the AST
 * with @babel/traverse, emitting one JSON object per extracted string
 * to stdout (NDJSON — newline-delimited JSON). The Python side reads
 * stdin line-by-line and issues `contentrx` calls.
 *
 * This replaces the regex extractor in src/extract.py for .jsx/.tsx.
 * HTML files are still handled by the regex path inside main.py so we
 * don't need htmlparser2 in the image today. Migrate HTML to AST in a
 * follow-up if the regex coverage there stops being enough.
 *
 * Output schema (one per line):
 *   {
 *     "text":    string,
 *     "file":    string,
 *     "line":    integer,  // 1-indexed
 *     "column":  integer,  // 0-indexed, Babel convention
 *     "kind":    string,   // "jsx-text" | "attr:<name>" | "template-literal"
 *   }
 *
 * Extraction rules (locked per BUILD_PLAN §15):
 *   - JSXText with trimmed length > 3, not whitespace-only
 *   - String literals in JSX attributes whose name matches COPY_ATTRS
 *   - Template literal STATIC parts only — skip any ${…} interpolations
 *   - Skip strings that look like URLs, paths, CSS classes, identifiers,
 *     or pure punctuation / digits
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

// @babel/traverse is CJS-shipped; the default export is the callable
// function, but under ESM the module namespace wraps it.
const traverse = _traverse.default ?? _traverse;

const COPY_ATTRS = new Set([
  "alt",
  "ariaLabel",
  "aria-label",
  "placeholder",
  "title",
  "label",
  "description",
  "helperText",
  "errorMessage",
  "children",
  "heading",
  "subtitle",
  "tooltip",
  "message",
  "content",
]);

const MIN_LENGTH = 3;

// Patterns we reject outright — they're almost never user-facing copy.
const URL_RE = /^https?:\/\//i;
const PATH_RE = /^(?:\.\.?\/|\/|~\/)/;
const CSS_CLASS_RE = /^[a-z][\w-]*(?:\s+[a-z][\w-]*)+$/;     // "btn btn-primary"
const SINGLE_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;          // "userName", "btn-primary"
const PUNCT_ONLY_RE = /^[\s\d\W_]+$/;

function looksLikeCopy(raw) {
  const text = raw.trim();
  if (text.length < MIN_LENGTH) return false;
  if (URL_RE.test(text)) return false;
  if (PATH_RE.test(text)) return false;
  if (PUNCT_ONLY_RE.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  // CSS-class-ish ("btn btn-primary") — no spaces inside single-token-like words.
  if (!/[\s]/.test(text) && SINGLE_TOKEN_RE.test(text)) return false;
  if (/^\s*$/.test(text)) return false;
  if (CSS_CLASS_RE.test(text) && !/[.?!,;:]/.test(text)) return false;
  return true;
}

function normaliseAttrName(name) {
  if (typeof name === "string") return name.toLowerCase();
  if (name && typeof name === "object" && name.type === "JSXNamespacedName") {
    return `${name.namespace.name}:${name.name.name}`.toLowerCase();
  }
  if (name && typeof name === "object" && name.name) return String(name.name).toLowerCase();
  return "";
}

function extractFromSource(filePath, source) {
  const hits = [];
  let ast;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "decorators-legacy",
        "topLevelAwait",
        "importAssertions",
      ],
      errorRecovery: true,
    });
  } catch (err) {
    process.stderr.write(
      `warning: failed to parse ${filePath}: ${err.message}\n`,
    );
    return hits;
  }

  function push(text, loc, kind) {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!looksLikeCopy(trimmed)) return;
    hits.push({
      text: trimmed,
      file: filePath,
      line: loc?.start?.line ?? 1,
      column: loc?.start?.column ?? 0,
      kind,
    });
  }

  traverse(ast, {
    JSXText(p) {
      push(p.node.value, p.node.loc, "jsx-text");
    },
    JSXAttribute(p) {
      const attrName = normaliseAttrName(p.node.name?.name ?? p.node.name);
      if (!COPY_ATTRS.has(attrName)) return;
      const value = p.node.value;
      if (!value) return;
      if (value.type === "StringLiteral") {
        push(value.value, value.loc, `attr:${attrName}`);
      } else if (value.type === "JSXExpressionContainer") {
        const expr = value.expression;
        if (expr.type === "StringLiteral") {
          push(expr.value, expr.loc, `attr:${attrName}`);
        } else if (expr.type === "TemplateLiteral") {
          // Emit every static quasi (e.g. `Hello ${name}, welcome!` →
          // "Hello" and "welcome!"). Interpolated slots are skipped.
          for (const quasi of expr.quasis) {
            push(quasi.value.cooked ?? quasi.value.raw ?? "", quasi.loc, "template-literal");
          }
        }
      }
    },
    // Standalone TemplateLiteral outside of a JSX attribute — common
    // in things like toast("Welcome back"). We only capture when the
    // template has no interpolations; otherwise we'd hand the AI copy
    // with placeholder gaps and over-flag.
    TemplateLiteral(p) {
      if (p.node.expressions.length > 0) return;
      if (p.parent.type === "JSXAttribute") return;
      if (p.parent.type === "JSXExpressionContainer") return; // handled above
      const quasi = p.node.quasis[0];
      if (!quasi) return;
      push(
        quasi.value.cooked ?? quasi.value.raw ?? "",
        p.node.loc,
        "template-literal",
      );
    },
  });

  return hits;
}

function extractFromPath(absPath, repoRoot) {
  const repoRelative = path.relative(repoRoot, absPath);
  let source;
  try {
    source = fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    process.stderr.write(`warning: could not read ${absPath}: ${err.message}\n`);
    return [];
  }
  return extractFromSource(repoRelative || absPath, source);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("usage: extract.mjs <file> [file …]\n");
    process.exit(2);
  }

  const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();

  for (const arg of args) {
    const absPath = path.isAbsolute(arg) ? arg : path.resolve(repoRoot, arg);
    const hits = extractFromPath(absPath, repoRoot);
    for (const h of hits) {
      process.stdout.write(`${JSON.stringify(h)}\n`);
    }
  }
}

main();
