"use client";

/**
 * Analytics dashboard — pure client component that drives the Recharts
 * canvases and the range selector. Fetches /api/team-analytics on mount
 * and re-fetches whenever the user changes the range.
 *
 * Keeping charts client-only means the server component just decides
 * whether to render this island vs. an upsell, and doesn't need to
 * serialize/deserialize Recharts data through RSC.
 */

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Range = 7 | 30 | 90;

type AnalyticsPayload = {
  plan: string;
  is_team: boolean;
  range: Range;
  range_start: string;
  generated_at: string;
  totals: {
    violations: number;
    evaluations_month: number;
    violation_rate: number | null;
  };
  top_standards: Array<{ standard_id: string; count: number }>;
  daily: Array<{ day: string; count: number }>;
  member_activity: Array<{
    user_id: string;
    email: string | null;
    violations: number;
  }>;
  top_files: Array<{ path: string; violations: number }>;
};

export function AnalyticsClient() {
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/team-analytics?range=${range}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as AnalyticsPayload;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <RangeSelector range={range} onChange={setRange} />
        {data && (
          <span className="text-xs text-neutral-500">
            Updated {new Date(data.generated_at).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {loading && !data ? (
        <LoadingPanel />
      ) : data ? (
        <>
          <UsagePanel totals={data.totals} range={data.range} />
          <TopStandardsPanel items={data.top_standards} />
          <DailyPanel items={data.daily} />
          <TopFilesPanel items={data.top_files} />
          <MemberActivityPanel rows={data.member_activity} />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range selector
// ---------------------------------------------------------------------------
function RangeSelector({
  range,
  onChange,
}: {
  range: Range;
  onChange: (r: Range) => void;
}) {
  const options: Range[] = [7, 30, 90];
  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="inline-flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-800"
    >
      {options.map((opt) => (
        <button
          type="button"
          role="radio"
          aria-checked={range === opt}
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-[5px] px-3 py-1 text-xs font-medium transition ${
            range === opt
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          }`}
        >
          Last {opt} days
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
function UsagePanel({
  totals,
  range,
}: {
  totals: AnalyticsPayload["totals"];
  range: Range;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Usage</h2>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label={`Violations (last ${range}d)`}
          value={totals.violations.toLocaleString()}
        />
        <Metric
          label="Evaluations this month"
          value={totals.evaluations_month.toLocaleString()}
        />
        <Metric
          label="Violation rate"
          value={
            totals.violation_rate !== null
              ? `${totals.violation_rate}%`
              : "—"
          }
          hint={
            totals.violation_rate === null
              ? "Run more checks this month"
              : null
          }
        />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-neutral-400">{hint}</div>}
    </div>
  );
}

function TopStandardsPanel({
  items,
}: {
  items: AnalyticsPayload["top_standards"];
}) {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Top violated standards</h2>
      </header>
      {items.length === 0 ? (
        <EmptyLine>No violations logged in this window.</EmptyLine>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <BarChart
              data={items}
              layout="vertical"
              margin={{ top: 4, right: 12, bottom: 4, left: 32 }}
            >
              <CartesianGrid
                stroke="currentColor"
                strokeOpacity={0.1}
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                strokeOpacity={0.4}
              />
              <YAxis
                type="category"
                dataKey="standard_id"
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                strokeOpacity={0.4}
                width={72}
              />
              <Tooltip
                cursor={{ fillOpacity: 0.05 }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid #e5e5e5",
                }}
              />
              <Bar dataKey="count" fill="currentColor" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function DailyPanel({
  items,
}: {
  items: AnalyticsPayload["daily"];
}) {
  const total = items.reduce((sum, d) => sum + d.count, 0);
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Violations over time</h2>
      </header>
      {total === 0 ? (
        <EmptyLine>No violations logged in this window.</EmptyLine>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <LineChart data={items} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="currentColor" strokeOpacity={0.1} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                strokeOpacity={0.4}
                tickFormatter={(d) => d.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                strokeOpacity={0.4}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid #e5e5e5",
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="currentColor"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function TopFilesPanel({
  items,
}: {
  items: AnalyticsPayload["top_files"];
}) {
  const hasData = items.length > 0;
  return (
    <section
      className={`rounded-lg border p-5 ${
        hasData
          ? "border-neutral-200 dark:border-neutral-800"
          : "border-dashed border-neutral-300 dark:border-neutral-700"
      }`}
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Top files</h2>
        {!hasData && (
          <span className="text-xs text-neutral-500">Awaiting CI data</span>
        )}
      </header>
      {hasData ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="pb-2 font-medium">Path</th>
              <th className="pb-2 text-right font-medium">Violations</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.path}
                className="border-t border-neutral-200 dark:border-neutral-800"
              >
                <td className="py-2 pr-2 font-mono text-xs">{item.path}</td>
                <td className="py-2 text-right">{item.violations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Files appear here once your GitHub Action runs on a pull
          request — the action attaches a source-file path to each
          violation.
        </p>
      )}
    </section>
  );
}

function MemberActivityPanel({
  rows,
}: {
  rows: AnalyticsPayload["member_activity"];
}) {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Member activity</h2>
      </header>
      {rows.length === 0 ? (
        <EmptyLine>
          No activity from any team member in this window.
        </EmptyLine>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="pb-2 font-medium">Member</th>
              <th className="pb-2 text-right font-medium">Violations</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.user_id}
                className="border-t border-neutral-200 dark:border-neutral-800"
              >
                <td className="py-2">
                  {row.email ?? (
                    <span className="text-neutral-500">Unknown user</span>
                  )}
                </td>
                <td className="py-2 text-right">{row.violations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-neutral-500 dark:text-neutral-400">{children}</p>
  );
}

function LoadingPanel() {
  return (
    <div className="flex h-48 items-center justify-center rounded-lg border border-neutral-200 text-sm text-neutral-500 dark:border-neutral-800">
      Loading analytics…
    </div>
  );
}
