/**
 * Session aggregation — human-eval build plan Session 4.
 *
 * When a user pushes back on the same standard N+ times inside one
 * session (Figma scan, CI run, dashboard tab), collapse those rows
 * into a single `standard_pushback` event for the review queue. The
 * raw rows are preserved for drill-down; the queue just shows one
 * item to investigate instead of N similar items.
 *
 * "Session" is whatever the client supplies via `session_id`. Rows
 * without a `session_id` fall back to a (user_id, 10-minute-window)
 * pseudo-session so legacy traffic still aggregates sensibly.
 */

export const DEFAULT_PUSHBACK_THRESHOLD = 3;

/** Fallback pseudo-session window when no `session_id` was supplied. */
export const FALLBACK_SESSION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export interface OverrideRow {
  id: string;
  // Nullable as of audit H-08: a Clerk user.deleted event sets userId
  // to null on the violation_overrides row (anonymized retention).
  // Aggregations either skip null-userId rows or treat them as their
  // own pseudo-session.
  userId: string | null;
  standardId: string;
  sessionId: string | null;
  createdAt: Date | string;
}

export interface StandardPushback<Row extends OverrideRow = OverrideRow> {
  /** Stable key per pushback group: `${sessionKey}|${standardId}`. */
  key: string;
  standardId: string;
  /** The original session_id, or `pseudo:<userId>:<bucket>` for fallback. */
  sessionKey: string;
  /** All raw rows that fed this pushback, chronologically ordered. */
  rows: Row[];
  count: number;
  /** Timestamp of the first row in the group (review queue sort key). */
  firstAt: Date;
  /** Timestamp of the last row in the group. */
  lastAt: Date;
}

export interface AggregationResult<Row extends OverrideRow = OverrideRow> {
  /** Rows that cleared the threshold and collapsed into pushbacks. */
  pushbacks: StandardPushback<Row>[];
  /** Rows that did NOT cross the threshold — pass through as-is. */
  singletons: Row[];
}

/**
 * Bucket a `createdAt` timestamp into a 10-minute window key so rows
 * without a `session_id` still cluster sensibly. Same window ⇒ same
 * pseudo-session for the same user.
 */
function pseudoSessionKey(row: OverrideRow): string {
  const ts =
    row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : new Date(row.createdAt).getTime();
  const bucket = Math.floor(ts / FALLBACK_SESSION_WINDOW_MS);
  return `pseudo:${row.userId}:${bucket}`;
}

/**
 * Session key for grouping. Uses the real `session_id` when present,
 * falls back to the pseudo-session bucket otherwise.
 */
export function sessionKeyForRow(row: OverrideRow): string {
  return row.sessionId ?? pseudoSessionKey(row);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Group override rows into per-session, per-standard buckets and emit
 * `StandardPushback` entries for buckets that cross the threshold.
 * Rows below the threshold are returned as singletons so the caller
 * can render them inline.
 *
 * Pure function — no side effects. Same inputs always produce the
 * same output.
 */
export function aggregateOverrides<Row extends OverrideRow>(
  rows: Row[],
  threshold: number = DEFAULT_PUSHBACK_THRESHOLD,
): AggregationResult<Row> {
  const buckets = new Map<string, Row[]>();

  for (const row of rows) {
    const sKey = sessionKeyForRow(row);
    const key = `${sKey}|${row.standardId}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  const pushbacks: StandardPushback<Row>[] = [];
  const singletons: Row[] = [];

  for (const [key, groupRows] of buckets) {
    if (groupRows.length >= threshold) {
      const sorted = [...groupRows].sort(
        (a, b) => toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime(),
      );
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      pushbacks.push({
        key,
        standardId: first.standardId,
        sessionKey: sessionKeyForRow(first),
        rows: sorted,
        count: sorted.length,
        firstAt: toDate(first.createdAt),
        lastAt: toDate(last.createdAt),
      });
    } else {
      for (const row of groupRows) singletons.push(row);
    }
  }

  // Stable, newest-first ordering for the review queue.
  pushbacks.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  singletons.sort(
    (a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime(),
  );

  return { pushbacks, singletons };
}
