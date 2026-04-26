"use client";

/**
 * Recharts-using calibration charts.
 *
 * Phase B5b of the post-pivot rolling plan. Replaces the text
 * sparklines on `/admin/calibration` with a single aggregate
 * line chart showing system κ over the last N weeks. Recharts is
 * heavy (~115kB) so this file lives behind a dynamic import in
 * `calibration-charts-client.tsx` — the chart bundle only loads
 * when /admin/calibration mounts, not on every admin nav.
 *
 * Data shape: an array of `{ week_offset, kappa, sample_size }`
 * pairs, oldest first. `week_offset` is 0 for the most recent week,
 * negative for older weeks (so the X axis reads as "weeks ago" left
 * to right). Pending weeks are omitted upstream — Recharts handles
 * gaps natively when the array doesn't include them.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface SystemKappaPoint {
  week_offset: number;
  kappa: number;
  sample_size: number;
}

export interface SystemKappaTrendChartProps {
  points: SystemKappaPoint[];
  designTarget: number;
  autonomousThreshold: number;
}

export function SystemKappaTrendChart({
  points,
  designTarget,
  autonomousThreshold,
}: SystemKappaTrendChartProps) {
  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
        No weekly κ measurements available yet. The chart populates as
        per-standard κ accumulates across multiple weeks.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 12, right: 16, bottom: 8, left: 8 }}
          >
            <CartesianGrid stroke="rgba(0,0,0,0.06)" strokeDasharray="3 3" />
            <XAxis
              dataKey="week_offset"
              tickFormatter={(value: number) =>
                value === 0 ? "now" : `${value}w`
              }
              fontSize={11}
              stroke="rgba(0,0,0,0.4)"
            />
            <YAxis
              domain={[0.5, 1.0]}
              ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1.0]}
              tickFormatter={(value: number) => value.toFixed(2)}
              fontSize={11}
              stroke="rgba(0,0,0,0.4)"
              width={36}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 6,
                background: "rgba(255,255,255,0.95)",
                border: "1px solid rgba(0,0,0,0.1)",
              }}
            />
            <ReferenceLine
              y={designTarget}
              stroke="rgba(0,0,0,0.4)"
              strokeDasharray="4 4"
              label={{
                value: "design target",
                position: "right",
                fontSize: 10,
                fill: "rgba(0,0,0,0.5)",
              }}
            />
            <ReferenceLine
              y={autonomousThreshold}
              stroke="rgba(16, 185, 129, 0.5)"
              strokeDasharray="2 6"
              label={{
                value: "autonomous κ",
                position: "right",
                fontSize: 10,
                fill: "rgba(16, 185, 129, 0.7)",
              }}
            />
            <Line
              type="monotone"
              dataKey="kappa"
              stroke="rgb(38, 38, 38)"
              strokeWidth={2}
              dot={{ r: 3, fill: "rgb(38, 38, 38)" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
