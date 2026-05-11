/**
 * `/admin/suggestions` — suggestion calibration triage queue.
 *
 * Block 2b of the calibration plan. Reads pending rows from
 * `suggestion_candidates`, groups them by `(moment, content_type,
 * standard_id)` cluster, and offers Approve / Reject actions on
 * each cluster. Approve promotes the cluster to a single
 * `suggestion_precedents` row that the runtime LLM scan prompt
 * will read at request time (Block 2c).
 *
 * Daily-rhythm UX: Robert reviews a cluster, picks the best
 * candidate text (or edits it), clicks Approve. Sample size on
 * the precedent aggregates the cluster count so retrieval can
 * rank by approval frequency. High-noise clusters get Reject;
 * the rejection rate per bucket flags cells where the LLM is
 * producing slop (informs Block 2c's skip-on-high-confidence
 * gate or, downstream, refinement-log priorities).
 *
 * Auth: founder-only via the `/admin/layout.tsx` gate.
 *
 * Substrate boundary (ADR 2026-04-25): this page is internal
 * to /admin and renders substrate fields (standard_id, etc.)
 * directly. Customers never see this surface.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { humanizeContentType, humanizeMoment } from "@/lib/humanize";
import { TriageCluster } from "./triage-cluster";

export const metadata = {
  title: "Suggestion calibration · ContentRX admin",
  robots: { index: false, follow: false },
};

const MAX_CLUSTERS = 30;
const MAX_CANDIDATES_PER_CLUSTER = 20;

interface PendingCandidate {
  id: string;
  candidateText: string | null;
  issueContext: string | null;
  source: string;
  createdAt: Date;
}

interface ClusterRow {
  moment: string | null;
  contentType: string | null;
  standardId: string | null;
  candidateCount: number;
  candidates: PendingCandidate[];
}

export default async function AdminSuggestionsPage() {
  const db = getDb();

  // Pending candidates. Every row is visible to the founder /admin
  // queue; the earlier `share_upstream` two-tier opt-in was retired by
  // ADR 2026-05-11 (Flag-for-Review now owns the explicit-consent path
  // for customer-input-into-substrate).
  const pendingRows = await db
    .select({
      id: schema.suggestionCandidates.id,
      moment: schema.suggestionCandidates.moment,
      contentType: schema.suggestionCandidates.contentType,
      standardId: schema.suggestionCandidates.standardId,
      candidateText: schema.suggestionCandidates.candidateText,
      issueContext: schema.suggestionCandidates.issueContext,
      source: schema.suggestionCandidates.source,
      createdAt: schema.suggestionCandidates.createdAt,
    })
    .from(schema.suggestionCandidates)
    .where(eq(schema.suggestionCandidates.status, "pending"))
    .orderBy(desc(schema.suggestionCandidates.createdAt))
    .limit(500);

  // Group by (moment, content_type, standard_id). Null bucket axes
  // form their own "uncategorized" cluster — Robert assigns the
  // bucket on triage by editing the precedent fields.
  const clusterMap = new Map<string, ClusterRow>();
  for (const row of pendingRows) {
    const key = `${row.moment ?? ""}|${row.contentType ?? ""}|${row.standardId ?? ""}`;
    let cluster = clusterMap.get(key);
    if (!cluster) {
      cluster = {
        moment: row.moment,
        contentType: row.contentType,
        standardId: row.standardId,
        candidateCount: 0,
        candidates: [],
      };
      clusterMap.set(key, cluster);
    }
    cluster.candidateCount += 1;
    if (cluster.candidates.length < MAX_CANDIDATES_PER_CLUSTER) {
      cluster.candidates.push({
        id: row.id,
        candidateText: row.candidateText,
        issueContext: row.issueContext,
        source: row.source,
        createdAt: row.createdAt,
      });
    }
  }

  const clusters = Array.from(clusterMap.values())
    .sort((a, b) => b.candidateCount - a.candidateCount)
    .slice(0, MAX_CLUSTERS);

  // Recent precedents stream for context.
  const recentPrecedents = await db
    .select({
      id: schema.suggestionPrecedents.id,
      moment: schema.suggestionPrecedents.moment,
      contentType: schema.suggestionPrecedents.contentType,
      standardId: schema.suggestionPrecedents.standardId,
      approvedText: schema.suggestionPrecedents.approvedText,
      sampleSize: schema.suggestionPrecedents.sampleSize,
      approvedAt: schema.suggestionPrecedents.approvedAt,
    })
    .from(schema.suggestionPrecedents)
    .orderBy(desc(schema.suggestionPrecedents.approvedAt))
    .limit(10);

  // Total counts for the header.
  const [{ totalPending }] = await db
    .select({
      totalPending: sql<number>`count(*)::int`,
    })
    .from(schema.suggestionCandidates)
    .where(eq(schema.suggestionCandidates.status, "pending"));

  const [{ totalPrecedents }] = await db
    .select({
      totalPrecedents: sql<number>`count(*)::int`,
    })
    .from(schema.suggestionPrecedents);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-strong">
          Suggestion calibration
        </h1>
        <p className="mt-2 text-sm text-quiet">
          Customer rewrites that opted into upstream sharing. Approve to
          promote the cluster to a single precedent the runtime scan
          prompt reads. Reject for slop.
        </p>
        <p className="mt-2 text-xs text-quiet">
          {totalPending} pending candidate{totalPending === 1 ? "" : "s"}{" "}
          across {clusters.length} cluster{clusters.length === 1 ? "" : "s"}
          {" · "}
          {totalPrecedents} precedent{totalPrecedents === 1 ? "" : "s"}{" "}
          live.
        </p>
      </header>

      {clusters.length === 0 ? (
        <section className="rounded-md border border-line bg-overlay p-6 text-sm text-default">
          No pending candidates. The queue fills as customers tick
          &ldquo;Help calibrate the ContentRX model&rdquo; on the
          dashboard&apos;s Adjust modal.
        </section>
      ) : (
        <section className="space-y-4">
          {clusters.map((cluster) => (
            <TriageCluster
              key={`${cluster.moment ?? ""}|${cluster.contentType ?? ""}|${cluster.standardId ?? ""}`}
              moment={cluster.moment}
              contentType={cluster.contentType}
              standardId={cluster.standardId}
              candidateCount={cluster.candidateCount}
              candidates={cluster.candidates.map((c) => ({
                id: c.id,
                candidateText: c.candidateText ?? "",
                issueContext: c.issueContext ?? "",
                source: c.source,
                createdAt: c.createdAt.toISOString(),
              }))}
              momentLabel={cluster.moment ? humanizeMoment(cluster.moment) : "—"}
              contentTypeLabel={
                cluster.contentType
                  ? humanizeContentType(cluster.contentType)
                  : "—"
              }
            />
          ))}
        </section>
      )}

      {recentPrecedents.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-quiet">
            Recent precedents
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {recentPrecedents.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-line bg-raised px-3 py-2"
              >
                <p className="text-xs text-quiet">
                  {humanizeMoment(p.moment)} ·{" "}
                  {humanizeContentType(p.contentType)} ·{" "}
                  <code className="font-mono">{p.standardId}</code> · ×
                  {p.sampleSize}
                </p>
                <p className="mt-1 text-strong">
                  {p.approvedText}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
