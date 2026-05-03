/**
 * `/admin/calibration/coverage` — suggestion-calibration coverage matrix.
 *
 * Block 3b of the calibration plan. Surfaces:
 *
 *   - Total precedents live + total pending candidates awaiting
 *     triage. The headline numbers Robert checks daily.
 *
 *   - Active buckets: every (moment, content_type) cell that has
 *     EITHER precedents OR pending candidates. Sorted by total
 *     activity DESC so the highest-leverage cells surface first.
 *     Each row shows precedent count, pending-candidate count, and
 *     a quick link to the /admin/suggestions queue scoped to that
 *     bucket (when the queue link routing lands).
 *
 *   - Coverage gap: moments + content_types with zero activity in
 *     either table. The 13 moments × 8 content_types grid has 104
 *     cells; rendering the full matrix is a wall of dashes that
 *     hides the actionable signal. Better to surface gaps as a
 *     compact list of "moments with zero precedents."
 *
 * Bucket axes follow Block 2c's retrieval contract: (moment,
 * content_type) only, NOT standard_id. Per-standard breakdowns
 * become useful only once volume justifies the granularity; right
 * now coarse buckets are the right size for a daily review rhythm.
 *
 * Auth handled by `src/app/admin/layout.tsx` (founder-only, 404
 * for non-founders).
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CONTENT_TYPES, MOMENTS } from "@/lib/engine-taxonomy";
import {
  humanizeContentType,
  humanizeMoment,
} from "@/lib/humanize";

export const metadata = {
  title: "Coverage · ContentRX admin",
  robots: { index: false, follow: false },
};

interface BucketStats {
  moment: string | null;
  contentType: string | null;
  precedentCount: number;
  pendingCount: number;
  // Block 3c: slop-rejection signal. Per-bucket rejected vs merged
  // ratio. High reject rate on a cell means the LLM is producing
  // bad suggestions there — informs retrieval + prompt-engineering
  // priorities.
  mergedCount: number;
  rejectedCount: number;
}

export default async function CalibrationCoveragePage() {
  const db = getDb();

  // Per-bucket precedent counts.
  const precedentRows = await db
    .select({
      moment: schema.suggestionPrecedents.moment,
      contentType: schema.suggestionPrecedents.contentType,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.suggestionPrecedents)
    .groupBy(
      schema.suggestionPrecedents.moment,
      schema.suggestionPrecedents.contentType,
    );

  // Per-bucket pending candidate counts. Only share_upstream=true
  // candidates show up in /admin/suggestions, so coverage scopes
  // the same way — team-private candidates aren't Robert's queue.
  const pendingRows = await db
    .select({
      moment: schema.suggestionCandidates.moment,
      contentType: schema.suggestionCandidates.contentType,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.suggestionCandidates)
    .where(
      sql`${schema.suggestionCandidates.status} = 'pending' AND ${schema.suggestionCandidates.shareUpstream} = true`,
    )
    .groupBy(
      schema.suggestionCandidates.moment,
      schema.suggestionCandidates.contentType,
    );

  // Block 3c: per-bucket rejected + merged counts for the slop
  // rejection rate. Same share_upstream=true scope so the rate
  // reflects only the candidates Robert actually triaged.
  const reviewedRows = await db
    .select({
      moment: schema.suggestionCandidates.moment,
      contentType: schema.suggestionCandidates.contentType,
      status: schema.suggestionCandidates.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.suggestionCandidates)
    .where(
      sql`${schema.suggestionCandidates.status} IN ('rejected', 'merged') AND ${schema.suggestionCandidates.shareUpstream} = true`,
    )
    .groupBy(
      schema.suggestionCandidates.moment,
      schema.suggestionCandidates.contentType,
      schema.suggestionCandidates.status,
    );

  // Stitch into a single bucket map.
  const bucketMap = new Map<string, BucketStats>();
  function key(m: string | null, ct: string | null) {
    return `${m ?? ""}|${ct ?? ""}`;
  }
  function ensure(m: string | null, ct: string | null): BucketStats {
    const k = key(m, ct);
    let b = bucketMap.get(k);
    if (!b) {
      b = {
        moment: m,
        contentType: ct,
        precedentCount: 0,
        pendingCount: 0,
        mergedCount: 0,
        rejectedCount: 0,
      };
      bucketMap.set(k, b);
    }
    return b;
  }
  for (const r of precedentRows) {
    ensure(r.moment, r.contentType).precedentCount = Number(r.count);
  }
  for (const r of pendingRows) {
    ensure(r.moment, r.contentType).pendingCount = Number(r.count);
  }
  for (const r of reviewedRows) {
    const b = ensure(r.moment, r.contentType);
    if (r.status === "merged") b.mergedCount = Number(r.count);
    else if (r.status === "rejected") b.rejectedCount = Number(r.count);
  }

  const activeBuckets = Array.from(bucketMap.values())
    .filter(
      (b) =>
        b.precedentCount +
          b.pendingCount +
          b.mergedCount +
          b.rejectedCount >
        0,
    )
    .sort(
      (a, b) =>
        b.precedentCount +
        b.pendingCount -
        (a.precedentCount + a.pendingCount),
    );

  // Slop-rejection rate per bucket: rejected / (rejected + merged).
  // Only computed when total_reviewed > 0 to avoid div-by-zero on
  // brand-new buckets.
  function rejectRate(b: BucketStats): number | null {
    const total = b.rejectedCount + b.mergedCount;
    if (total === 0) return null;
    return b.rejectedCount / total;
  }

  // Moments with zero activity in any content type — the "needs
  // annotation" backlog at the moment-axis level. Same for content
  // types.
  const momentsWithActivity = new Set(
    activeBuckets.map((b) => b.moment).filter((m): m is string => Boolean(m)),
  );
  const contentTypesWithActivity = new Set(
    activeBuckets
      .map((b) => b.contentType)
      .filter((ct): ct is string => Boolean(ct)),
  );
  const uncoveredMoments = MOMENTS.filter(
    (m) => !momentsWithActivity.has(m),
  );
  const uncoveredContentTypes = CONTENT_TYPES.filter(
    (ct) => !contentTypesWithActivity.has(ct),
  );

  const totalPrecedents = activeBuckets.reduce(
    (acc, b) => acc + b.precedentCount,
    0,
  );
  const totalPending = activeBuckets.reduce(
    (acc, b) => acc + b.pendingCount,
    0,
  );
  const totalMerged = activeBuckets.reduce(
    (acc, b) => acc + b.mergedCount,
    0,
  );
  const totalRejected = activeBuckets.reduce(
    (acc, b) => acc + b.rejectedCount,
    0,
  );
  const overallRejectRate =
    totalRejected + totalMerged > 0
      ? totalRejected / (totalRejected + totalMerged)
      : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400">
          Calibration → Coverage
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Suggestion calibration coverage
        </h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          Precedents per bucket. Empty cells fall back to the
          universal voice rules at runtime; populated cells inject
          the approved precedent into the scan prompt.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <Stat
            label="Precedents live"
            value={totalPrecedents.toLocaleString()}
            tone="emerald"
          />
          <Stat
            label="Pending triage"
            value={totalPending.toLocaleString()}
            tone={totalPending > 0 ? "amber" : "stone"}
          />
          <Stat
            label="Slop reject rate"
            value={
              overallRejectRate === null
                ? "—"
                : `${Math.round(overallRejectRate * 100)}%`
            }
            tone={
              overallRejectRate === null
                ? "stone"
                : overallRejectRate >= 0.5
                  ? "red"
                  : overallRejectRate >= 0.25
                    ? "amber"
                    : "stone"
            }
          />
          <Link
            href="/admin/suggestions"
            className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
          >
            Open triage queue →
          </Link>
        </div>
      </header>

      <section className="mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          Active buckets
        </h2>
        {activeBuckets.length === 0 ? (
          <p className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
            No buckets have precedents or pending candidates yet. The
            queue fills as customers tick &ldquo;Help calibrate the
            ContentRX model&rdquo; on the dashboard&apos;s Adjust modal.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-800">
                <th className="px-2 py-2 text-left font-semibold text-stone-700 dark:text-stone-300">
                  Moment
                </th>
                <th className="px-2 py-2 text-left font-semibold text-stone-700 dark:text-stone-300">
                  Content type
                </th>
                <th className="px-2 py-2 text-right font-semibold text-stone-700 dark:text-stone-300">
                  Precedents
                </th>
                <th className="px-2 py-2 text-right font-semibold text-stone-700 dark:text-stone-300">
                  Pending
                </th>
                <th
                  className="px-2 py-2 text-right font-semibold text-stone-700 dark:text-stone-300"
                  title="Rejected ÷ (rejected + merged). High = LLM is producing slop in this bucket."
                >
                  Reject rate
                </th>
              </tr>
            </thead>
            <tbody>
              {activeBuckets.map((b) => (
                <tr
                  key={key(b.moment, b.contentType)}
                  className="border-b border-stone-100 dark:border-stone-900"
                >
                  <td className="px-2 py-2 text-stone-900 dark:text-stone-100">
                    {b.moment ? humanizeMoment(b.moment) : (
                      <span className="italic text-stone-500 dark:text-stone-400">
                        (uncategorized)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-stone-900 dark:text-stone-100">
                    {b.contentType ? humanizeContentType(b.contentType) : (
                      <span className="italic text-stone-500 dark:text-stone-400">
                        (uncategorized)
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {b.precedentCount > 0 ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                        {b.precedentCount}
                      </span>
                    ) : (
                      <span className="text-stone-400 dark:text-stone-500">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {b.pendingCount > 0 ? (
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        {b.pendingCount}
                      </span>
                    ) : (
                      <span className="text-stone-400 dark:text-stone-500">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <RejectRateCell
                      rate={rejectRate(b)}
                      rejected={b.rejectedCount}
                      merged={b.mergedCount}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {(uncoveredMoments.length > 0 || uncoveredContentTypes.length > 0) && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Coverage gap
          </h2>
          {uncoveredMoments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
                Moments with no precedents or pending candidates ({uncoveredMoments.length})
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {uncoveredMoments.map((m) => (
                  <li
                    key={m}
                    className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
                  >
                    {humanizeMoment(m)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {uncoveredContentTypes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
                Content types with no precedents or pending candidates ({uncoveredContentTypes.length})
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {uncoveredContentTypes.map((ct) => (
                  <li
                    key={ct}
                    className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
                  >
                    {humanizeContentType(ct)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "red" | "stone";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        : tone === "red"
          ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
          : "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300";
  return (
    <span
      className={`inline-flex items-baseline gap-2 rounded-md border px-3 py-1.5 ${toneClass}`}
    >
      <span className="text-xs font-medium uppercase tracking-wide opacity-80">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </span>
  );
}

/**
 * RejectRateCell — renders a per-bucket slop-rejection rate with
 * tone scaled by severity. The thresholds (≥50% red, ≥25% amber)
 * are tentative; once empirical baselines exist, the cutoffs can
 * tighten.
 */
function RejectRateCell({
  rate,
  rejected,
  merged,
}: {
  rate: number | null;
  rejected: number;
  merged: number;
}) {
  if (rate === null) {
    return (
      <span className="text-stone-400 dark:text-stone-500" title="No reviewed candidates yet">
        —
      </span>
    );
  }
  const pct = Math.round(rate * 100);
  const toneClass =
    rate >= 0.5
      ? "text-rose-700 dark:text-rose-300"
      : rate >= 0.25
        ? "text-amber-700 dark:text-amber-300"
        : "text-stone-700 dark:text-stone-300";
  return (
    <span
      className={`font-semibold ${toneClass}`}
      title={`${rejected} rejected of ${rejected + merged} reviewed`}
    >
      {pct}%
    </span>
  );
}
