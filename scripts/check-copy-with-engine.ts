/**
 * Engine check for customer copy. The dogfood loop, PR 4 of 5.
 *
 * Reads extracted strings from PR 1's extractor, scopes to changed
 * lines via PR 3's diff plumbing, and runs each through ContentRX's
 * own engine via POST /api/evaluate. Blocks CI on verdict=violation,
 * surfaces verdict=review_recommended as warnings, stays quiet on
 * pass + error.
 *
 * This is the layer the mechanical lint can't see. The lint catches
 * em dashes and "guys"; the engine catches:
 *
 *   - Error messages that blame the user
 *   - Destructive confirmations that don't name the consequence
 *   - CTAs that read "Click here" semantically even if they don't
 *     spell it that way
 *   - Generic responses ("consider revising", "you might want to")
 *   - Calm/confident/charming drift
 *
 * Auth: POST carries `x-internal-secret: ${INTERNAL_EVAL_SECRET}`.
 * Same secret /api/check uses on the server side; lets us call
 * /api/evaluate directly without burning customer quota.
 *
 * Endpoint default: https://contentrx.io/api/evaluate. Override
 * via --endpoint or `CONTENTRX_EVAL_ENDPOINT` env.
 *
 * Usage:
 *
 *   INTERNAL_EVAL_SECRET=… npm run check:engine
 *   INTERNAL_EVAL_SECRET=… npm run check:engine -- --diff
 *   INTERNAL_EVAL_SECRET=… npm run check:engine -- --pretty
 *   INTERNAL_EVAL_SECRET=… npm run check:engine -- --files=a.tsx,b.tsx
 *   INTERNAL_EVAL_SECRET=… npm run check:engine -- --max-strings=20
 *
 * Exits 0 when no violations, 1 when any verdict=violation, 2 on
 * configuration / network failures we can't recover from.
 *
 * Cost note: each call hits Anthropic upstream. Diff scoping bounds
 * cost-per-PR to the actual change size (typically 5-50 strings).
 *
 * PR 5 adds response caching keyed on
 * sha256(text + content_type + moment + audience + endpoint). Cache
 * hits skip the engine call entirely, so subsequent CI runs on the
 * same branch (after a force-push, retry, or rebase) cost nothing.
 * Cache lives at .cache/contentrx-engine/ by default; CI persists it
 * across runs via actions/cache.
 */

import { createHash } from "node:crypto";
import { argv, exit, stderr, stdout, env } from "node:process";
import { extractFromFile, isInScope, type ExtractedString } from "./extract-customer-strings";
import { getChangedLinesFromGit } from "./lint-customer-strings";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();

// -----------------------------------------------------------------------------
// Engine wire format
// -----------------------------------------------------------------------------

type Verdict = "violation" | "review_recommended" | "pass" | "error";

type EngineViolation = {
  issue: string;
  suggestion: string;
  severity: string;
  confidence: number;
  /** Internal-only field; we keep it locally for founder-side debugging
   * but don't surface in PR comments. */
  standard_id?: string;
};

type EngineResponse = {
  result: {
    verdict: Verdict;
    violations?: EngineViolation[];
    review_reason?: string | null;
    warnings?: string[];
  };
  latency_ms: number;
  tokens?: { input?: number; output?: number };
};

export type EngineFinding = {
  file: string;
  line: number;
  col: number;
  text: string;
  context: string;
  content_type_hint: string | null;
  moment_hint: string | null;
  verdict: Verdict;
  /** "error" blocks CI; "warning" surfaces only; "info" silent. */
  severity: "error" | "warning" | "info";
  violations: EngineViolation[];
  review_reason: string | null;
  latency_ms: number;
};

// -----------------------------------------------------------------------------
// Response cache
// -----------------------------------------------------------------------------

type CacheEntry = {
  /** Wall-clock when the entry was written. ISO-8601. */
  cached_at: string;
  /** The cached engine response. */
  response: EngineResponse;
};

/**
 * Hash key for a cache entry. Stable across runs; sensitive to every
 * input that affects the engine's verdict. Endpoint is in the key so
 * staging vs prod don't share cache.
 */
export function cacheKey(
  text: string,
  content_type: string | null,
  moment: string | null,
  audience: string,
  endpoint: string,
): string {
  const parts = [
    text,
    content_type ?? "",
    moment ?? "",
    audience,
    endpoint,
  ].join("\0");
  return createHash("sha256").update(parts).digest("hex");
}

/**
 * Read a cache entry if fresh enough. Returns null on miss, parse
 * error, or expiry.
 */
export function readCache(
  dir: string,
  key: string,
  ttlMs: number,
): EngineResponse | null {
  const path = join(dir, `${key}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;
    const ageMs = Date.now() - new Date(entry.cached_at).getTime();
    if (Number.isNaN(ageMs) || ageMs > ttlMs) return null;
    return entry.response;
  } catch {
    return null;
  }
}

export function writeCache(
  dir: string,
  key: string,
  response: EngineResponse,
): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${key}.json`);
  const entry: CacheEntry = {
    cached_at: new Date().toISOString(),
    response,
  };
  writeFileSync(path, JSON.stringify(entry), "utf-8");
}

