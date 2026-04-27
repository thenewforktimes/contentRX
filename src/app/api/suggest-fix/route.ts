/**
 * POST /api/suggest-fix — rewrite a flagged string to clear a specific standard.
 *
 * BUILD_PLAN_v2 Session 17. Consumed by the LSP code-action provider
 * (and eventually by the web dashboard + Figma plugin's "apply
 * suggested rewrite" actions). Hits the Python evaluator's
 * `suggest_fix` mode, which calls Claude with a targeted prompt.
 *
 * Auth: Clerk session OR `Authorization: Bearer cx_<api_key>` — same
 * public surface as `/api/check`. Rate-limited at the standard user
 * tier. Consumes one check quota slot per call (rewriting is an LLM
 * call, so it costs).
 *
 * Privacy: the flagged text is plaintext in flight — same contract as
 * `/api/check`. No persistence of the original or the rewrite.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { envelope } from "@/lib/api-envelope";
import { resolveAuth } from "@/lib/auth";
import { suggestFix } from "@/lib/evaluate";
import { currentMonth, monthlyQuota } from "@/lib/quotas";
import { checkRateLimit } from "@/lib/ratelimit";
import { claimQuotaSlot } from "@/lib/usage";
import { sanitizeZodIssues } from "@/lib/zod-errors";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const RequestSchema = z.object({
  text: z.string().min(1).max(100_000),
  standard_id: z
    .string()
    .min(1)
    .max(32)
    // standard_ids land in the LLM prompt verbatim. Tight regex + no
    // inner whitespace closes the prompt-injection surface.
    .regex(/^[A-Z]{2,4}-\d{2,3}$/, {
      message: "standard_id must match /^[A-Z]{2,4}-\\d{2,3}$/",
    }),
  rule: z.string().max(1000).optional(),
  issue: z.string().max(1000).optional(),
  current_suggestion: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return json({ error: auth.message }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid request", issues: sanitizeZodIssues(parsed.error.issues) },
      { status: 400 },
    );
  }
  const params = parsed.data;

  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    // `reset` is a unix-ms timestamp when the next window opens.
    const retryAfterSeconds = Math.max(
      0,
      Math.ceil((rl.reset - Date.now()) / 1000),
    );
    return json(
      { error: "Rate limit exceeded", retry_after_seconds: retryAfterSeconds },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
    );
  }

  // Suggest-fix is billed as a scan — it makes an LLM call of similar
  // cost. Same quota slot contract as /api/check.
  const quota = monthlyQuota(auth.plan, auth.seats);
  const slot = await claimQuotaSlot(auth.user.id, quota);
  if (!slot.granted) {
    return json(
      {
        error: "Quota exhausted",
        used: slot.count,
        quota,
        month: currentMonth(),
      },
      { status: 402 },
    );
  }

  try {
    const response = await suggestFix(params);
    return json(
      envelope({
        result: response.result,
        latency_ms: response.latency_ms,
        tokens: response.tokens,
        usage: {
          plan: auth.plan,
          used: slot.count,
          quota,
          remaining: Math.max(0, quota - slot.count),
          month: currentMonth(),
        },
      }),
    );
  } catch (err) {
    console.error("/api/suggest-fix failed:", err);
    return json(
      { error: "Suggestion failed" },
      { status: 500 },
    );
  }
}
