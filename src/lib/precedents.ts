/**
 * Precedent retrieval for the calibration loop.
 *
 * Block 2c of the calibration plan. Given a check's bucket axes
 * (moment, content_type), pull the top-N approved precedents that
 * the engine should use as voice guidance in the LLM scan prompt.
 *
 * Architecture call (MVP): retrieve by (moment, content_type) only,
 * NOT per-standard. The customer browser doesn't send standard_id
 * (substrate per ADR 2026-04-25), and the engine's filter stage
 * runs after this retrieval — so we don't yet know which standards
 * survive. Cross-standard retrieval gives the LLM voice signal for
 * the moment + content type, which is the primary axis. Per-standard
 * retrieval is a future refinement once we have empirical volume.
 *
 * Retrieval rules (from ADR §2):
 *   - Bucket lookup on (moment, content_type) — uses the
 *     suggestion_precedents_bucket_idx.
 *   - Top-3 by sample_size DESC, created_at DESC.
 *   - 500-char approved_text cap is enforced at insert time, so
 *     no need to re-truncate here.
 *
 * Returns an empty array when no precedents match. The engine's
 * scan prompt already carries universal voice rules (PR #252) as
 * the no-precedents fallback — retrieval-empty is a clean state.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

export interface Precedent {
  /** The curated suggestion text — what the LLM sees as a voice example. */
  approvedText: string;
  /** How many candidates merged into this precedent. Higher = stronger signal. */
  sampleSize: number;
}

export interface FetchPrecedentsParams {
  moment: string | null | undefined;
  contentType: string | null | undefined;
  /** Top-N cap. Default 3 per ADR §2. */
  limit?: number;
}

const DEFAULT_LIMIT = 3;

/**
 * Pull approved precedents matching the bucket. Empty array when
 * the bucket is missing axes or has no matching precedents.
 */
export async function fetchPrecedentsForCheck({
  moment,
  contentType,
  limit = DEFAULT_LIMIT,
}: FetchPrecedentsParams): Promise<Precedent[]> {
  // Without bucket axes the bucket index can't help — return empty
  // and let the engine fall back to the universal voice rules.
  if (!moment || !contentType) return [];

  const db = getDb();
  const rows = await db
    .select({
      approvedText: schema.suggestionPrecedents.approvedText,
      sampleSize: schema.suggestionPrecedents.sampleSize,
    })
    .from(schema.suggestionPrecedents)
    .where(
      and(
        eq(schema.suggestionPrecedents.moment, moment),
        eq(schema.suggestionPrecedents.contentType, contentType),
      ),
    )
    .orderBy(
      desc(schema.suggestionPrecedents.sampleSize),
      desc(schema.suggestionPrecedents.createdAt),
    )
    .limit(limit);

  return rows.map((r) => ({
    approvedText: r.approvedText,
    sampleSize: r.sampleSize,
  }));
}
