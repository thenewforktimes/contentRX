/**
 * Calls the Python evaluator via internal HTTP.
 *
 * Why internal HTTP: Vercel's Python runtime is a separate process from our
 * Node.js runtime. Same-project fetch is the supported cross-runtime IPC.
 * INTERNAL_EVAL_SECRET prevents anyone outside our project from hitting
 * /api/evaluate directly even though it's public-by-default on Vercel.
 */

import type { Audience, ContentType, Moment } from "./engine-taxonomy";
import { optionalEnv, requireEnv } from "./require-env";

export type EvaluateParams = {
  text: string;
  content_type?: ContentType;
  audience?: Audience;
  moment?: Moment;
  /** Calibration precedents the engine should inject as voice
   *  guidance in the LLM scan prompt. See src/lib/precedents.ts.
   *  Empty array (or omitted) → engine falls back to the universal
   *  voice rules from PR #252. Block 2c of the calibration plan. */
  precedents?: ReadonlyArray<{
    approved_text: string;
    sample_size: number;
  }>;
};

/**
 * One hop in the pipeline's reasoning chain. Mirrors the
 * Python-side `RationaleHop` dataclass in
 * `src/content_checker/models.py`. Added to the API envelope in
 * schema v1.2.0 (human-eval build plan Session 1); Session 21 first
 * typed it on the TS side.
 */
export type RationaleHop = {
  step: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  confidence: number | null;
  rule_versions: Record<string, string>;
  ambiguity_flag: string | null;
};

/** Three-state verdict (API v1.1.0+). */
export type Verdict = "pass" | "violation" | "review_recommended" | "error";

export type EvaluationResult = {
  content_type?: string;
  /** Legacy two-state; prefer `verdict`. */
  overall_verdict: "pass" | "fail" | "error";
  /** Three-state verdict (API v1.1.0+). */
  verdict?: Verdict;
  /** Typed subtype when verdict === "review_recommended" (API v1.1.0+). */
  review_reason?: string | null;
  violations: Array<{
    standard_id: string;
    rule: string;
    issue: string;
    suggestion: string;
    /** Per-violation severity (API v2.0.0+). One of "high"/"medium"/"low". */
    severity?: string;
    source?: string;
    /** Per-violation confidence (API v1.1.0+). */
    confidence?: number;
    /** Typed ambiguity signal (API v1.2.0+). */
    ambiguity_flag?: string | null;
    /** Snapshot of the rule text's version at scan time (API v1.2.0+). */
    rule_version?: string;
    /** Other standard IDs emitted together (API v1.2.0+). */
    related_standards?: string[];
    /** Canonical docs URL for the standard on docs.contentrx.io (API v1.7.0+). */
    docs_url?: string;
    /** Customer-facing category (API v2.5.0+). One of "Voice & tone",
     *  "Mechanics", "Structure", "Accessibility", "Inclusion",
     *  "Big picture". Derived in the engine from the substrate
     *  standard_id; team-rule additions don't carry it. */
    category?: string;
  }>;
  passes: Array<{ standard_id: string; rule: string }>;
  summary?: string;
  audience?: string;
  moment?: string;
  pipeline?: Record<string, number>;
  /** Ordered pipeline hops (API v1.2.0+). */
  rationale_chain?: RationaleHop[];
};

/** Token-cost telemetry from the engine response (audit M-24, PR 9).
 * `cache_creation_input` and `cache_read_input` report Anthropic
 * prompt-caching activity per call. Total billed input ≈
 * input + cache_creation_input + cache_read_input × 0.10.
 *
 * Pre-PR-9 engine versions don't emit the cache fields; the TS side
 * coerces them to 0 in /api/check. */
export type EngineTokens = {
  input: number;
  output: number;
  cache_creation_input?: number;
  cache_read_input?: number;
};

export type EvaluateResponse = {
  result: EvaluationResult;
  latency_ms: number;
  tokens: EngineTokens;
};

/**
 * Thrown when /api/evaluate returns a non-2xx status. The message is
 * intentionally narrow — just the prefix + status + statusText — so
 * no upstream response body (which can echo user text from a pydantic
 * ValidationError or similar) ends up in thrown-error messages, which
 * eventually land in `logSafeError` truncated at 200 chars. Operators
 * needing the body should consult Vercel function logs for the engine
 * side directly.
 */
export class UpstreamEvaluatorError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UpstreamEvaluatorError";
    this.status = status;
  }
}

