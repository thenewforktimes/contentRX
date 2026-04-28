/**
 * POST /api/classify — moment + content-type classification only.
 *
 * Cheap-path companion to /api/check. Used by the MCP server's
 * `classify_moment` tool so developers can probe what kind of UI moment
 * a string is before committing to a full evaluation. Skips the full
 * check pipeline entirely — just runs the classifier and the moment
 * detector against the text.
 *
 * Flow:
 *   1. Auth (Clerk session OR Bearer cx_<api_key>)
 *   2. Rate limit (60/min per user, same bucket as /api/check)
 *   3. Delegate to the Python evaluator in classify-only mode
 *
 * Intentional differences from /api/check:
 *   - No monthly quota claim. Classification is cheap (~1 LLM call at
 *     ~100 tokens) and is a planning tool, not a billable evaluation.
 *   - No team-rule merge, no violation logging. This endpoint doesn't
 *     touch the `violations` table.
 *   - Response shape is the minimal { content_type, moment } pair plus
 *     pipeline metadata.
 */

import { z } from "zod";
import { resolveAuth } from "@/lib/auth";
import { corsJson, corsPreflight } from "@/lib/cors";
import { classify } from "@/lib/evaluate";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { checkRateLimit } from "@/lib/ratelimit";
import { sanitizeZodIssues } from "@/lib/zod-errors";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

const RequestSchema = z.object({
  // Same 100k bound as /api/check so a single request can't burn the
  // engine on a whole novel. Classification-only is cheaper per token
  // than full evaluation but the ceiling should match so we never leak
  // a bigger window through this surface.
  text: z.string().min(1).max(100_000),
});

export async function POST(req: Request) {
  const json = (body: unknown, init?: ResponseInit) =>
    corsJson(req, body, init);
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
  const { text } = parsed.data;

  // PII pre-screen — block credentials and PII before they reach the
  // engine, Anthropic, Sentry, or function logs. See `lib/pii-screen.ts`.
  const sensitivePatterns = detectSensitivePatterns(text);
  if (sensitivePatterns.length > 0) {
    return json(
      {
        error: sensitiveDataErrorMessage(sensitivePatterns),
        patterns: sensitivePatterns,
      },
      { status: 400 },
    );
  }

  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return json(
      {
        error: "Rate limit exceeded",
        reset_at: new Date(rl.reset).toISOString(),
      },
      {
        status: 429,
        headers: {
          "retry-after": String(
            Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  let classifyResponse;
  try {
    classifyResponse = await classify(text);
  } catch (err) {
    console.error("classify() failed:", err);
    return json(
      { error: "Classification service unavailable" },
      { status: 502 },
    );
  }

  return json({
    result: classifyResponse.result,
    latency_ms: classifyResponse.latency_ms,
    tokens: classifyResponse.tokens,
  });
}
