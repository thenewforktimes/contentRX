/**
 * Cross-finding pattern detection for the dashboard "This week" panel
 * (PR-33).
 *
 * The panel already shows raw counts (findings, dismissals, top
 * surface). Patterns layer on top: "Most findings landed on
 * confirmations" / "src/CheckoutForm.tsx flagged most often" / "8 of
 * 32 are high-severity." These are the observations only ContentRX
 * can make — every check across every surface, aggregated for one
 * team. The moat showing up in the customer's experience.
 *
 * Privacy contract (ADR 2026-04-25 / schema 2.0.0):
 *   - `moment`, `severity`, and `file_path` are user-visible context.
 *     The user picks moments at /api/check time; severity ships in
 *     the public envelope; file paths come from the user's own repo.
 *   - `standard_id` is INTERNAL and must not surface here. We
 *     aggregate by moment/severity/file only — never by standard.
 *
 * Thresholds tuned conservatively: a pattern only emits when there's
 * enough activity to be meaningful (else the panel reads as random
 * noise). MIN_TOTAL_FOR_PATTERNS = 5 is the floor for any pattern
 * to surface at all.
 */

import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type FindingPattern =
  | {
      kind: "moment-concentration";
      moment: string;
      momentLabel: string;
      count: number;
      sharePct: number;
    }
  | {
      kind: "file-hotspot";
      filePath: string;
      count: number;
    }
  | {
      kind: "severity-skew";
      highCount: number;
      total: number;
      sharePct: number;
    };

export type FindingAggregates = {
  topMoment: { moment: string; count: number } | null;
  topFile: { filePath: string; count: number } | null;
  highCount: number;
};

/** Below this floor, the panel just shows the raw counts — no patterns. */
const MIN_TOTAL_FOR_PATTERNS = 5;
/** Moment-concentration emits only when one moment owns ≥20% of findings. */
const MIN_MOMENT_SHARE = 0.2;
/** File-hotspot emits only when one file has ≥3 findings in the window. */
const MIN_FILE_HOTSPOT = 3;
/** Severity-skew needs ≥3 high-severity AND ≥25% of findings to surface. */
const MIN_HIGH_FOR_SKEW = 3;
const MIN_HIGH_SHARE = 0.25;

const MOMENT_LABELS: Record<string, string> = {
  first_encounter: "First-encounter copy",
  browsing_discovery: "Browsing & discovery",
  decision_point: "Decision points",
  task_execution: "Task execution",
  confirmation: "Confirmations",
  celebration: "Celebrations",
  error_recovery: "Error recovery",
  destructive_action: "Destructive actions",
  empty_state: "Empty states",
  interruption: "Interruptions",
  trust_permission: "Trust & permission",
  wayfinding: "Wayfinding",
  compliance_disclosure: "Compliance disclosures",
};

/** Map raw moment IDs to display labels. Falls back to a humanized form. */
export function momentLabel(moment: string): string {
  if (MOMENT_LABELS[moment]) return MOMENT_LABELS[moment];
  return moment.replace(/_/g, " ");
}

/**
 * Pure transformation: given raw aggregates + total findings, produce
 * the list of patterns the panel should show. No DB access, no I/O,
 * easy to test deterministically.
 */
export function buildPatterns(
  aggregates: FindingAggregates,
  total: number,
): FindingPattern[] {
  if (total < MIN_TOTAL_FOR_PATTERNS) return [];

  const patterns: FindingPattern[] = [];

  if (aggregates.topMoment) {
    const share = aggregates.topMoment.count / total;
    if (share >= MIN_MOMENT_SHARE) {
      patterns.push({
        kind: "moment-concentration",
        moment: aggregates.topMoment.moment,
        momentLabel: momentLabel(aggregates.topMoment.moment),
        count: aggregates.topMoment.count,
        sharePct: Math.round(share * 1000) / 10,
      });
    }
  }

  if (
    aggregates.topFile &&
    aggregates.topFile.count >= MIN_FILE_HOTSPOT
  ) {
    patterns.push({
      kind: "file-hotspot",
      filePath: aggregates.topFile.filePath,
      count: aggregates.topFile.count,
    });
  }

  if (aggregates.highCount >= MIN_HIGH_FOR_SKEW) {
    const share = aggregates.highCount / total;
    if (share >= MIN_HIGH_SHARE) {
      patterns.push({
        kind: "severity-skew",
        highCount: aggregates.highCount,
        total,
        sharePct: Math.round(share * 1000) / 10,
      });
    }
  }

  return patterns;
}

/**
 * Aggregate moment/file/severity counts for the given team's findings
 * within the window. One query with three CTE-style aggregates over a
 * single index scan — the table only gets read once.
 */
export async function loadFindingAggregates(
  teamId: string,
  since: Date,
): Promise<FindingAggregates> {
  const db = getDb();

  // postgres-js's wire-protocol writer for raw `sql` template params
  // expects a string/Buffer/ArrayBuffer, not a Date — Drizzle's query
  // builder normally adapts Date in `gte()` etc., but this raw CTE
  // bypasses that adapter. Pass the ISO string and cast it in SQL so
  // Postgres still compares as a timestamp. Fixes a 500 on /dashboard
  // that broke production after the audit P0b CTE consolidation.
  const sinceIso = since.toISOString();

  const rows = await db.execute<{
    top_moment: string | null;
    top_moment_count: number | null;
    top_file: string | null;
    top_file_count: number | null;
    high_count: number;
  }>(sql`
    WITH base AS (
      SELECT moment, file_path, severity
      FROM ${schema.violations}
      WHERE team_id = ${teamId} AND created_at >= ${sinceIso}::timestamptz
    ),
    moment_top AS (
      SELECT moment, count(*)::int AS cnt
      FROM base
      WHERE moment IS NOT NULL
      GROUP BY moment
      ORDER BY cnt DESC
      LIMIT 1
    ),
    file_top AS (
      SELECT file_path, count(*)::int AS cnt
      FROM base
      WHERE file_path IS NOT NULL
      GROUP BY file_path
      ORDER BY cnt DESC
      LIMIT 1
    )
    SELECT
      (SELECT moment FROM moment_top) AS top_moment,
      (SELECT cnt FROM moment_top) AS top_moment_count,
      (SELECT file_path FROM file_top) AS top_file,
      (SELECT cnt FROM file_top) AS top_file_count,
      (SELECT count(*)::int FROM base WHERE severity = 'high') AS high_count
  `);

  const r = rows[0];
  return {
    topMoment: r?.top_moment
      ? { moment: r.top_moment, count: r.top_moment_count ?? 0 }
      : null,
    topFile: r?.top_file
      ? { filePath: r.top_file, count: r.top_file_count ?? 0 }
      : null,
    highCount: r?.high_count ?? 0,
  };
}
