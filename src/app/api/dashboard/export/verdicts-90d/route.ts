/**
 * GET /api/dashboard/export/verdicts-90d — last-90-days verdicts JSON.
 *
 * Field-whitelisted. Includes only the metadata we persist about each
 * check: when it ran, on which surface, what severity, what content
 * type, and (for CI runs) which file. Deliberately does NOT include
 * standardId or rationaleChain — those are engine-emitted substrate
 * per ADR 2026-04-25, not user data.
 *
 * Note: the engine evaluates user text in flight but only persists
 * `text_hash` (sha256) to the violations table — never the raw text
 * or the issue/suggestion text. So the export is metadata only. This
 * is by design (no PII storage); calling it out here so future
 * "where's the issue text?" questions have a documented answer.
 */

import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  exportFilename,
  jsonExportResponse,
  requireExportAuth,
} from "@/lib/export";

export const dynamic = "force-dynamic";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET() {
  const authOrRes = await requireExportAuth();
  if (authOrRes instanceof Response) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const since = new Date(Date.now() - NINETY_DAYS_MS);

  const db = getDb();
  const rows = await db
    .select({
      createdAt: schema.violations.createdAt,
      moment: schema.violations.moment,
      contentType: schema.violations.contentType,
      severity: schema.violations.severity,
      source: schema.violations.source,
      filePath: schema.violations.filePath,
    })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamOwnerUserId),
        gte(schema.violations.createdAt, since),
      ),
    );

  return jsonExportResponse(exportFilename("verdicts-90d", "json"), {
    schema_version: "1.0.0",
    exported_at: new Date().toISOString(),
    team_id: teamOwnerUserId,
    window_days: 90,
    count: rows.length,
    note: "Metadata only. ContentRX never stores raw user text or evaluator outputs (issue / suggestion / confidence): only sha256 hashes, severity, and routing context. See /ethics for the storage policy.",
    verdicts: rows,
  });
}
