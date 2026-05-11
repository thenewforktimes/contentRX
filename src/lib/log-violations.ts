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

type ViolationSource =
  | "dashboard"
  | "plugin"
  | "cli"
  | "action"
  | "ditto"
  | "lsp"
  | "mcp";

type LoggableViolation = {
  standard_id?: string;
  severity?: string;
  // 2026-05-10 dashboard round 2: the public-envelope issue +
  // suggestion text. Persisted so /dashboard/checks can render each
  // finding's content alongside its metadata. Optional on the input
  // shape because pre-migration callers may not supply them.
  issue?: string;
  suggestion?: string;
  // 2026-05-10 detail-page round 3 — schema 2.5.0 customer-facing
  // category. The detail page renders it as a finding-level chip so
  // the customer sees "Voice & tone" instead of guessing from the
  // issue text.
  category?: string;
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
  // PR-40: groups violations by external run. The GitHub Action sets
  // this to GITHUB_RUN_ID so /dashboard/runs/<run_id> can render a
  // single page covering every string checked in that workflow run.
  // Null for inline / LSP / CLI / plugin calls.
  runId?: string | null;
  // Optional: id to write into `check_event_id`. When the caller
  // also passes the same id as `recordUsageEvent({ id })` it makes
  // `violations.check_event_id` ↔ `usage_events.id` joinable,
  // unlocking the run audit page's text_preview render. /api/check
  // supplies one. When omitted, logViolations generates its own —
  // preserves /admin refinement-signal clustering for callers that
  // don't need the join.
  checkEventId?: string;
};

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function logViolations(params: LogParams): Promise<number> {
  if (params.violations.length === 0) return 0;

  const textHash = hashText(params.text);
  // One check-event id per call — groups all violation rows from the
  // same /api/check invocation so the refinement-signals endpoint
  // can reconstruct co-firing and standards_conflict clusters AND so
  // the run audit page can join `violations.check_event_id ↔
  // usage_events.id`. The caller (currently /api/check) supplies the
  // id when it wants the join to work; otherwise we mint a fresh one.
  const checkEventId = params.checkEventId ?? createId();

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
      runId: params.runId ?? null,
      issue: v.issue ?? null,
      suggestion: v.suggestion ?? null,
      category: v.category ?? null,
    }));

  if (rows.length === 0) return 0;

  const db = getDb();
  await db.insert(schema.violations).values(rows);
  return rows.length;
}