// -----------------------------------------------------------------------------
// Engine call
// -----------------------------------------------------------------------------

export async function evaluateString(
  s: ExtractedString,
  opts: {
    endpoint: string;
    secret: string;
    audience: string;
    timeoutMs: number;
  },
): Promise<EngineResponse> {
  const body: Record<string, string> = {
    text: s.text,
    audience: opts.audience,
    mode: "check",
  };
  // Only send hints we have. The engine classifies missing fields.
  if (s.content_type_hint) body.content_type = s.content_type_hint;
  if (s.moment_hint) body.moment = s.moment_hint;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const res = await fetch(opts.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": opts.secret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      throw new Error(`Engine returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as EngineResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Map an engine verdict + violations onto our severity. Blocks CI on
 * verdict=violation regardless of confidence (we tune later if false
 * positives become a problem). Review_recommended is a soft signal —
 * surface it but don't block.
 */
export function severityFromVerdict(verdict: Verdict): "error" | "warning" | "info" {
  if (verdict === "violation") return "error";
  if (verdict === "review_recommended") return "warning";
  return "info";
}

// -----------------------------------------------------------------------------
// Concurrency control
// -----------------------------------------------------------------------------

/**
 * Promise.all with a parallelism cap. The engine's upstream is
 * Anthropic, which rate-limits per account. Cap at 5 in flight by
 * default; tune via --concurrency.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return out;
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

type CliArgs = {
  pretty: boolean;
  files: string[] | null;
  diff: boolean | string;
  endpoint: string;
  audience: string;
  concurrency: number;
  maxStrings: number;
  timeoutMs: number;
  cacheDir: string;
  cacheTtlMs: number;
  noCache: boolean;
};

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {
    pretty: false,
    files: null,
    diff: false,
    endpoint:
      env.CONTENTRX_EVAL_ENDPOINT ?? "https://contentrx.io/api/evaluate",
    audience: "product_ui",
    concurrency: 5,
    maxStrings: 200,
    timeoutMs: 20_000,
    cacheDir: env.CONTENTRX_CACHE_DIR ?? ".cache/contentrx-engine",
    // 90 days. Periodic re-evaluation catches model drift; longer
    // would risk stale verdicts when we update the prompt.
    cacheTtlMs: 90 * 24 * 60 * 60 * 1000,
    noCache: false,
  };
  for (const a of args) {
    if (a === "--pretty") out.pretty = true;
    else if (a === "--no-cache") out.noCache = true;
    else if (a === "--diff") out.diff = true;
    else if (a.startsWith("--diff=")) out.diff = a.slice("--diff=".length);
    else if (a.startsWith("--files=")) {
      out.files = a.slice("--files=".length).split(",").filter(Boolean);
    } else if (a.startsWith("--endpoint=")) {
      out.endpoint = a.slice("--endpoint=".length);
    } else if (a.startsWith("--audience=")) {
      out.audience = a.slice("--audience=".length);
    } else if (a.startsWith("--concurrency=")) {
      const n = Number(a.slice("--concurrency=".length));
      if (Number.isFinite(n) && n > 0) out.concurrency = Math.floor(n);
    } else if (a.startsWith("--max-strings=")) {
      const n = Number(a.slice("--max-strings=".length));
      if (Number.isFinite(n) && n > 0) out.maxStrings = Math.floor(n);
    } else if (a.startsWith("--timeout-ms=")) {
      const n = Number(a.slice("--timeout-ms=".length));
      if (Number.isFinite(n) && n > 0) out.timeoutMs = Math.floor(n);
    } else if (a.startsWith("--cache-dir=")) {
      out.cacheDir = a.slice("--cache-dir=".length);
    } else if (a.startsWith("--cache-ttl-days=")) {
      const n = Number(a.slice("--cache-ttl-days=".length));
      if (Number.isFinite(n) && n > 0) {
        out.cacheTtlMs = Math.floor(n) * 24 * 60 * 60 * 1000;
      }
    }
  }
  return out;
}

function listAllCustomerFiles(): string[] {
  const out = execSync("git ls-files src/", { encoding: "utf-8" });
  return out.split("\n").filter(Boolean).filter(isInScope);
}

function gatherStrings(args: CliArgs): ExtractedString[] {
  let changedLines: Map<string, Set<number>> | null = null;
  if (args.diff) {
    changedLines = getChangedLinesFromGit(args.diff);
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

  const out: ExtractedString[] = [];
  for (const file of files) {
    const extracted = extractFromFile(file);
    if (changedLines) {
      const lines = changedLines.get(file) ?? new Set();
      for (const s of extracted) {
        if (lines.has(s.line)) out.push(s);
      }
    } else {
      out.push(...extracted);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));

  const secret = env.INTERNAL_EVAL_SECRET;
  if (!secret) {
    stderr.write(
      "INTERNAL_EVAL_SECRET is not set. Set it in .env.local for local runs or as a GitHub Actions secret in CI.\n",
    );
    exit(2);
  }

  let strings: ExtractedString[];
  try {
    strings = gatherStrings(args);
  } catch (err) {
    stderr.write(
      `Failed to gather strings: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    exit(2);
    return;
  }

  if (strings.length === 0) {
    if (args.diff) {
      stderr.write("No customer-facing strings changed in this diff.\n");
    } else {
      stderr.write("No customer-facing strings to evaluate.\n");
    }
    exit(0);
  }

  if (strings.length > args.maxStrings) {
    stderr.write(
      `Too many strings (${strings.length}) for one run. The cap is ${args.maxStrings}; raise it with --max-strings if you really mean it. Cost note: each call costs upstream tokens.\n`,
    );
    exit(2);
  }

  stderr.write(
    `Evaluating ${strings.length} string${strings.length === 1 ? "" : "s"} with concurrency=${args.concurrency} → ${args.endpoint}\n`,
  );

  const findings: EngineFinding[] = [];
  let errors = 0;
  let warnings = 0;
  let evalErrors = 0;
  let cacheHits = 0;

  await mapWithConcurrency(strings, args.concurrency, async (s) => {
    try {
      let res: EngineResponse;
      const key = cacheKey(
        s.text,
        s.content_type_hint,
        s.moment_hint,
        args.audience,
        args.endpoint,
      );
      const cached = args.noCache
        ? null
        : readCache(args.cacheDir, key, args.cacheTtlMs);
      if (cached) {
        res = cached;
        cacheHits++;
      } else {
        res = await evaluateString(s, {
          endpoint: args.endpoint,
          secret,
          audience: args.audience,
          timeoutMs: args.timeoutMs,
        });
        if (!args.noCache) writeCache(args.cacheDir, key, res);
      }
      const verdict = res.result.verdict;
      const severity = severityFromVerdict(verdict);
      const finding: EngineFinding = {
        file: s.file,
        line: s.line,
        col: s.col,
        text: s.text,
        context: s.context,
        content_type_hint: s.content_type_hint,
        moment_hint: s.moment_hint,
        verdict,
        severity,
        violations: res.result.violations ?? [],
        review_reason: res.result.review_reason ?? null,
        latency_ms: res.latency_ms,
      };
      if (severity === "error") errors++;
      else if (severity === "warning") warnings++;
      // pass + error = info → silent
      if (severity !== "info") {
        findings.push(finding);
      }
    } catch (err) {
      // Engine failure: surface as a soft warning (we don't block CI
      // on infrastructure problems — that becomes a flake source).
      // PR 5 polish: retry with exponential backoff before surfacing.
      evalErrors++;
      stderr.write(
        `  ✗ ${s.file}:${s.line} eval failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  });

  // Render findings sorted by file/line so output is stable.
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col,
  );

  for (const f of findings) {
    if (args.pretty) {
      const tag =
        f.severity === "error"
          ? "\x1b[31mviolation\x1b[0m"
          : "\x1b[33mreview\x1b[0m";
      stdout.write(
        `${f.file}:${f.line}:${f.col} ${tag} [${f.context}/${f.content_type_hint ?? "?"}${f.moment_hint ? `@${f.moment_hint}` : ""}]\n  text: ${JSON.stringify(f.text)}\n`,
      );
      for (const v of f.violations) {
        stdout.write(
          `    issue:      ${v.issue}\n    suggestion: ${v.suggestion}\n    severity:   ${v.severity} (confidence ${v.confidence})\n`,
        );
      }
      if (f.review_reason) {
        stdout.write(`    review:     ${f.review_reason}\n`);
      }
    } else {
      // JSONL with substrate stripped — standard_id is internal.
      const publicViolations = f.violations.map((v) => ({
        issue: v.issue,
        suggestion: v.suggestion,
        severity: v.severity,
        confidence: v.confidence,
      }));
      stdout.write(
        `${JSON.stringify({ ...f, violations: publicViolations })}\n`,
      );
    }
  }

  const cacheSegment = args.noCache
    ? ""
    : ` (cache hits: ${cacheHits}/${strings.length})`;
  const summary = `Evaluated ${strings.length}${cacheSegment}: ${errors} violation${errors === 1 ? "" : "s"}, ${warnings} review${warnings === 1 ? "" : "s"}, ${evalErrors} eval error${evalErrors === 1 ? "" : "s"}.`;
  stderr.write(`${summary}\n`);

  if (errors > 0) exit(1);
  exit(0);
}

// CLI entry guard
const invokedAsCli =
  import.meta.url === `file://${argv[1]}` ||
  (import.meta.url.endsWith("/check-copy-with-engine.ts") &&
    argv[1]?.endsWith("check-copy-with-engine.ts"));
if (invokedAsCli) {
  main().catch((err) => {
    stderr.write(`Unexpected: ${err instanceof Error ? err.stack : String(err)}\n`);
    exit(2);
  });
}

// Re-export helpers for tests.
export { gatherStrings, mapWithConcurrency };
