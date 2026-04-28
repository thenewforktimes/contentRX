"use client";

/**
 * Optimistic active-surfaces row.
 *
 * Same UI as the prior server-side `ActiveSurfacesRow` + `SurfaceCard`,
 * but takes initial activity as props and listens for
 * `cx-check-completed` window events. When a check fires from this
 * dashboard, the matching surface card increments its count and sets
 * lastAt = now immediately — no waiting for `router.refresh()` to
 * round-trip new server-rendered HTML.
 *
 * State sync follows the same pattern as `usage-panel-live.tsx`: prop
 * changes (from `router.refresh`) overwrite local state on mount via
 * `useEffect`; the event listener provides the optimistic delta. When
 * the round-trip completes the server-authoritative value lands and
 * either matches (no visual change) or corrects any drift.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CHECK_COMPLETED_EVENT,
  isCheckCompletedEvent,
} from "./dashboard-check-events";

export type SurfaceKey =
  | "dashboard"
  | "mcp"
  | "lsp"
  | "action"
  | "plugin"
  | "cli";

export type SurfaceActivity = Record<
  SurfaceKey,
  { count: number; lastAt: Date | null }
>;

export type SurfaceDescriptor = {
  key: SurfaceKey;
  label: string;
  installHref: string;
  installLabel: string;
};

export function ActiveSurfacesRowLive({
  surfaces,
  initialActivity,
}: {
  surfaces: ReadonlyArray<SurfaceDescriptor>;
  initialActivity: SurfaceActivity;
}) {
  const [activity, setActivity] = useState<SurfaceActivity>(initialActivity);

  // Re-sync when the server-rendered prop changes (router.refresh path).
  useEffect(() => {
    setActivity(initialActivity);
  }, [initialActivity]);

  // Optimistic update on a sibling check.
  useEffect(() => {
    function handler(event: Event) {
      if (!isCheckCompletedEvent(event)) return;
      const source = event.detail.source;
      setActivity((prev) => {
        const current = prev[source] ?? { count: 0, lastAt: null };
        return {
          ...prev,
          [source]: {
            count: current.count + 1,
            lastAt: new Date(),
          },
        };
      });
    }
    window.addEventListener(CHECK_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(CHECK_COMPLETED_EVENT, handler);
  }, []);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Active surfaces</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {surfaces.map((s) => (
          <SurfaceCard
            key={s.key}
            label={s.label}
            installHref={s.installHref}
            installLabel={s.installLabel}
            count={activity[s.key]?.count ?? 0}
            lastAt={activity[s.key]?.lastAt ?? null}
          />
        ))}
      </div>
    </section>
  );
}

function SurfaceCard({
  label,
  installHref,
  installLabel,
  count,
  lastAt,
}: {
  label: string;
  installHref: string;
  installLabel: string;
  count: number;
  lastAt: Date | null;
}) {
  const connected = count > 0 && lastAt !== null;
  return (
    <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <p className="font-medium">{label}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <span
          aria-hidden
          className={
            connected
              ? "inline-block h-2 w-2 rounded-full bg-emerald-500"
              : "inline-block h-2 w-2 rounded-full border border-neutral-300 dark:border-neutral-700"
          }
        />
        <span className="text-xs text-neutral-600 dark:text-neutral-300">
          {connected && lastAt ? formatRelative(lastAt) : "Not connected"}
        </span>
      </div>
      {connected ? (
        <p className="mt-1 text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
          {count.toLocaleString()} {count === 1 ? "check" : "checks"}
        </p>
      ) : (
        <Link
          href={installHref}
          className="mt-1 inline-block text-xs text-neutral-900 underline dark:text-neutral-100"
        >
          {installLabel} →
        </Link>
      )}
    </div>
  );
}

// Same logic as page.tsx::formatRelative — duplicated here so this
// Client Component stays self-contained. Tolerant of Date OR string at
// runtime as defense-in-depth (cache-deserialization carve-out).
function formatRelative(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
