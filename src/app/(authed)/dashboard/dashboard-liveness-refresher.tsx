"use client";

/**
 * Polls Server Components on this route by calling router.refresh() on
 * a regular interval. External surfaces (MCP, Figma plugin, CLI,
 * GitHub Action, LSP) write violations rows that the dashboard reads,
 * but Server Components don't auto-refetch — without this poll the
 * user has to manually refresh to see external activity.
 *
 * Visibility-aware: pauses while the tab is hidden
 * (document.visibilityState !== "visible") so background tabs don't
 * burn bandwidth or generate load. Resumes immediately on tab focus.
 *
 * Default 5s interval; pass `intervalMs={0}` to disable. The component
 * renders nothing — it's pure side effect.
 *
 * The dashboard's existing tag-based cache (unstable_cache +
 * revalidateDashboard) means the cost of a refresh is usually a cache
 * hit; the actual DB queries only re-run when /api/check has called
 * revalidatePath since the last poll.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function DashboardLivenessRefresher({
  intervalMs = 5000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (intervalMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        router.refresh();
      }, intervalMs);
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Refresh once on regaining focus so a user who came back
        // after a long absence sees current data without waiting for
        // the next interval tick.
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, router]);

  return null;
}
