/**
 * Data loader for /admin (Today's queue).
 *
 * Today's queue is the curated daily-driver: cases the engine flagged
 * for review where the resolution would actually improve the model.
 * Routine subtypes (low_confidence, situation_ambiguity,
 * out_of_distribution) are filtered out by default — they're noise for
 * the daily 15-minute rhythm. /admin/queue still exposes every subtype
 * for exhaustive review.
 *
 * Defaults:
 *   - Window: 7 days
 *   - Subtypes: standards_conflict + ensemble_disagreement + novel_pattern
 *
 * The toggle pills on /admin can opt nuanced subtypes off and routine
 * subtypes on. The URL carries the choice (?subtypes=a,b,c) so the view
 * is shareable / bookmarkable.
 */

import { and, desc, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;
const MAX_ROWS = 50;

export const ALL_SUBTYPES = [
  "standards_conflict",
  "ensemble_disagreement",
  "novel_pattern",
  "low_confidence",
  "situation_ambiguity",
  "out_of_distribution",
] as const;

export type Subtype = (typeof ALL_SUBTYPES)[number];

export const NUANCED_SUBTYPES: readonly Subtype[] = [
  "standards_conflict",
  "ensemble_disagreement",
  "novel_pattern",
] as const;

export const SUBTYPE_LABEL: Record<Subtype, string> = {
  standards_conflict: "Standards conflict",
  ensemble_disagreement: "Ensemble disagreement",
  novel_pattern: "Novel pattern",
  low_confidence: "Low confidence",
  situation_ambiguity: "Situation ambiguity",
  out_of_distribution: "Out of distribution",
};

export const SUBTYPE_ONELINER: Record<Subtype, string> = {
  standards_conflict:
    "Two standards fired on the same string with conflicting verdicts. Highest taxonomic value — fixing the rules clears the downstream signal.",
  ensemble_disagreement:
    "Scan and validate disagreed. The first-pass ensemble disagreed with itself — usually a prompt or content-type-notes gap.",
  novel_pattern:
    "Override rate climbing on a previously-stable rule. Drift signal — investigate before the rule's authority erodes.",
  low_confidence:
    "LLM rated its own finding under 0.7. Often calibration drift on a known standard.",
  situation_ambiguity:
    "Moment classifier confidence < 0.6. Routing question, not a model question.",
  out_of_distribution:
    "Novel input the classifier hasn't seen confidently. Routes to the new-moment backlog.",
};

export interface TodayQueueRow {
  id: string;
  createdAt: Date;
  contentType: string | null;
  moment: string | null;
  standardId: string;
  severity: string | null;
  source: string | null;
  textHash: string | null;
  subtype: Subtype;
  decidedStance: string | null;
}

export interface TodayQueue {
  rows: TodayQueueRow[];
  countsBySubtype: Record<Subtype, number>;
  selectedSubtypes: Subtype[];
  windowDays: number;
}

export async function loadTodayQueue(opts: {
  selectedSubtypes?: readonly Subtype[];
} = {}): Promise<TodayQueue> {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();
  const selected = (opts.selectedSubtypes ?? NUANCED_SUBTYPES).slice();
  // Defensive: collapse to a unique list and only known subtypes.
  const selectedClean = Array.from(new Set(selected)).filter((s): s is Subtype =>
    ALL_SUBTYPES.includes(s as Subtype),
  );

  // Counts by subtype across the full window (so the pills always show
  // accurate counts even when filtered out).
  const countRows = await db
    .select({
      subtype: schema.violations.reviewReasonSubtype,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.violations)
    .where(
      and(
        sql`${schema.violations.reviewReasonSubtype} IS NOT NULL`,
        sql`${schema.violations.createdAt} >= ${since}`,
      ),
    )
    .groupBy(schema.violations.reviewReasonSubtype);
  const countsBySubtype = Object.fromEntries(
    ALL_SUBTYPES.map((s) => [s, 0]),
  ) as Record<Subtype, number>;
  for (const row of countRows) {
    if (row.subtype && row.subtype in countsBySubtype) {
      countsBySubtype[row.subtype as Subtype] = Number(row.count);
    }
  }

  // No selected subtypes → empty result with the counts shown so the
  // user can opt subtypes back in via the pills.
  if (selectedClean.length === 0) {
    return {
      rows: [],
      countsBySubtype,
      selectedSubtypes: [],
      windowDays: WINDOW_DAYS,
    };
  }

  const rows = await db
    .select({
      id: schema.violations.id,
      createdAt: schema.violations.createdAt,
      contentType: schema.violations.contentType,
      moment: schema.violations.moment,
      standardId: schema.violations.standardId,
      severity: schema.violations.severity,
      source: schema.violations.source,
      textHash: schema.violations.textHash,
      subtype: schema.violations.reviewReasonSubtype,
    })
    .from(schema.violations)
    .where(
      and(
        inArray(
          schema.violations.reviewReasonSubtype,
          selectedClean as unknown as string[],
        ),
        sql`${schema.violations.createdAt} >= ${since}`,
      ),
    )
    .orderBy(desc(schema.violations.createdAt))
    .limit(MAX_ROWS);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      contentType: r.contentType,
      moment: r.moment,
      standardId: r.standardId,
      severity: r.severity,
      source: r.source,
      textHash: r.textHash,
      subtype: r.subtype as Subtype,
      decidedStance: null,
    })),
    countsBySubtype,
    selectedSubtypes: selectedClean,
    windowDays: WINDOW_DAYS,
  };
}

export function parseSubtypesParam(
  raw: string | string[] | undefined,
): Subtype[] | null {
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  if (value === "") return [];
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.filter((p): p is Subtype =>
    ALL_SUBTYPES.includes(p as Subtype),
  );
}
