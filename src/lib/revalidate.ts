/**
 * Cache-invalidation helper for write routes that affect dashboard
 * display. Two layers, busted together when the caller supplies the
 * appropriate scope:
 *
 *   1. **Path-level** — `revalidatePath("/dashboard", "layout")`
 *      invalidates every route nested under the dashboard layout
 *      (/dashboard, /dashboard/runs/[id], /dashboard/overrides,
 *      /dashboard/members, /dashboard/team/*, /dashboard/explain).
 *      Catches sub-pages whose loaders aren't tag-cached (yet).
 *
 *   2. **Tag-level** (audit Pf3) — when the caller provides
 *      `userId`/`teamId`/`ownerId`, the matching `unstable_cache`
 *      tags (see `lib/cache-tags.ts`) get revalidated too. Without
 *      this layer, /dashboard root would read stale memoized values
 *      until the function-cache TTL expired.
 *
 * Both layers wrap individual try/catches: failures in one don't
 * cancel the other, and neither path-level nor tag-level revalidation
 * has a static-generation-store available in vitest. Cache
 * invalidation is best-effort.
 *
 * Usage:
 *   // Generic "something changed" — broad fallback, safe pre-Pf3.
 *   revalidateDashboard();
 *
 *   // Scoped: bust the cached loaders for one user / team / owner.
 *   revalidateDashboard({ userId: auth.user.id, teamId });
 */

import { revalidatePath } from "next/cache";
import {
  revalidateSubscription,
  revalidateUsage,
  revalidateViolations,
} from "./cache-tags";

export function revalidateDashboard(opts?: {
  userId?: string;
  teamId?: string;
  ownerId?: string;
}): void {
  try {
    revalidatePath("/dashboard", "layout");
  } catch (err) {
    console.warn("revalidateDashboard path-level failed (non-fatal):", err);
  }
  if (opts?.userId) revalidateUsage(opts.userId);
  if (opts?.teamId) revalidateViolations(opts.teamId);
  if (opts?.ownerId) revalidateSubscription(opts.ownerId);
}
