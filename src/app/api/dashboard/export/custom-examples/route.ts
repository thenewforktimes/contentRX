/**
 * GET /api/dashboard/export/custom-examples — custom_examples JSON.
 *
 * Field-whitelisted. Returns every custom example the team added,
 * including the verdict and any context filters they tagged it with
 * (moment, content_type, standard_id). All of those are user-supplied
 * via MCP/CLI ingestion and are part of the portability contract.
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
      id: schema.teamCustomExamples.id,
      text: schema.teamCustomExamples.text,
      verdict: schema.teamCustomExamples.verdict,
      moment: schema.teamCustomExamples.moment,
      contentType: schema.teamCustomExamples.contentType,
      standardId: schema.teamCustomExamples.standardId,
      notes: schema.teamCustomExamples.notes,
      contributeUpstream: schema.teamCustomExamples.contributeUpstream,
      createdAt: schema.teamCustomExamples.createdAt,
    })
    .from(schema.teamCustomExamples)
    .where(eq(schema.teamCustomExamples.teamOwnerUserId, teamOwnerUserId));

  return jsonExportResponse(exportFilename("custom-examples", "json"), {
    schema_version: "1.0.0",
    exported_at: new Date().toISOString(),
    team_id: teamOwnerUserId,
    count: rows.length,
    examples: rows,
  });
}
