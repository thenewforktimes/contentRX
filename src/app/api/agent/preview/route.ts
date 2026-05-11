/**
 * POST /api/agent/preview — render the weekly review digest live.
 *
 * Phase G3 of the 2026-05-09 roadmap. The /dashboard/agent page's
 * "Run preview now" button hits this route to see what the agent
 * would post if the cron ran right now. The route reads the team's
 * flag history, runs the deterministic pattern grouping, and
 * renders the digest as markdown. Zero LLM calls. Zero checks
 * consumed.
 *
 * The route does NOT persist to `agent_runs` — preview runs are
 * ephemeral so customers can fire repeatedly without filling up the
 * admin review surface with noise. Persistence is the cron's job
 * (POST /api/cron/agent-run).
 *
 * Auth: Clerk session AND team plan. Preview is a Team-plan feature
 * (the cron itself only runs for team-plan owners). The earlier
 * "anyone can preview" stance + no rate-limit was an unmetered
 * DB-heavy compute path open to free users — closed in the
 * 2026-05-11 audit. Rate-limited at the standard tier so a buggy
 * client can't loop the button into a DoS.
 */

import { NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { buildAgentRunPayload } from "@/lib/agent/run-agent";
import { renderDigest } from "@/lib/agent/render-digest";
import { checkRateLimit } from "@/lib/ratelimit";
import { teamScope } from "@/lib/team-scope";
import { logSafeError } from "@/lib/safe-error-log";

export async function POST(req: Request) {
  const auth = await resolveAuth(req);
  if ("status" in auth) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status },
    );
  }

  if (auth.plan !== "team") {
    return NextResponse.json(
      {
        error:
          "Agent preview is a Team plan feature. Upgrade your plan to run weekly digests.",
        plan: auth.plan,
      },
      { status: 403 },
    );
  }

  const rl = await checkRateLimit(auth.user.id);
  if (!rl.success) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((rl.reset - Date.now()) / 1000),
    );
    return NextResponse.json(
      {
        error: `Too many preview runs in a short window. Try again in ${retryAfterSeconds}s.`,
        retry_after_seconds: retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "retry-after": String(retryAfterSeconds) },
      },
    );
  }

  try {
    const scopeId = teamScope(auth);
    const payload = await buildAgentRunPayload(scopeId);
    const markdown = renderDigest(payload);

    return NextResponse.json({
      markdown,
      summary: {
        totalFlags: payload.totalFlags,
        headerVariant: payload.headerVariant,
        windowDays: payload.windowDays,
        generatedAt: payload.runAt,
      },
    });
  } catch (err) {
    logSafeError("[/api/agent/preview]", err);
    return NextResponse.json(
      { error: "Couldn't render the preview. Try again." },
      { status: 500 },
    );
  }
}
