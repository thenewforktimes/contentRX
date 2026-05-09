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
 * Auth: Clerk session. Anyone with an account can preview their
 * team's digest; the cron itself only runs for team-plan owners,
 * but the preview is free for cold-start customers to see what
 * they'd get if they upgraded.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { buildAgentRunPayload } from "@/lib/agent/run-agent";
import { renderDigest } from "@/lib/agent/render-digest";
import { teamScope } from "@/lib/team-scope";
import { logSafeError } from "@/lib/safe-error-log";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const db = getDb();
    const [row] = (await db
      .select({
        id: schema.users.id,
        teamOwnerUserId: schema.users.teamOwnerUserId,
      })
      .from(schema.users)
      .where(eq(schema.users.clerkId, userId))
      .limit(1)) as Array<{
      id: string;
      teamOwnerUserId: string | null;
    }>;

    if (!row) {
      return NextResponse.json(
        {
          error:
            "We're finishing setting up your account. Refresh in a moment.",
        },
        { status: 404 },
      );
    }

    const scopeId = teamScope({
      user: { id: row.id },
      teamOwnerUserId: row.teamOwnerUserId,
    });

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
