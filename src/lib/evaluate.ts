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
  }>;
  passes: Array<{ standard_id: string; rule: string }>;
  summary?: string;
  audience?: string;
  moment?: string;
  pipeline?: Record<string, number>;
  /** Ordered pipeline hops (API v1.2.0+). */
  rationale_chain?: RationaleHop[];
};

export type EvaluateResponse = {
  result: EvaluationResult;
  latency_ms: number;
  tokens: { input: number; output: number };
};

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
    const body = await res.text();
    throw new Error(
      `Evaluation failed: ${res.status} ${res.statusText} ${body}`,
    );
  }

  return (await res.json()) as EvaluateResponse;
}

export type ClassifyResponse = {
  result: { content_type: string; moment: string };
  latency_ms: number;
  tokens: { input: number; output: number };
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
    const body = await res.text();
    throw new Error(
      `Classification failed: ${res.status} ${res.statusText} ${body}`,
    );
  }

  return (await res.json()) as ClassifyResponse;
}

export type CatalogMoment = {
  id: string;
  description: string;
  weighted_standards: Array<{
    standard_id: string;
    modifier: "emphasize" | "relax" | "suppress" | string;
    rationale: string;
  }>;
};

export type CatalogResponse = {
  result: { moments: CatalogMoment[] };
  latency_ms: number;
  tokens: { input: number; output: number };
};

/**
 * Catalog call into the Python evaluator. Returns the moments taxonomy
 * with each moment's standards-weight adjustments. Backs the public
 * /api/moments route consumed by the MCP server's `list_standards` tool
 * (when filtered by moment) and the `contentrx://moments` resource.
 */
export async function catalog(): Promise<CatalogResponse> {
  const secret = requireEnv("INTERNAL_EVAL_SECRET");

  const res = await fetch(internalEvaluateUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ mode: "catalog" }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Catalog fetch failed: ${res.status} ${res.statusText} ${body}`,
    );
  }

  return (await res.json()) as CatalogResponse;
}

export type SuggestFixParams = {
  text: string;
  standard_id: string;
  rule?: string;
  issue?: string;
  current_suggestion?: string;
};

export type SuggestFixResponse = {
  result: { rewritten: string; standard_id: string };
  latency_ms: number;
  tokens: { input: number; output: number };
};

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
    const body = await res.text();
    throw new Error(
      `Suggest-fix failed: ${res.status} ${res.statusText} ${body}`,
    );
  }

  return (await res.json()) as SuggestFixResponse;
}
