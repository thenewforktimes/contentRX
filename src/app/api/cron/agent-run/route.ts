/**
 * POST /api/cron/agent-run — weekly review agent V1 (Phase G1).
 *
 * Iterates over team-plan team owners, runs the deterministic pattern
 * grouping over each team's last 30 days of flag history, and
 * persists the resulting payload to `agent_runs` for review at
 * `/admin/agent-runs`.
 *
 * Zero LLM calls per run. Zero checks consumed per run. Zero
 * customer-visible side effects. The only side effect is an INSERT
 * into `agent_runs`.
 *
 * Cron wiring (add when enabling):
 *
 *   // vercel.json
 *   "crons": [
 *     { "path": "/api/cron/agent-run", "schedule": "0 13 * * 1" }
 *   ]
 *
 * Monday at 13:00 UTC — one hour ahead of the existing
 * weekly-digest cron so the agent's results are fresh when the
 * digest path (G3, day 4) starts reading them.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` enforced via
 * `requireCronAuth`. Same shape as every other route under
 * `/api/cron/*`.
 */

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { persistAgentRun } from "@/lib/agent/run-agent";
import { requireCronAuth } from "@/lib/cron-auth";
import { logSafeError } from "@/lib/safe-error-log";

interface RunResult {
  ok: true;
  teamsConsidered: number;
  runsPersisted: number;
  failures: Array<{ teamId: string; error: string }>;
}

export async function POST(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const db = getDb();

  // Team-plan owners only. Members write their flags / overrides
  // against the owner's teamId, so the agent run is naturally
  // scoped to the owner. The cron never runs for free / pro users
  // because the agent is folded into the Team plan as a moat-
  // builder per the roadmap; non-Team teams have nothing to read
  // here yet.
  const owners = (await db
    .select({
      id: schema.users.id,
    })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.plan, "team"),
        isNull(schema.users.teamOwnerUserId),
      ),
    )) as Array<{ id: string }>;

  const failures: RunResult["failures"] = [];
  let runsPersisted = 0;

  for (const owner of owners) {
    try {
      await persistAgentRun(owner.id);
      runsPersisted++;
    } catch (err) {
      logSafeError("[cron/agent-run]", err);
      failures.push({
        teamId: owner.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: RunResult = {
    ok: true,
    teamsConsidered: owners.length,
    runsPersisted,
    failures,
  };
  return NextResponse.json(result);
}

// Allow GET for parity with the other cron routes (Vercel Cron sends
// GET; manual triggers from a developer machine sometimes use POST).
// Both delegate to the same handler.
export const GET = POST;
