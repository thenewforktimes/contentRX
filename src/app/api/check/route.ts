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
  applyAddedRules,
  applyDisabledFilter,
  applyOverrides,
  loadTeamRules,
  recomputeVerdict,
} from "@/lib/team-rules";
import { getCurrentUsage, incrementUsage } from "@/lib/usage";

// CORS: the Figma plugin iframe has Origin: null. We allow any origin
// because the request is gated on the Authorization header, not on
// cookies. No credentials, no Set-Cookie — so wildcard is safe.
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
  // Engine enforces MAX_CONTENT_LENGTH=100_000; match that exactly.
  text: z.string().min(1).max(100_000),
  // content_type and moment go INTO the LLM system prompt verbatim.
  // Accepting arbitrary strings here is a prompt-injection vector.
  content_type: z.enum(CONTENT_TYPES).optional(),
  audience: z.enum(AUDIENCES).optional(),
  moment: z.enum(MOMENTS).optional(),
  source: z.enum(["plugin", "cli", "action", "ditto"]).default("plugin"),
  // Optional file_path, populated by the GitHub Action only. Upper
  // bound guards against repo paths that could swell the violations
  // table (typical paths are well under this).
  file_path: z.string().min(1).max(512).optional(),
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
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { text, content_type, audience, moment, source, file_path } = parsed.data;

  const quota = monthlyQuota(auth.plan, auth.seats);
  const used = await getCurrentUsage(auth.user.id);

  if (used >= quota) {
    return json(
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
    return json(
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
    return json(
      { error: "Evaluation service unavailable" },
      { status: 502 },
    );
  }

  // Team-rule pipeline: disable first (strip), then override display fields
  // on the survivors, then append custom team-added rule matches, then
  // recompute verdict from the final violations list.
  const disabled = applyDisabledFilter(evalResponse.result, teamRules.disabledStandardIds);
  const overridden = applyOverrides(disabled, teamRules.overridesByStandardId);
  const withAdds = applyAddedRules(overridden, text, teamRules.adds);
  const result = recomputeVerdict(withAdds);

  // Log + increment are observational — if they fail, the user still gets
  // their result. We surface the failure through Sentry, not to the user.
  try {
    // For team analytics: team_id is the team-owner's user.id regardless
    // of which team member ran the check. resolveAuth returns
    // teamOwnerUserId=null for the owner themselves (since their own
    // row's team_owner_user_id is null), so we promote user.id in that
    // case. Free/Pro users stay on teamId=null — they have no team to
    // roll up into.
    const teamIdForLog =
      auth.plan === "team"
        ? auth.teamOwnerUserId ?? auth.user.id
        : null;
    await logViolations({
      userId: auth.user.id,
      teamId: teamIdForLog,
      source,
      contentType: result.content_type ?? content_type ?? "unknown",
      moment: (result.moment as string | undefined) ?? moment ?? null,
      text,
      violations: result.violations,
      filePath: file_path ?? null,
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

  return json({
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
