/**
 * POST /api/check — the product's hot path.
 *
 * Flow (locked per BUILD_PLAN session 3):
 *   1. Auth (Clerk session OR CONTENTRX_API_KEY bearer)
 *   2. Load team rules (if user is on Team plan)
 *   3. Check monthly quota — 402 if exhausted
 *   4. Rate limit (60/min per user) — 429 if exceeded
 *   5. Call Python evaluator with text + content_type + audience + moment
 *   6. Apply team disabled-rule filter
 *   7. Log violations (sha256 only, no plaintext)
 *   8. Increment usage counter
 *   9. Return the result + quota metadata
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuth } from "@/lib/auth";
import { AUDIENCES, CONTENT_TYPES, MOMENTS } from "@/lib/engine-taxonomy";
import { evaluate } from "@/lib/evaluate";
import { hashText, logViolations } from "@/lib/log-violations";
import { currentMonth, monthlyQuota } from "@/lib/quotas";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  applyDisabledFilter,
  loadTeamRules,
  recomputeVerdict,
} from "@/lib/team-rules";
import { getCurrentUsage, incrementUsage } from "@/lib/usage";

const RequestSchema = z.object({
  // Engine enforces MAX_CONTENT_LENGTH=100_000; match that exactly.
  text: z.string().min(1).max(100_000),
  // content_type and moment go INTO the LLM system prompt verbatim.
  // Accepting arbitrary strings here is a prompt-injection vector.
  content_type: z.enum(CONTENT_TYPES).optional(),
  audience: z.enum(AUDIENCES).optional(),
  moment: z.enum(MOMENTS).optional(),
  source: z.enum(["plugin", "cli", "action", "ditto"]).default("plugin"),
});

export async function POST(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { text, content_type, audience, moment, source } = parsed.data;

  const quota = monthlyQuota(auth.plan, auth.seats);
  const used = await getCurrentUsage(auth.user.id);

  if (used >= quota) {
    return NextResponse.json(
      {
        error: "Monthly quota exhausted",
        quota,
        used,
        plan: auth.plan,
        upgrade_url: `${appUrl()}/pricing?from=quota`,
        resets_at: monthResetISO(),
      },
      { status: 402 },
    );
  }

  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        reset_at: new Date(rl.reset).toISOString(),
      },
      {
        status: 429,
        headers: {
          "retry-after": String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))),
        },
      },
    );
  }

  const teamRules = await loadTeamRules(auth.teamOwnerUserId);

  let evalResponse;
  try {
    evalResponse = await evaluate({ text, content_type, audience, moment });
  } catch (err) {
    // Log detail to stderr (Sentry ingests via Vercel). Return an opaque
    // message to the caller — the Python-side error can include file paths,
    // model names, Anthropic error bodies, or a truncated LLM response.
    console.error("evaluate() failed:", err);
    return NextResponse.json(
      { error: "Evaluation service unavailable" },
      { status: 502 },
    );
  }

  const filtered = applyDisabledFilter(evalResponse.result, teamRules.disabledStandardIds);
  const result = recomputeVerdict(filtered);

  // Log + increment are observational — if they fail, the user still gets
  // their result. We surface the failure through Sentry, not to the user.
  try {
    await logViolations({
      userId: auth.user.id,
      teamId: auth.teamOwnerUserId,
      source,
      contentType: result.content_type ?? content_type ?? "unknown",
      moment: (result.moment as string | undefined) ?? moment ?? null,
      text,
      violations: result.violations,
    });
  } catch (err) {
    console.error("logViolations failed:", err);
  }

  let newUsed = used;
  try {
    newUsed = await incrementUsage(auth.user.id);
  } catch (err) {
    console.error("incrementUsage failed:", err);
  }

  return NextResponse.json({
    result,
    latency_ms: evalResponse.latency_ms,
    tokens: evalResponse.tokens,
    usage: {
      plan: auth.plan,
      used: newUsed,
      quota,
      remaining: Math.max(0, quota - newUsed),
      month: currentMonth(),
      text_hash: hashText(text),
    },
  });
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function monthResetISO(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}
