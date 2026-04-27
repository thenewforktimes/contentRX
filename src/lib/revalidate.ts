/**
 * Cache-invalidation helper for write routes that affect dashboard
 * display. Centralizes the `revalidatePath("/dashboard", "layout")`
 * call so every write path uses the same shape — single source of
 * truth for the pattern, single place to change if we ever switch
 * to a different invalidation strategy (Redis pubsub, on-demand
 * ISR, etc.).
 *
 * The "layout" arg invalidates every route nested under the
 * dashboard layout — `/dashboard`, `/dashboard/runs/[id]`,
 * `/dashboard/overrides`, `/dashboard/members`, `/dashboard/team/*`,
 * `/dashboard/calibrate`, `/dashboard/explain`. One call covers all
 * the pages that might be displaying data the write just changed.
 *
 * Wrapped in try/catch because `revalidatePath` requires Next's
 * static-generation-store context which vitest doesn't supply (and
 * which can theoretically fail at runtime under transient Vercel
 * conditions). Cache invalidation is best-effort: a failure should
 * never break the write request, the dashboard catches up on the
 * next natural refresh.
 *
 * Usage:
 *   import { revalidateDashboard } from "@/lib/revalidate";
 *   // ... after a successful DB write that affects dashboard data ...
 *   revalidateDashboard();
 */

import { revalidatePath } from "next/cache";

export function revalidateDashboard(): void {
  try {
    revalidatePath("/dashboard", "layout");
  } catch (err) {
    console.warn("revalidateDashboard failed (non-fatal):", err);
  }
}
