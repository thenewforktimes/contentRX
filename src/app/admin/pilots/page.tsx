/**
 * `/admin/pilots` — pilot tracker.
 *
 * Per-user activity feed: every user shows up with their plan, last
 * check, 7-day / total counts, and override count, so the founder
 * sees who's actively using the product, who hasn't logged in, and
 * who's at risk. Conversation-trigger sidebar nudges in the right
 * rail flag who to talk to about what.
 *
 * Status indicator semantics (the colored pill per row):
 *   - `green`   — checked in within the last 48 hours
 *   - `amber`   — checked in 48 hours to 7 days ago
 *   - `red`     — last check >7 days ago
 *   - `dormant` — never checked
 *
 * Conversation triggers:
 *   - `debrief_50_checks` — user crossed 50 checks in the last 7 days
 *   - `at_risk_idle`      — Pro/Team/Scale user with no check in 7 days
 *
 * Auth via `src/app/admin/layout.tsx`.
 *
 * Moved here from `/admin` (which is now the curated Today's queue)
 * so the founder dashboard's landing page can prioritize the
 * model-improvement loop. Pilot monitoring stays one click away.
 */

import { Pill, type PillTone } from "@/components/ui/pill";
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

const STATUS_PILL_TONE: Record<ActivityStatus, PillTone> = {
  green: "emerald",
  amber: "amber",
  red: "red",
  dormant: "neutral",
};

export default async function AdminPilotsPage() {
  const rows = await loadPilotTracker();
  const triggers = conversationTriggers(rows);

  const summary = summarize(rows);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Pilot tracker
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
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
        <SummaryCard label="Slowing" value={summary.amber} tone="amber" />
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
      <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
        No users yet. The tracker populates as Clerk sign-ups hit the DB.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
      <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-800">
        <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-600 dark:bg-stone-900 dark:text-stone-400">
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
        <tbody className="divide-y divide-stone-100 dark:divide-stone-900">
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className="px-4 py-2">
                <Pill tone={STATUS_PILL_TONE[row.status]}>
                  {STATUS_LABEL[row.status]}
                </Pill>
                {row.costPauseActive && (
                  <Pill tone="amber" className="ml-2">
                    Paused
                  </Pill>
                )}
              </td>
              <td className="px-4 py-2">
                <p className="font-medium text-stone-900 dark:text-stone-100">
                  {row.email}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {row.userId}
                </p>
              </td>
              <td className="px-4 py-2 capitalize">{row.plan}</td>
              <td className="px-4 py-2 text-stone-600 dark:text-stone-400">
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-400">
          Conversation triggers
        </h2>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          What to talk to which pilot about, today.
        </p>
      </header>
      {triggers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-200 p-4 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
          No triggers fired. Everyone is steady-state.
        </p>
      ) : (
        <ul className="space-y-2">
          {triggers.map((trigger, i) => (
            <li
              key={`${trigger.kind}-${trigger.userId}-${i}`}
              className="rounded-lg border border-stone-200 bg-white p-3 text-xs dark:border-stone-800 dark:bg-stone-900"
            >
              {trigger.kind === "debrief_50_checks" ? (
                <>
                  <p className="font-medium text-stone-900 dark:text-stone-100">
                    Schedule a debrief
                  </p>
                  <p className="mt-1 text-stone-600 dark:text-stone-400">
                    {trigger.email} ran {trigger.checks7d} checks in the
                    last 7 days.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium text-stone-900 dark:text-stone-100">
                    At-risk pilot
                  </p>
                  <p className="mt-1 text-stone-600 dark:text-stone-400">
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
  const pillTone: PillTone = tone
    ? STATUS_PILL_TONE[tone as ActivityStatus]
    : "neutral";
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
      <p className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">
          {value}
        </span>
        {tone && value > 0 && <Pill tone={pillTone}>{label}</Pill>}
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
