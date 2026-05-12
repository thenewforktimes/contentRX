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

import { z } from "zod";
import { envelope } from "@/lib/api-envelope";
import { revalidateDashboard } from "@/lib/revalidate";
import { resolveAuth } from "@/lib/auth";
import { suggestFix } from "@/lib/evaluate";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { currentMonth, monthlyQuota } from "@/lib/quotas";
import { corsJson, corsPreflight } from "@/lib/cors";
import { checkRateLimit } from "@/lib/ratelimit";
import { logSafeError } from "@/lib/safe-error-log";
import { teamScope } from "@/lib/team-scope";
import { claimQuotaSlot } from "@/lib/usage";
import { sanitizeZodIssues } from "@/lib/zod-errors";

export async function OPTIONS(req: Request) {
  return corsPreflight(req);
}

const RequestSchema = z
  .object({
    text: z.string().min(1).max(100_000),
    // ADR 2026-04-25 — standard_id is now optional. Schema-2.0.0
    // client surfaces (LSP, plugin, action, MCP) strip substrate and
    // never carry it; only server-side callers with substrate access
    // can supply one. When present, still validated against the tight
    // regex so substrate values landing in the LLM prompt don't open
    // a prompt-injection surface.
    standard_id: z
      .string()
      .max(32)
      .regex(/^[A-Z]{2,4}-\d{2,3}$/, {
        message: "standard_id must match /^[A-Z]{2,4}-\\d{2,3}$/",
      })
      .optional(),
    rule: z.string().max(1000).optional(),
    issue: z.string().max(1000).optional(),
    current_suggestion: z.string().max(1000).optional(),
  })
  // The rewriter needs SOMETHING to anchor on. Refuse requests that
  // would land in the engine with neither a standard_id nor any
  // descriptive context — the LLM would just return the input.
  .refine(
    (v) =>
      Boolean(v.standard_id) ||
      Boolean(v.issue) ||
      Boolean(v.current_suggestion),
    {
      message:
        "At least one of standard_id, issue, or current_suggestion is required",
      path: ["issue"],
    },
  );

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
  const params = parsed.data;

  // PII pre-screen — block credentials and PII before they reach the
  // engine, Anthropic, Sentry, or function logs. See `lib/pii-screen.ts`.
  const sensitivePatterns = detectSensitivePatterns(params.text);
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
  // cost. Same quota slot contract as /api/check, and the same team
  // pooling rule (members decrement the shared owner row).
  const quota = monthlyQuota(auth.plan, auth.seats);
  const slot = await claimQuotaSlot(teamScope(auth), quota);
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
    // Suggest-fix consumes a quota slot — invalidate the dashboard
    // cache so the counter / remaining display catch up on the
    // next render. Scope the userId at teamScope(auth) so a member's
    // call invalidates the team-owner usage row that loadCurrentUsage
    // reads (matches the team-pooling fix in /api/check, PR #403).
    revalidateDashboard({ userId: teamScope(auth) });
    // ADR 2026-04-25: strip `standard_id` from the public response.
    // The engine returns it under `result` for substrate consumers,
    // but every user-facing surface — LSP, plugin, MCP, CLI, web
    // dashboard — must not see it. We drop the field here rather
    // than at /api/evaluate so internal callers retain access.
    return json(
      envelope({
        result: { rewritten: response.result.rewritten },
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
    logSafeError("/api/suggest-fix failed", err);
    return json(
      { error: "Suggestion failed" },
      { status: 500 },
    );
  }
}
