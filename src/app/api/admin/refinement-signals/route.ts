/**
 * GET /api/admin/refinement-signals — nightly signal dump for the
 *                                     refinement-candidate detector.
 *
 * Human-eval build plan Session 34 activation. Emits a `SignalDump`
 * JSON matching the shape consumed by
 * `tools/refinement_candidate_detector.py`.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Same tier as
 * `/api/cron/weekly-digest` and `/api/preferences/export`. Never
 * exposed to browser clients — the detector runs in a GitHub Action
 * cron with the secret injected.
 *
 * Shape (mirror of `tools/refinement_candidate_detector.py`):
 *   {
 *     generated_at: ISO 8601,
 *     standards: StandardSignal[],
 *     override_clusters: OverrideCluster[],
 *     ood_clusters: OODCluster[],
 *     conflict_clusters: ConflictCluster[],
 *     standard_first_seen: { [standard_id]: ISO 8601 }
 *   }
 *
 * Privacy: returns only hashed text (sha256 `textHash`), never
 * plaintext. Admin endpoint + cron-only access keeps team-level user-
 * hash aggregation inside the ops boundary.
 *
 * Implementation: the SQL reads three separate windows (violations
 * 90d, overrides 30d, review-tagged violations 60d) in parallel and
 * hands the rows to `buildSignalDump` for pure-logic aggregation.
 * All statistics live in `src/lib/refinement-signals.ts`; this route
 * just does I/O.
 */

import { NextResponse } from "next/server";
import { gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildSignalDump } from "@/lib/refinement-signals";
import { requireEnv } from "@/lib/require-env";

const DAY_MS = 24 * 60 * 60 * 1000;

function requireCronAuth(req: Request): NextResponse | null {
  const expected = requireEnv("CRON_SECRET");
  const got = req.headers.get("authorization");
  if (got !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const now = new Date();
  const ninety = new Date(now.getTime() - 90 * DAY_MS);
  const sixty = new Date(now.getTime() - 60 * DAY_MS);
  const thirty = new Date(now.getTime() - 30 * DAY_MS);

  const db = getDb();

  // 90-day violations — feeds per-standard fire counts.
  const violations90d = await db
    .select({
      checkEventId: schema.violations.checkEventId,
      standardId: schema.violations.standardId,
      moment: schema.violations.moment,
      contentType: schema.violations.contentType,
      textHash: schema.violations.textHash,
      source: schema.violations.source,
      reviewReasonSubtype: schema.violations.reviewReasonSubtype,
      createdAt: schema.violations.createdAt,
    })
    .from(schema.violations)
    .where(gte(schema.violations.createdAt, ninety));

  // 30-day overrides — feeds override clusters + per-standard
  // overrides_30d counts.
  const overrides30d = await db
    .select({
      standardId: schema.violationOverrides.standardId,
      overrideReasonCode: schema.violationOverrides.overrideReasonCode,
      userId: schema.violationOverrides.userId,
      actorRole: schema.violationOverrides.actorRole,
      textHash: schema.violationOverrides.textHash,
      createdAt: schema.violationOverrides.createdAt,
    })
    .from(schema.violationOverrides)
    .where(gte(schema.violationOverrides.createdAt, thirty));

  // 60-day review-tagged violations — feeds OOD + conflict clusters.
  // Not filtering on reviewReasonSubtype at SQL layer; the aggregator
  // handles that, and the shape is small enough (`violations_subtype_created_idx`
  // narrows it).
  const reviewViolations60d = await db
    .select({
      checkEventId: schema.violations.checkEventId,
      standardId: schema.violations.standardId,
      moment: schema.violations.moment,
      contentType: schema.violations.contentType,
      textHash: schema.violations.textHash,
      source: schema.violations.source,
      reviewReasonSubtype: schema.violations.reviewReasonSubtype,
      createdAt: schema.violations.createdAt,
    })
    .from(schema.violations)
    .where(gte(schema.violations.createdAt, sixty));

  const dump = buildSignalDump({
    now,
    violations90d: violations90d as Array<{
      checkEventId: string | null;
      standardId: string;
      moment: string | null;
      contentType: string;
      textHash: string;
      source: string;
      reviewReasonSubtype: string | null;
      createdAt: Date;
    }>,
    overrides30d: overrides30d.map((o) => ({
      standardId: o.standardId,
      overrideReasonCode: o.overrideReasonCode,
      userId: o.userId,
      actorRole: o.actorRole,
      textHash: o.textHash,
      createdAt: o.createdAt,
    })),
    reviewViolations60d: reviewViolations60d.filter(
      (v) => v.reviewReasonSubtype !== null,
    ) as Array<{
      checkEventId: string | null;
      standardId: string;
      moment: string | null;
      contentType: string;
      textHash: string;
      source: string;
      reviewReasonSubtype: string | null;
      createdAt: Date;
    }>,
  });

  return NextResponse.json(dump, {
    headers: { "Cache-Control": "private, max-age=0, no-cache" },
  });
}
