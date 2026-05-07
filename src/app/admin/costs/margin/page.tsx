/**
 * `/admin/costs/margin` — per-plan cost + margin rollup.
 *
 * Phase 2 of the post-Phase-1 build (per _private/pricing-analysis.md).
 * Shows the 7-day rolling cost-per-unit, margin, cache hit ratio, and
 * check volume for each plan tier. The daily cron at
 * /api/cron/cost-margin-check runs the same rollup and emails the
 * founder when any paid plan's margin drops below 30%.
 *
 * Auth: founder-only via /admin/layout.tsx (Clerk role check). Non-
 * founders get notFound() from the layout and never reach this page.
 *
 * Data source: `usage_events` rows written by `recordUsageEvent` on
 * every successful /api/check completion. Cost numbers are
 * Anthropic list-price × logged tokens; cross-reference Anthropic
 * billing for invoice-grade numbers.
 */

import { getCostMarginRollup, type PlanRollup } from "@/lib/cost-margin-rollup";

export const metadata = {
  title: "Margin · ContentRX admin",
  robots: { index: false, follow: false },
};

const PLAN_DISPLAY_ORDER: PlanRollup["plan"][] = [
  "free",
  "pro",
  "team",
  "scale",
];

const PLAN_DISPLAY_NAMES: Record<PlanRollup["plan"], string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  scale: "Scale",
};

const ALERT_THRESHOLD_PCT = 30;

export default async function AdminMarginPage() {
  const rollup = await getCostMarginRollup({ windowDays: 7 });

  // Sort rows in PLAN_DISPLAY_ORDER so the layout stays stable across
  // refreshes regardless of which plans had activity.
  const orderedRows = PLAN_DISPLAY_ORDER.map((plan) =>
    rollup.plans.find((p) => p.plan === plan),
  ).filter((p): p is PlanRollup => p !== undefined);

  const hasAnyActivity = orderedRows.some((p) => p.checkCount > 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-strong">Margin</h1>
        <p className="mt-1 text-sm text-quiet">
          Per-plan cost, margin, and cache hit over the last{" "}
          {rollup.windowDays} days. Alerts fire when any paid plan&rsquo;s
          margin drops below {ALERT_THRESHOLD_PCT}%.
        </p>
      </header>

      {rollup.currentlyPausedCount > 0 && (
        <section className="rounded-lg border border-accent-caution-border bg-accent-caution-soft p-4">
          <h2 className="text-sm font-semibold text-accent-caution-text">
            {rollup.currentlyPausedCount} user
            {rollup.currentlyPausedCount === 1 ? "" : "s"} currently paused
          </h2>
          <p className="mt-1 text-xs text-accent-caution-text">
            See <a href="/admin/costs" className="underline underline-offset-2">/admin/costs</a> to
            review and resume.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
          Per-plan rollup
        </h2>
        {!hasAnyActivity ? (
          <p className="mt-3 text-sm text-quiet">
            No checks logged in the last {rollup.windowDays} days.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-overlay text-left text-xs font-medium uppercase tracking-wide text-quiet">
                <tr>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2 text-right">Checks</th>
                  <th className="px-4 py-2 text-right">Total cost</th>
                  <th className="px-4 py-2 text-right">$/unit</th>
                  <th className="px-4 py-2 text-right">Revenue/unit</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                  <th className="px-4 py-2 text-right">Cache hit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orderedRows.map((p) => (
                  <MarginRow key={p.plan} row={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="text-xs text-quiet">
        <p>
          Costs are Anthropic list-price × logged tokens. Margin is
          (revenue per unit minus cost per unit) divided by revenue per
          unit. Free plan has no revenue and shows margin as &mdash;.
        </p>
      </section>
    </div>
  );
}

function MarginRow({ row }: { row: PlanRollup }) {
  const marginCellClass =
    row.marginPct !== null && row.marginPct < ALERT_THRESHOLD_PCT
      ? "text-accent-concern-text font-semibold"
      : "";

  return (
    <tr>
      <td className="px-4 py-2">
        <p className="font-medium text-strong">
          {PLAN_DISPLAY_NAMES[row.plan]}
        </p>
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        {row.checkCount.toLocaleString()}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        ${row.totalCostUsd.toFixed(4)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        ${row.avgCostPerUnitUsd.toFixed(4)}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-quiet">
        {row.perUnitRevenueUsd > 0
          ? `$${row.perUnitRevenueUsd.toFixed(4)}`
          : "—"}
      </td>
      <td className={`px-4 py-2 text-right tabular-nums ${marginCellClass}`}>
        {row.marginPct !== null ? `${row.marginPct.toFixed(0)}%` : "—"}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-quiet">
        {(row.avgCacheHitRatio * 100).toFixed(0)}%
      </td>
    </tr>
  );
}
