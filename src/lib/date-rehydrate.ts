/**
 * Date rehydration helpers for values that round-trip through
 * `unstable_cache` (or any other JSON-serialization layer).
 *
 * Why this exists: `unstable_cache` JSON-serializes its callback's
 * return value. Date instances become ISO strings on the wire; on a
 * cache hit, the cached payload comes back with strings where the
 * loader's TypeScript signature still says `Date`. Downstream code
 * that calls `.getTime()`, `.toISOString()`, `.toLocaleDateString()`,
 * etc. crashes at runtime with `TypeError: a.getTime is not a function`.
 *
 * The right place to fix this is at the cache boundary: every loader
 * that returns a Date field through `unstable_cache` must rehydrate
 * before returning. These helpers are the canonical way to do it so
 * the pattern is uniform, testable, and obvious in code review.
 *
 * Production incident this guards against:
 *   2026-04-28 16:40 UTC — TypeError: a.getTime is not a function
 *   on /dashboard. Triggered when the dashboard polling refresh
 *   (PR #220) cycled cached `loadSourceStats` results often enough
 *   that the cache-hit path's stringified Dates flowed through
 *   `formatRelative(lastAt).getTime()`.
 */

/**
 * Convert a value that should be a Date to a Date instance.
 *
 * - `Date` → returned unchanged.
 * - `string` → parsed via `new Date(string)`.
 * - `null` / `undefined` → `null`.
 *
 * Caller is responsible for distinguishing "never had a date" from
 * "the parsed string was an invalid date." `new Date("not a date")`
 * returns an Invalid Date (whose `.getTime()` returns `NaN` but does
 * not throw), so downstream code degrades gracefully rather than
 * crashing.
 */
export function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

/**
 * Walk a Record<string, T> and rehydrate one Date-typed field on each
 * value, returning a new object with the field replaced.
 *
 * Use case: `loadSourceStats` returns `Record<SurfaceKey, { count, lastAt }>`.
 * The cache layer stringifies each `lastAt`. This helper rebuilds the
 * record with `lastAt` as a real `Date | null`.
 *
 *   const activity = rehydrateMappedDates(cached.activity, "lastAt");
 *
 * Implementation note: returns a new object (does not mutate). The
 * surface signature returns `Record<string, T>` rather than
 * `typeof input` because TypeScript can't statically guarantee the
 * field assignment without a more elaborate generic dance. Callers
 * cast the return to their concrete record type at the boundary.
 */
export function rehydrateMappedDates<
  T extends Record<string, unknown>,
  K extends keyof T,
>(map: Record<string, T>, dateKey: K): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = {
      ...value,
      [dateKey]: asDate(value[dateKey] as Date | string | null | undefined),
    } as T;
  }
  return out;
}
