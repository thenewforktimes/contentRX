/**
 * GET /api/dashboard/export/overrides — violation_overrides CSV.
 *
 * Field-whitelisted. Includes standardId because the user explicitly
 * acted on a finding referencing that standard (their override action
 * IS the data). Includes the behavior-quadrant signals (stance,
 * rationale-expanded, time-to-action) so an exported audit can be
 * re-analyzed externally.
 *
 * Excluded: textHash (the user can correlate by their own data if they
 * stored it; we don't surface our hashes to users). Excluded engine-
 * emitted fields: validate_rejection_reason, ambiguity_flag — these
 * aren't on violation_overrides today but flagging the principle in
 * case the schema grows.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  csvExportResponse,
  exportFilename,
  requireExportAuth,
  serializeCsv,
} from "@/lib/export";

export const dynamic = "force-dynamic";

const HEADERS = [
  "createdAt",
  "standardId",
  "moment",
  "overrideStance",
  "overrideType",
  "overrideReasonCode",
  "actorRole",
  "rationaleExpanded",
  "timeToActionMs",
  "source",
] as const;

export async function GET() {
  const authOrRes = await requireExportAuth();
  if (authOrRes instanceof Response) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const db = getDb();
  const rows = await db
    .select({
      createdAt: schema.violationOverrides.createdAt,
      standardId: schema.violationOverrides.standardId,
      moment: schema.violationOverrides.moment,
      overrideStance: schema.violationOverrides.overrideStance,
      overrideType: schema.violationOverrides.overrideType,
      overrideReasonCode: schema.violationOverrides.overrideReasonCode,
      actorRole: schema.violationOverrides.actorRole,
      rationaleExpanded: schema.violationOverrides.rationaleExpanded,
      timeToActionMs: schema.violationOverrides.timeToActionMs,
      source: schema.violationOverrides.source,
    })
    .from(schema.violationOverrides)
    .where(eq(schema.violationOverrides.teamId, teamOwnerUserId));

  const csv = serializeCsv(HEADERS, rows);
  return csvExportResponse(exportFilename("overrides", "csv"), csv);
}
