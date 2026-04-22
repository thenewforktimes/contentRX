#!/usr/bin/env node
/**
 * Headless Node harness that runs the Figma plugin's JS preprocessor
 * outside Figma so its verdicts can be compared against the Python
 * preprocessor for parity.
 *
 * Usage:
 *   echo '[{"input":"some text","content_type":"short_ui_copy"}, ...]' \
 *     | node tools/parity_js_runner.mjs
 *
 * Output (JSON to stdout):
 *   [{"violations":[{"standard_id":"GRM-06","issue":"...","suggestion":"..."},...],
 *     "suppressed_ids":["GRM-04",...]}, ...]
 *
 * The harness stubs Figma's iframe APIs (parent.postMessage, document.*,
 * figma.clientStorage, fetch) aggressively so the side-effecting parts of
 * ui.html that run at script-evaluation time don't crash. Only the pure
 * preprocessor functions are then invoked.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const UI_HTML_PATH = resolve(REPO_ROOT, "figma-plugin", "ui.html");

function makeChainableStub() {
  // A callable proxy whose every property access also yields a callable
  // proxy. Lets the plugin's UI bootstrap (`document.getElementById("x")
  // .addEventListener("click", ...)`) chain without throwing.
  const fn = function () {
    return makeChainableStub();
  };
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === "then") return undefined;
      if (prop === Symbol.iterator) return undefined;
      if (prop === "length") return 0;
      return makeChainableStub();
    },
    apply() {
      return makeChainableStub();
    },
  });
}

function buildSandbox() {
  const documentStub = {
    getElementById: () => makeChainableStub(),
    querySelector: () => makeChainableStub(),
    querySelectorAll: () => [],
    createElement: () => makeChainableStub(),
    addEventListener: () => {},
    body: makeChainableStub(),
    head: makeChainableStub(),
    documentElement: makeChainableStub(),
  };

  const figmaStub = {
    clientStorage: {
      getAsync: async () => null,
      setAsync: async () => {},
      deleteAsync: async () => {},
    },
    ui: { postMessage: () => {} },
    closePlugin: () => {},
    notify: () => {},
    showUI: () => {},
  };

  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask: (cb) => cb(),
    parent: { postMessage: () => {} },
    document: documentStub,
    figma: figmaStub,
    fetch: async () => ({
      ok: false,
      status: 0,
      statusText: "stubbed",
      json: async () => ({}),
      text: async () => "",
    }),
    crypto: globalThis.crypto,
    AbortController: globalThis.AbortController,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  };
  // self-reference for code that touches `window`
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function extractScript(html) {
  const start = html.indexOf("<script>");
  const end = html.lastIndexOf("</script>");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not locate <script> block in ui.html");
  }
  return html.slice(start + "<script>".length, end);
}

function loadPreprocessor() {
  const html = readFileSync(UI_HTML_PATH, "utf8");
  const script = extractScript(html);
  const sandbox = buildSandbox();
  const ctx = vm.createContext(sandbox);
  // Run the script. Side-effecting top-level calls (e.g. the load-token
  // postMessage at the bottom of the file) fire harmlessly against stubs.
  // Function declarations get hoisted into the context, so afterwards
  // `runPreprocessor` is callable on the sandbox.
  vm.runInContext(script, ctx, { filename: "figma-plugin/ui.html" });
  if (typeof sandbox.runPreprocessor !== "function") {
    throw new Error(
      "runPreprocessor was not defined after evaluating ui.html script",
    );
  }
  return (text, contentType) => sandbox.runPreprocessor(text, contentType);
}

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  const input = await readStdin();
  let cases;
  try {
    cases = JSON.parse(input);
  } catch (err) {
    process.stderr.write(`parity_js_runner: invalid JSON on stdin: ${err.message}\n`);
    process.exit(2);
  }
  if (!Array.isArray(cases)) {
    process.stderr.write("parity_js_runner: expected an array of cases on stdin\n");
    process.exit(2);
  }

  const runPreprocessor = loadPreprocessor();
  const out = cases.map((c) => {
    const text = c.input ?? "";
    const contentType = c.content_type ?? "short_ui_copy";
    let result;
    try {
      result = runPreprocessor(text, contentType);
    } catch (err) {
      return {
        error: `${err && err.message ? err.message : String(err)}`,
        violations: [],
        suppressed_ids: [],
      };
    }
    const violations = (result.violations || []).map((v) => ({
      standard_id: v.standard_id,
      issue: v.issue ?? null,
      suggestion: v.suggestion ?? null,
    }));
    const suppressed_ids = result.suppressedIds
      ? Array.from(result.suppressedIds)
      : [];
    return { violations, suppressed_ids };
  });

  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((err) => {
  process.stderr.write(`parity_js_runner: fatal: ${err.stack || err}\n`);
  process.exit(1);
});
