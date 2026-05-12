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
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isGithubAppConfigured } from "@/lib/agent/github-app";
import { openPrForDigest } from "@/lib/agent/open-pr";
import { renderDigest } from "@/lib/agent/render-digest";
import { persistAgentRun } from "@/lib/agent/run-agent";
import type { AgentRunPayload } from "@/lib/agent/run-agent";
import { requireCronAuth } from "@/lib/cron-auth";
import { logSafeError } from "@/lib/safe-error-log";

interface RunResult {
  ok: true;
  teamsConsidered: number;
  runsPersisted: number;
  runsSkipped: number;
  prsOpened: number;
  failures: Array<{ teamId: string; error: string }>;
}

// Idempotency window: if `agent_runs` already has a row for this
// team within the last 6 days, skip the team. The cron runs Monday
// 13:00 UTC weekly, so 6 days is enough to dedupe same-week replays
// (Vercel cron retries, manual triggers, /api/cron/agent-run hit
// twice via the GET = POST alias) without blocking the next scheduled
// run from firing. There is no UNIQUE constraint on (teamId, week)
// — the partial check stays in the cron rather than the schema so
// preview / backfill writes can still bypass it.
const SAME_WEEK_DEDUPE_MS = 6 * 24 * 60 * 60 * 1000;

// Parallelism budget. Each owner runs ≥3 DB selects, possibly 1
// GitHub API call, and 1 DB update — so processing all team owners
// in series scales linearly with team count and risks Vercel's 60s
// function timeout once ≥30 teams have the GitHub App connected.
// Process up to PARALLEL_OWNERS in flight at once; the rest queue.
// Keep small enough to stay well under the Drizzle pool's ~10
// connection ceiling and GitHub's secondary rate limits.
const PARALLEL_OWNERS = 5;

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
  let runsSkipped = 0;
  let prsOpened = 0;
  const githubAppLive = isGithubAppConfigured();
  const dedupeFloor = new Date(Date.now() - SAME_WEEK_DEDUPE_MS);

  type OwnerOutcome =
    | { kind: "skipped" }
    | { kind: "persisted"; prOpened: boolean }
    | { kind: "failed"; error: string };

  async function processOwner(ownerId: string): Promise<OwnerOutcome> {
    const [existing] = (await db
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.teamId, ownerId),
          gt(schema.agentRuns.runAt, dedupeFloor),
        ),
      )
      .limit(1)) as Array<{ id: string }>;

    if (existing) {
      return { kind: "skipped" };
    }

    const row = await persistAgentRun(ownerId);

    // GitHub-side delivery is gated by App-config presence AND the
    // team having connected a repo. Either being absent silently
    // skips the PR step — the run is still persisted to
    // agent_runs and visible at /admin/agent-runs.
    if (!githubAppLive) return { kind: "persisted", prOpened: false };

    const installation = await getInstallation(db, ownerId);
    if (!installation) return { kind: "persisted", prOpened: false };
    if (!installation.targetRepoOwner || !installation.targetRepoName) {
      return { kind: "persisted", prOpened: false };
    }

    const payload = row.payload as AgentRunPayload;
    const digestMarkdown = renderDigest(payload);

    const prResult = await openPrForDigest({
      installationId: installation.githubInstallationId,
      owner: installation.targetRepoOwner,
      repo: installation.targetRepoName,
      branch: installation.targetBranch,
      digestMarkdown,
      runAtIso: payload.runAt,
    });

    if (prResult.ok) {
      await db
        .update(schema.agentGithubInstallations)
        .set({
          lastPrNumber: prResult.number,
          lastPrUrl: prResult.htmlUrl,
          lastPrAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          eq(schema.agentGithubInstallations.id, installation.id),
        );
      return { kind: "persisted", prOpened: true };
    }
    return {
      kind: "failed",
      error: `pr_${prResult.reason}: ${prResult.message}`,
    };
  }

  // Chunk into batches of PARALLEL_OWNERS. allSettled per chunk so
  // one team's failure doesn't abort the rest. Sequential between
  // chunks to bound DB/HTTP concurrency.
  for (let i = 0; i < owners.length; i += PARALLEL_OWNERS) {
    const chunk = owners.slice(i, i + PARALLEL_OWNERS);
    const settled = await Promise.allSettled(
      chunk.map((owner) => processOwner(owner.id)),
    );

    settled.forEach((result, idx) => {
      const owner = chunk[idx];
      if (!owner) return;
      if (result.status === "rejected") {
        const err = result.reason;
        logSafeError("[cron/agent-run]", err);
        failures.push({
          teamId: owner.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const outcome = result.value;
      if (outcome.kind === "skipped") {
        runsSkipped++;
      } else if (outcome.kind === "persisted") {
        runsPersisted++;
        if (outcome.prOpened) prsOpened++;
      } else {
        // persisted-but-PR-failed counts toward runsPersisted and
        // also surfaces as a failure for /admin/agent-runs review.
        runsPersisted++;
        failures.push({ teamId: owner.id, error: outcome.error });
      }
    });
  }

  const result: RunResult = {
    ok: true,
    teamsConsidered: owners.length,
    runsPersisted,
    runsSkipped,
    prsOpened,
    failures,
  };
  return NextResponse.json(result);
}

async function getInstallation(
  db: ReturnType<typeof getDb>,
  teamId: string,
): Promise<{
  id: string;
  githubInstallationId: number;
  targetRepoOwner: string;
  targetRepoName: string;
  targetBranch: string;
} | null> {
  const rows = (await db
    .select({
      id: schema.agentGithubInstallations.id,
      githubInstallationId:
        schema.agentGithubInstallations.githubInstallationId,
      targetRepoOwner: schema.agentGithubInstallations.targetRepoOwner,
      targetRepoName: schema.agentGithubInstallations.targetRepoName,
      targetBranch: schema.agentGithubInstallations.targetBranch,
    })
    .from(schema.agentGithubInstallations)
    .where(eq(schema.agentGithubInstallations.teamId, teamId))
    .limit(1)) as Array<{
    id: string;
    githubInstallationId: number;
    targetRepoOwner: string;
    targetRepoName: string;
    targetBranch: string;
  }>;
  return rows[0] ?? null;
}

// Allow GET for parity with the other cron routes (Vercel Cron sends
// GET; manual triggers from a developer machine sometimes use POST).
// Both delegate to the same handler.
export const GET = POST;
