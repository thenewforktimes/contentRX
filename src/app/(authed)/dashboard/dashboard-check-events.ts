/**
 * Tiny event bus for "a check just completed from the dashboard."
 *
 * Why not React Context: the page itself is a Server Component, so
 * threading a Context through the dashboard would require restructuring
 * the entire tree into a Client Component shell. Window events are the
 * lightest possible cross-component channel for this case — no
 * dependencies, no provider wrapper, sibling Client Components subscribe
 * independently.
 *
 * The pattern: ExplainClient (the dashboard's Try-a-check form) dispatches
 * cx-check-completed with the response data after a successful check.
 * Sibling panels (UsagePanelLive, ActiveSurfacesRowLive) listen and update
 * their local optimistic state immediately — eliminating the ~200ms lag
 * waiting for router.refresh() to round-trip new server-rendered HTML.
 *
 * router.refresh() still fires after dispatch; it eventually overwrites
 * the optimistic state with server-authoritative values. Optimistic
 * values are always "use the most recent" — for a counter that only
 * increments, that's correct.
 */

export const CHECK_COMPLETED_EVENT = "cx-check-completed";

/**
 * What the dashboard's Try-a-check form ships in the event detail when
 * a /api/check call returns successfully.
 */
export type CheckCompletedDetail = {
  /** Source tag of the check that just completed. */
  source: "dashboard";
  /** Fresh usage snapshot from the /api/check response. */
  usage: {
    used: number;
    quota: number;
    remaining: number;
  };
};

/**
 * Type guard for the event detail. Window events are typed as `Event`
 * by the DOM; this narrows.
 */
export function isCheckCompletedEvent(
  event: Event,
): event is CustomEvent<CheckCompletedDetail> {
  if (event.type !== CHECK_COMPLETED_EVENT) return false;
  if (!("detail" in event)) return false;
  const d = (event as CustomEvent).detail as Partial<CheckCompletedDetail>;
  return (
    typeof d?.source === "string" &&
    typeof d?.usage?.used === "number" &&
    typeof d?.usage?.quota === "number"
  );
}

/** Dispatch helper so callers don't have to construct the event by hand. */
export function dispatchCheckCompleted(detail: CheckCompletedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CheckCompletedDetail>(CHECK_COMPLETED_EVENT, { detail }),
  );
}
