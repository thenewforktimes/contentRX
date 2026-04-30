/**
 * `/admin/costs` — founder cost monitor.
 *
 * Phase 4 of the pre-pilot launch build. Shows per-user, per-day model
 * spend computed from `usage_events` rows written on every /api/check
 * completion. Highlights paused users with a Resume button that
 * clears `cost_pause_active` so the next /api/check goes through.
 *
 * The estimate is approximate (Anthropic list-price × token counts
 * via `src/lib/pricing/model-rates.ts`); accurate enough to catch a
 * runaway pilot before it costs real money. For invoice-grade
 * numbers, cross-reference Anthropic's billing dashboard.
 *
 * Auth: founder-only via `/admin/layout.tsx`.
 */

import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { clearCostPause, dailyCostRollup } from "@/lib/cost-monitor";

export const metadata = {
  title: "Costs · ContentRX admin",
  robots: { index: false, follow: false },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLUP_WINDOW_DAYS = 30;

interface UserSummary {
  id: string;
  email: string;
  costPauseActive: boolean;
  dailyThresholdUsd: string;
  monthlyThresholdUsd: string;
}

interface DailyRow {
  userId: string;
  day: string;
  totalCostUsd: number;
  eventCount: number;
}

async function loadAllUsers(): Promise<UserSummary[]> {
  const db = getDb();
  return db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      costPauseActive: schema.users.costPauseActive,
      dailyThresholdUsd: schema.users.dailyCostThresholdUsd,
      monthlyThresholdUsd: schema.users.monthlyCostThresholdUsd,
    })
    .from(schema.users);
}

async function resumeUser(formData: FormData) {
  "use server";
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId.length === 0) {
    return;
  }
  await clearCostPause(userId);
  revalidatePath("/admin/costs");
}

export default async function AdminCostsPage() {
  const start = new Date(Date.now() - ROLLUP_WINDOW_DAYS * DAY_MS);
  const [users, rollup] = await Promise.all([
    loadAllUsers(),
    dailyCostRollup({ start }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const rowsByUser = groupRowsByUser(rollup);

  const pausedUsers = users.filter((u) => u.costPauseActive);
  const usersWithActivity = users
    .filter((u) => rowsByUser.has(u.id))
    .sort((a, b) => {
      const aTotal = totalForUser(rowsByUser.get(a.id) ?? []);
      const bTotal = totalForUser(rowsByUser.get(b.id) ?? []);
      return bTotal - aTotal;
    });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Costs
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Per-user, per-day model spend over the last{" "}
          {ROLLUP_WINDOW_DAYS} days. Estimates use Anthropic list-price
          × logged tokens; cross-reference Anthropic billing for
          invoice-grade numbers.
        </p>
      </header>

      {pausedUsers.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {pausedUsers.length} user
            {pausedUsers.length === 1 ? "" : "s"} paused
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {pausedUsers.map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white px-3 py-2 dark:bg-neutral-900"
              >
                <div>
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">
                    {user.email}
                  </p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    Daily ${user.dailyThresholdUsd} · Monthly $
                    {user.monthlyThresholdUsd} · id {user.id}
                  </p>
                </div>
                <form action={resumeUser}>
                  <input type="hidden" name="userId" value={user.id} />
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300"
                  >
                    Resume
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
          Spend by user
        </h2>
        {usersWithActivity.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            No checks logged in the last {ROLLUP_WINDOW_DAYS} days. The
            usage_events table is fresh post-launch; rows accumulate as
            pilots run.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2 text-right">30d total</th>
                  <th className="px-4 py-2 text-right">30d events</th>
                  <th className="px-4 py-2 text-right">Daily threshold</th>
                  <th className="px-4 py-2 text-right">Monthly threshold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
                {usersWithActivity.map((user) => {
                  const rows = rowsByUser.get(user.id) ?? [];
                  const total = totalForUser(rows);
                  const events = rows.reduce(
                    (sum, r) => sum + r.eventCount,
                    0,
                  );
                  return (
                    <tr key={user.id}>
                      <td className="px-4 py-2">
                        <p className="font-medium text-neutral-900 dark:text-neutral-100">
                          {user.email}
                        </p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {user.id}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        ${total.toFixed(4)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {events.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                        ${user.dailyThresholdUsd}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                        ${user.monthlyThresholdUsd}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
          Daily breakdown
        </h2>
        {rollup.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
            No daily rollup yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2">Day</th>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2 text-right">Cost</th>
                  <th className="px-4 py-2 text-right">Events</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
                {rollup.map((row, i) => {
                  const user = userById.get(row.userId);
                  return (
                    <tr key={`${row.userId}-${row.day}-${i}`}>
                      <td className="px-4 py-2 tabular-nums">{row.day}</td>
                      <td className="px-4 py-2">
                        {user?.email ?? row.userId}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        ${row.totalCostUsd.toFixed(4)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {row.eventCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function groupRowsByUser(rollup: DailyRow[]): Map<string, DailyRow[]> {
  const map = new Map<string, DailyRow[]>();
  for (const row of rollup) {
    const list = map.get(row.userId) ?? [];
    list.push(row);
    map.set(row.userId, list);
  }
  return map;
}

function totalForUser(rows: DailyRow[]): number {
  return rows.reduce((sum, r) => sum + r.totalCostUsd, 0);
}
