/**
 * GET /api/dashboard/export/team-rules — team_rules JSON export.
 *
 * Field-whitelisted at the query level. Returns the team's own
 * rule customizations (which standards they disabled or overrode).
 * The standardId is the user's own data — they explicitly created
 * these rules referencing standards by id — so it's part of the
 * portability contract.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  exportFilename,
  jsonExportResponse,
  requireExportAuth,
} from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const authOrRes = await requireExportAuth();
  if (authOrRes instanceof Response) return authOrRes;
  const { teamOwnerUserId } = authOrRes;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.teamRules.id,
      standardId: schema.teamRules.standardId,
      action: schema.teamRules.action,
      ruleJson: schema.teamRules.ruleJson,
      createdAt: schema.teamRules.createdAt,
      updatedAt: schema.teamRules.updatedAt,
    })
    .from(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, teamOwnerUserId));

  return jsonExportResponse(exportFilename("team-rules", "json"), {
    schema_version: "1.0.0",
    exported_at: new Date().toISOString(),
    team_id: teamOwnerUserId,
    count: rows.length,
    rules: rows,
  });
}
