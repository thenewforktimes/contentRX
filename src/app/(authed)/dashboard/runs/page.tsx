/**
 * `/dashboard/runs` — CI runs index.
 *
 * The CI-runs tab in the folder-tab nav points here. Earlier this
 * route had no index page (only `[run_id]/page.tsx`), so clicking
 * the tab went straight to a 404 — caught by Robo during the
 * design-critique pass before beta.
 *
 * The page lists every distinct `run_id` the team has logged
 * violations under, most-recent-first, with per-run rollups (file
 * count, finding count, severity mix, source surface, time range).
 * Each row links to the per-run audit log at
 * /dashboard/runs/[run_id].
 *
 * Most teams during early beta will have zero runs — the empty state
 * is the load-bearing UX. Lead with the install path (link to
 * /install#action) and an honest note that runs only show up here
 * after the GitHub Action has actually fired on a PR.
 *
 * Privacy: same as the per-run page — only metadata renders. No
 * issue text, no suggestion text, no hashed-text noise. The rollup
 * counts derive from `violations.run_id` GROUP BY.
 *
 * Auth: Clerk session. Team members see the team's runs; solo users
 * see their own. team_id is always populated per the team-scope
 * convention (see lib/team-scope.ts).
 */

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getDb, schema } from "@/db";
import { humanizeSource } from "@/lib/humanize";
import { getOrProvisionUser } from "@/lib/user-provisioning";

const PAGE_LIMIT = 50;

interface RunRollup {
  runId: string;
  earliestAt: Date;
  latestAt: Date;
  findingCount: number;
  fileCount: number;
  highCount: number;
  source: string | null;
}

export default async function DashboardRunsIndexPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    redirect("/sign-in?redirect_url=/dashboard/runs");
  }

  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return (
      <section className="rounded-lg border border-line bg-raised p-6 text-sm">
        <p>We&apos;re finishing setting up your account. Refresh in a moment.</p>
      </section>
    );
  }

  const teamId = user.teamOwnerUserId ?? user.id;
  const db = getDb();

  const runs = (await db
    .select({
      runId: schema.violations.runId,
      earliestAt: sql<Date>`min(${schema.violations.createdAt})`,
      latestAt: sql<Date>`max(${schema.violations.createdAt})`,
      findingCount: sql<number>`count(*)::int`,
      fileCount: sql<number>`count(distinct ${schema.violations.filePath})::int`,
      highCount: sql<number>`count(*) filter (where ${schema.violations.severity} = 'high')::int`,
      // Most runs come from a single source (GitHub Action). When
      // multiple sources contribute to a run_id, we surface the
      // first one alphabetically just so the column has something —
      // the per-run page shows "mixed" if the actual sources span.
      source: sql<string | null>`min(${schema.violations.source})`,
    })
    .from(schema.violations)
    .where(
      and(
        isNotNull(schema.violations.runId),
        or(
          eq(schema.violations.teamId, teamId),
          eq(schema.violations.userId, user.id),
        ),
      ),
    )
    .groupBy(schema.violations.runId)
    .orderBy(desc(sql`max(${schema.violations.createdAt})`))
    .limit(PAGE_LIMIT)) as Array<{
      runId: string | null;
      earliestAt: Date;
      latestAt: Date;
      findingCount: number;
      fileCount: number;
      highCount: number;
      source: string | null;
    }>;

  const rollups: RunRollup[] = runs
    .filter((r): r is RunRollup & { runId: string } => r.runId !== null)
    .map((r) => ({
      runId: r.runId,
      earliestAt: new Date(r.earliestAt),
      latestAt: new Date(r.latestAt),
      findingCount: r.findingCount,
      fileCount: r.fileCount,
      highCount: r.highCount,
      source: r.source,
    }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Eyebrow>Runs</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold">Recent runs</h1>
        <p className="mt-1 text-sm text-default">
          Every run from the GitHub Action, CLI, MCP server, or LSP
          that flagged content. For Action runs the PR comment stays
          the actionable surface; this list is the durable record
          once the PR closes.
        </p>
      </header>

      {rollups.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {rollups.map((r) => (
            <li key={r.runId}>
              <Link
                href={`/dashboard/runs/${r.runId}`}
                className="flex flex-col gap-1 rounded-lg border border-line p-4 hover:border-line-strong"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <code className="text-sm font-medium tabular-nums">
                    {r.runId}
                  </code>
                  <span className="text-xs text-quiet tabular-nums">
                    {formatRelative(r.latestAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-default">
                  <span>
                    <span className="font-semibold tabular-nums">
                      {r.findingCount}
                    </span>{" "}
                    finding{r.findingCount === 1 ? "" : "s"}
                  </span>
                  <span>
                    across{" "}
                    <span className="font-semibold tabular-nums">
                      {r.fileCount}
                    </span>{" "}
                    file{r.fileCount === 1 ? "" : "s"}
                  </span>
                  {r.highCount > 0 && (
                    <span className="text-accent-concern-text">
                      <span className="font-semibold tabular-nums">
                        {r.highCount}
                      </span>{" "}
                      high
                    </span>
                  )}
                  {r.source && (
                    <span className="text-quiet">via {humanizeSource(r.source)}</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-line-strong bg-overlay p-8 text-sm">
      <h2 className="text-base font-semibold text-strong">
        No runs yet
      </h2>
      <p className="mt-2 text-default">
        Runs show up here after any of the engine surfaces flag at
        least one finding under a shared run id. That includes the
        GitHub Action on a PR, the CLI in a CI job, the MCP server
        in your editor, and the LSP via diagnostics. Clean passes
        (verdict &quot;All clear&quot;) don&apos;t create rows
        because there&apos;s no audit content to record.
      </p>
      <p className="mt-3 text-default">
        Install any surface, run a check on writing that has a finding,
        and rows will start landing here.
      </p>
      <Link
        href="/install"
        className={`${buttonStyles({ size: "sm" })} mt-4`}
      >
        Install a surface →
      </Link>
    </section>
  );
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
