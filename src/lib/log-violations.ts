/**
 * Persist every evaluated check as zero or more violations rows.
 *
 * Privacy-critical: we NEVER store the plaintext string. Only sha256(text)
 * is written. That hash is enough to dedupe and see "this string was checked
 * and failed 4 times this week" in team analytics (Session 17) without
 * leaking user copy into our DB.
 */

import { createId } from "@paralleldrive/cuid2";
import { createHash } from "node:crypto";
import { getDb, schema } from "@/db";

type ViolationSource = "plugin" | "cli" | "action" | "ditto" | "lsp" | "mcp";

type LoggableViolation = {
  standard_id?: string;
  severity?: string;
};

type LogParams = {
  userId: string;
  teamId: string | null;
  source: ViolationSource;
  contentType: string;
  moment: string | null;
  text: string;
  violations: LoggableViolation[];
  // Set only for CI-origin checks (GitHub Action). Left null for
  // plugin/CLI calls where the string has no file context.
  filePath?: string | null;
  // Session 34: the engine's CheckResult.review_reason (one of the
  // Session 2/13 subtypes) when the whole evaluation was flagged for
  // review. Denormalised onto every violation row produced by the
  // same check so `/api/admin/refinement-signals` can cluster without
  // a separate `check_events` table.
  reviewReasonSubtype?: string | null;
};

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function logViolations(params: LogParams): Promise<number> {
  if (params.violations.length === 0) return 0;

  const textHash = hashText(params.text);
  // One check-event id per call — groups all violation rows from the
  // same /api/check invocation so the refinement-signals endpoint can
  // reconstruct co-firing and standards_conflict clusters.
  const checkEventId = createId();

  const rows = params.violations
    .filter((v) => typeof v.standard_id === "string" && v.standard_id.length > 0)
    .map((v) => ({
      userId: params.userId,
      teamId: params.teamId,
      contentType: params.contentType,
      moment: params.moment,
      standardId: v.standard_id as string,
      severity: v.severity ?? "unknown",
      textHash,
      source: params.source,
      filePath: params.filePath ?? null,
      checkEventId,
      reviewReasonSubtype: params.reviewReasonSubtype ?? null,
    }));

  if (rows.length === 0) return 0;

  const db = getDb();
  await db.insert(schema.violations).values(rows);
  return rows.length;
}