function internalEvaluateUrl(): string {
  // In production we REQUIRE an explicit INTERNAL_EVAL_URL. Falling back
  // to NEXT_PUBLIC_APP_URL lets a misconfigured hostname leak the
  // internal secret + user text to the wrong origin. Only the dev
  // localhost fallback is allowed. requireEnv treats "" as missing, so
  // a blank-but-set value fails loud here instead of silently leaking.
  if (process.env.NODE_ENV === "production") {
    const url = requireEnv("INTERNAL_EVAL_URL");
    return `${url.replace(/\/$/, "")}/api/evaluate`;
  }

  const base =
    optionalEnv("INTERNAL_EVAL_URL") ??
    optionalEnv("NEXT_PUBLIC_APP_URL") ??
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/evaluate`;
}

export async function evaluate(
  params: EvaluateParams,
): Promise<EvaluateResponse> {
  const secret = requireEnv("INTERNAL_EVAL_SECRET");

  const res = await fetch(internalEvaluateUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify(params),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new UpstreamEvaluatorError(
      `Evaluation failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  return (await res.json()) as EvaluateResponse;
}

export type ClassifyResponse = {
  result: { content_type: string; moment: string };
  latency_ms: number;
  tokens: EngineTokens;
};

/**
 * Classify-only call into the Python evaluator. Skips the full check
 * pipeline (no rule scan, no validation) and returns just the
 * (content_type, moment) pair. Used by the public /api/classify route
 * which the MCP server's `classify_moment` tool consumes — cheaper than
 * running a full evaluation purely to peek at the moment.
 */
export async function classify(text: string): Promise<ClassifyResponse> {
  const secret = requireEnv("INTERNAL_EVAL_SECRET");

  const res = await fetch(internalEvaluateUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ text, mode: "classify" }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new UpstreamEvaluatorError(
      `Classification failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  return (await res.json()) as ClassifyResponse;
}

export type SuggestFixParams = {
  text: string;
  // ADR 2026-04-25 — standard_id is now optional. Schema-2.0.0 client
  // surfaces (LSP, plugin, action, MCP) strip substrate before
  // forwarding; only server-side callers with substrate access can
  // supply one. The rewriter falls back to issue + current_suggestion
  // when absent. Caller must supply at least one of (standard_id,
  // issue, current_suggestion).
  standard_id?: string;
  rule?: string;
  issue?: string;
  current_suggestion?: string;
};

export type SuggestFixResponse = {
  result: { rewritten: string; standard_id: string | null };
  latency_ms: number;
  tokens: EngineTokens;
};

export type RewriteDocumentResponse = {
  result: {
    rewritten: string;
    // Schema 2.4.0: one-sentence diagnostic of the document's broad
    // weaknesses. Empty string when the LLM's JSON parse failed; the
    // rewrite still ships in that case.
    diagnostic: string;
  };
  latency_ms: number;
  tokens: EngineTokens;
};

/**
 * Document-tier holistic rewrite. Calls into the Python engine's
 * `rewrite_document` mode (see `src/content_checker/rewrite_document.py`),
 * which runs a single LLM call producing a clean version of the
 * input in the ContentRX house voice. The dashboard's Document tier
 * fires this in parallel with the regular check call so the
 * customer sees both findings AND a suggested rewrite.
 *
 * Schema 2.3.0. Failures are non-fatal: the route catches and
 * surfaces a null `suggested_rewrite` field with a warning, so the
 * regular check results still render even when the rewrite call
 * times out or hits a transient Anthropic error.
 */
export async function rewriteDocument(
  text: string,
): Promise<RewriteDocumentResponse> {
  const secret = requireEnv("INTERNAL_EVAL_SECRET");

  const res = await fetch(internalEvaluateUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ text, mode: "rewrite_document" }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new UpstreamEvaluatorError(
      `Rewrite-document failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  return (await res.json()) as RewriteDocumentResponse;
}

/**
 * Suggest-fix call into the Python evaluator. Rewrites a flagged
 * string to clear a specific standard's violation. BUILD_PLAN_v2
 * Session 17 — backs the public `/api/suggest-fix` route consumed
 * by the LSP code-action provider.
 */
export async function suggestFix(
  params: SuggestFixParams,
): Promise<SuggestFixResponse> {
  const secret = requireEnv("INTERNAL_EVAL_SECRET");

  const res = await fetch(internalEvaluateUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ ...params, mode: "suggest_fix" }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new UpstreamEvaluatorError(
      `Suggest-fix failed: ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  return (await res.json()) as SuggestFixResponse;
}
