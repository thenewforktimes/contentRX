/**
 * Dashboard route loading skeleton.
 *
 * Shows during the cold render while the 5 parallel loaders settle. The
 * heights mirror the live panels so the layout doesn't jump when data
 * arrives. Plain Tailwind — no animation library, no client JS.
 */

import { Eyebrow } from "@/components/ui/eyebrow";

const skeletonClass =
  "animate-pulse rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <Eyebrow>Dashboard</Eyebrow>
          <div className="mt-2 h-7 w-56 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
        <div className="h-6 w-16 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800" />
      </header>
      <section className={`${skeletonClass} h-44 p-5`} />
      <section className={`${skeletonClass} h-32 p-5`} />
      <section className={`${skeletonClass} h-40 p-5`} />
      <section className={`${skeletonClass} h-32 p-5`} />
      <section className={`${skeletonClass} h-48 p-5`} />
      <section className={`${skeletonClass} h-32 p-5`} />
    </div>
  );
}
