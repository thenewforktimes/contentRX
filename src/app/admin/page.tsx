/**
 * `/admin` — pilot tracker.
 *
 * Phase 5 of the pre-pilot launch build. The landing page for the
 * founder dashboard. Lists every user with engagement metrics so
 * the founder can see who's actively using the product and who's
 * at risk.
 *
 * Replaces the prior link-card index (Phase B1). The nav header
 * still exposes every admin sub-route — discoverability moves there.
 *
 * Auth via `src/app/admin/layout.tsx`.
 */

import {
  conversationTriggers,
  loadPilotTracker,
  type ActivityStatus,
  type ConversationTrigger,
  type PilotRow,
} from "@/lib/admin/pilot-tracker";

export const metadata = {
  title: "Pilot tracker · ContentRX admin",
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<ActivityStatus, string> = {
  green: "Active",
  amber: "Slowing",
  red: "At risk",
  dormant: "Dormant",
};

const STATUS_TONE: Record<ActivityStatus, string> = {
  green:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  dormant:
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

export default async function AdminIndexPage() {
  const rows = await loadPilotTracker();
  const triggers = conversationTriggers(rows);

  const summary = summarize(rows);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Pilot tracker
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Engagement across every user. Sorted by most recent activity;
          dormant users at the end.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Total" value={rows.length} />
        <SummaryCard
          label="Active 48h"
          value={summary.active}
          tone="green"
        />
        <SummaryCard
          label="Slowing"
          value={summary.amber}
          tone="amber"
        />
        <SummaryCard label="At risk" value={summary.red} tone="red" />
        <SummaryCard
          label="Paused (cost)"
          value={summary.paused}
          tone={summary.paused > 0 ? "amber" : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <PilotTable rows={rows} />
        <TriggerSidebar triggers={triggers} />
      </div>
    </div>
  );
}

function PilotTable({ rows }: { rows: PilotRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        No users yet. The tracker populates as Clerk sign-ups hit the
        DB.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
        <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">User</th>
            <th className="px-4 py-2">Plan</th>
            <th className="px-4 py-2">Last check</th>
            <th className="px-4 py-2 text-right">7d</th>
            <th className="px-4 py-2 text-right">Total</th>
            <th className="px-4 py-2 text-right">Overrides</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className="px-4 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
                {row.costPauseActive && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    Paused
                  </span>
                )}
              </td>
              <td className="px-4 py-2">
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {row.email}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {row.userId}
                </p>
              </td>
              <td className="px-4 py-2 capitalize">{row.plan}</td>
              <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                {row.lastCheckAt
                  ? formatRelative(row.lastCheckAt)
                  : "Never"}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {row.checks7d.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {row.checksTotal.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {row.overrideCount.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TriggerSidebar({
  triggers,
}: {
  triggers: ConversationTrigger[];
}) {
  return (
    <aside className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
          Conversation triggers
        </h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          What to talk to which pilot about, today.
        </p>
      </header>
      {triggers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-200 p-4 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          No triggers fired. Everyone is steady-state.
        </p>
      ) : (
        <ul className="space-y-2">
          {triggers.map((trigger, i) => (
            <li
              key={`${trigger.kind}-${trigger.userId}-${i}`}
              className="rounded-lg border border-neutral-200 bg-white p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900"
            >
              {trigger.kind === "debrief_50_checks" ? (
                <>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">
                    Schedule a debrief
                  </p>
                  <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                    {trigger.email} ran {trigger.checks7d} checks in
                    the last 7 days.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">
                    At-risk pilot
                  </p>
                  <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                    {trigger.email} ({trigger.plan}) hasn&rsquo;t run a
                    check in {trigger.daysIdle} days.
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: ActivityStatus | "amber";
}) {
  const toneClass = tone
    ? STATUS_TONE[tone as ActivityStatus]
    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
          {value}
        </span>
        {tone && value > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}
          >
            {label}
          </span>
        )}
      </p>
    </div>
  );
}

function summarize(rows: PilotRow[]) {
  let active = 0;
  let amber = 0;
  let red = 0;
  let paused = 0;
  for (const row of rows) {
    if (row.status === "green") active++;
    if (row.status === "amber") amber++;
    if (row.status === "red") red++;
    if (row.costPauseActive) paused++;
  }
  return { active, amber, red, paused };
}

function formatRelative(date: Date): string {
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
