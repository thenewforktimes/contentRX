/**
 * `/admin/agent-runs` — V1 review surface for the weekly review agent.
 *
 * Phase G1 of the 2026-05-09 roadmap. Lists rows from `agent_runs`
 * with the most recent runs first. Each row shows the team, when it
 * ran, the header variant, the total flag count, and the top three
 * patterns. Substrate IDs (`standard_id`) render here because /admin
 * is founder-only and is allowed to render substrate per
 * docs/copy-vocabulary.md "Audience boundary." The customer-facing
 * surface (G3, day 4) translates standardId to a customer-friendly
 * pattern label and never lands the substrate ID.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AgentRunPayload } from "@/lib/agent/run-agent";

export const dynamic = "force-dynamic";

const HEADER_VARIANT_LABELS: Record<string, string> = {
  drift: "Flagged for drift",
  "no-repetition": "Isolated flags",
  mixed: "Drift + isolated",
  empty: "Setup prompt (0–1 flags)",
};

export default async function AgentRunsPage() {
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .orderBy(desc(schema.agentRuns.runAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-quiet">
          Weekly review agent · V1
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Agent runs</h1>
        <p className="mt-3 text-sm text-default">
          Read-only output from the weekly review agent (Phase G1).
          Each row is one team&apos;s pattern grouping over the last
          30 days. Zero LLM calls per run, zero checks consumed. The
          customer-facing PR-comment digest (G3) reads from these
          rows; this page is the founder review surface for the
          stream before the customer-facing rendering ships.
        </p>
      </header>

      {runs.length === 0 ? (
        <p className="rounded-md border border-line bg-raised p-4 text-sm text-default">
          No runs yet. The Monday cron at 13:00 UTC populates this
          page; manual triggers go through{" "}
          <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs">
            POST /api/cron/agent-run
          </code>{" "}
          with the cron secret.
        </p>
      ) : (
        <ul className="space-y-3">
          {runs.map((run) => {
            const payload = run.payload as AgentRunPayload;
            return (
              <li
                key={run.id}
                className="rounded-md border border-line bg-raised p-4 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-quiet">
                      {run.runAt.toISOString()}
                    </p>
                    <p className="mt-1 text-default">
                      Team{" "}
                      <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs">
                        {run.teamId}
                      </code>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-strong">
                      {HEADER_VARIANT_LABELS[run.headerVariant] ??
                        run.headerVariant}
                    </p>
                    <p className="text-xs text-quiet">
                      {run.totalFlags} flags / {run.windowDays}d window
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-quiet">
                      Top patterns
                    </p>
                    {payload.topPatterns.length === 0 ? (
                      <p className="mt-1 text-quiet">None</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {payload.topPatterns.map((p) => (
                          <li key={p.standardId} className="text-default">
                            <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs">
                              {p.standardId}
                            </code>{" "}
                            <span className="text-quiet">·</span>{" "}
                            {p.count} flags ·{" "}
                            <span className="text-quiet">
                              h{p.severityCounts.high} m
                              {p.severityCounts.medium} l
                              {p.severityCounts.low}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-quiet">
                      Customization signal
                    </p>
                    <ul className="mt-1 space-y-1 text-default">
                      <li>
                        Overrides (window):{" "}
                        <span className="font-mono">
                          {payload.customization.overrideCount}
                        </span>
                      </li>
                      <li>
                        Custom examples:{" "}
                        <span className="font-mono">
                          {payload.customization.customExampleCount}
                        </span>
                      </li>
                      <li>
                        Team rules:{" "}
                        <span className="font-mono">
                          {payload.customization.teamRuleCount}
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
