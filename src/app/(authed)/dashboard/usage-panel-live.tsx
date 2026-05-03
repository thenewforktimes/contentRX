"use client";

/**
 * Optimistic usage panel.
 *
 * Renders the same UI as the prior server-side UsagePanel, but takes
 * `initialUsed` / `initialQuota` as seeds and listens for
 * `cx-check-completed` window events to update instantly when a check
 * fires from this dashboard.
 *
 * Two state-sync paths run side-by-side:
 *
 * 1. **Optimistic**: the event listener bumps `used` to whatever the
 *    /api/check response said. Latency: ~0ms — the event fires
 *    synchronously in the same client tick the response is parsed.
 *
 * 2. **Server-authoritative**: `router.refresh()` from ExplainClient
 *    re-renders the dashboard Server Component, which feeds new
 *    `initialUsed` / `initialQuota` props down. The `useEffect` on
 *    `[initialUsed, initialQuota]` re-syncs the local state. Latency:
 *    ~200ms — but the value is the truth from the DB, so it overwrites
 *    cleanly. (Same value if optimistic was correct; corrects any drift
 *    if not.)
 *
 * This pattern (optimistic + sync-from-props) is the cheapest path to
 * snappy UX without a full client-state refactor.
 */

import { useEffect, useState } from "react";
import { currentMonth } from "@/lib/quotas";
import {
  CHECK_COMPLETED_EVENT,
  isCheckCompletedEvent,
} from "./dashboard-check-events";

type UsageTone = "ok" | "warn" | "exhausted";

const USAGE_WARN_THRESHOLD = 0.8;

// Same logic as page.tsx::nextMonthReset — kept inline here so this
// Client Component stays self-contained.
function nextMonthReset(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return next.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function classifyTone(used: number, quota: number): UsageTone {
  if (used >= quota) return "exhausted";
  if (used >= quota * USAGE_WARN_THRESHOLD) return "warn";
  return "ok";
}

export function UsagePanelLive({
  initialUsed,
  initialQuota,
}: {
  initialUsed: number;
  initialQuota: number;
}) {
  const [used, setUsed] = useState(initialUsed);
  const [quota, setQuota] = useState(initialQuota);

  // Sync from server props (router.refresh path). Runs after every
  // server re-render that produces new prop values; idempotent when
  // the optimistic state already matches.
  useEffect(() => {
    setUsed(initialUsed);
    setQuota(initialQuota);
  }, [initialUsed, initialQuota]);

  // Listen for optimistic updates from sibling check forms.
  useEffect(() => {
    function handler(event: Event) {
      if (!isCheckCompletedEvent(event)) return;
      // Take the maximum of optimistic-received vs current — covers the
      // (rare) case where router.refresh raced ahead of the event.
      setUsed((prev) => Math.max(prev, event.detail.usage.used));
      setQuota(event.detail.usage.quota);
    }
    window.addEventListener(CHECK_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(CHECK_COMPLETED_EVENT, handler);
  }, []);

  const usedPct =
    quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const tone = classifyTone(used, quota);

  const barClasses: Record<UsageTone, string> = {
    ok: "bg-black dark:bg-white",
    warn: "bg-amber-500",
    exhausted: "bg-rose-500",
  };

  return (
    <section className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Usage this month</h2>
        <span className="text-xs text-stone-500 dark:text-stone-300">
          {currentMonth()}
        </span>
      </header>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-3xl font-semibold tabular-nums">
          {used.toLocaleString()}
        </span>
        <span className="text-sm text-stone-500 dark:text-stone-300">
          of {quota.toLocaleString()} checks
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-900">
        <div
          className={`h-full transition-[width] duration-300 ${barClasses[tone]}`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-stone-500 dark:text-stone-300">
        Resets {nextMonthReset()}.
      </p>
      {tone === "warn" && (
        <p className="mt-2 text-xs text-stone-900 dark:text-stone-100">
          You&apos;re close to your monthly limit. Upgrade to keep
          checking before {nextMonthReset()}.
        </p>
      )}
      {tone === "exhausted" && (
        <p className="mt-2 text-xs text-stone-900 dark:text-stone-100">
          You&apos;ve run out of free content checks. Upgrade to keep
          checking.
        </p>
      )}
    </section>
  );
}
