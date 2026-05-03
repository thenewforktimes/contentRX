"use client";

/**
 * Client-island wrapper that dynamic-imports the Recharts chart so
 * the ~115kB Recharts bundle is a separate webpack chunk loaded only
 * when /admin/calibration mounts. Mirrors the pattern in
 * `src/app/dashboard/team/analytics/analytics-client.tsx`.
 */

import dynamic from "next/dynamic";
import type { SystemKappaTrendChartProps } from "./charts";

const SystemKappaTrendChart = dynamic(
  () => import("./charts").then((m) => m.SystemKappaTrendChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900" />
    ),
  },
);

export function CalibrationCharts(props: SystemKappaTrendChartProps) {
  return <SystemKappaTrendChart {...props} />;
}
