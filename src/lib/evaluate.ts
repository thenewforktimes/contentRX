/**
 * Calls the Python evaluator via internal HTTP.
 *
 * Why internal HTTP: Vercel's Python runtime is a separate process from our
 * Node.js runtime. Same-project fetch is the supported cross-runtime IPC.
 * INTERNAL_EVAL_SECRET prevents anyone outside our project from hitting
 * /api/evaluate directly even though it's public-by-default on Vercel.
 */

import type { Audience, ContentType, Moment } from "./engine-taxonomy";

export type EvaluateParams = {
  text: string;
  content_type?: ContentType;
  audience?: Audience;
  moment?: Moment;
};

export type EvaluationResult = {
  content_type?: string;
  overall_verdict: "pass" | "fail" | "error";
  violations: Array<{
    standard_id: string;
    rule: string;
    issue: string;
    suggestion: string;
    source?: string;
  }>;
  passes: Array<{ standard_id: string; rule: string }>;
  summary?: string;
  audience?: string;
  moment?: string;
  pipeline?: Record<string, number>;
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
  // localhost fallback is allowed.
  if (process.env.NODE_ENV === "production") {
    const url = process.env.INTERNAL_EVAL_URL;
    if (!url) {
      throw new Error(
        "INTERNAL_EVAL_URL must be set in production — refusing to fall " +
          "back to NEXT_PUBLIC_APP_URL",
      );
    }
    return `${url.replace(/\/$/, "")}/api/evaluate`;
  }

  const base =
    process.env.INTERNAL_EVAL_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/evaluate`;
}

export async function evaluate(
  params: EvaluateParams,
): Promise<EvaluateResponse> {
  const secret = process.env.INTERNAL_EVAL_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_EVAL_SECRET is not set");
  }

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
