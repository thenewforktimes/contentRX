/**
 * Graduation-status helpers — human-eval build plan Session 10.
 *
 * Read + write access to the `graduation_status` table. The metrics
 * tool (`tools/graduation_metrics.py`) is the primary writer; Session
 * 11's graduation UI + approval flow layers on top.
 *
 * Level vocabulary is intentionally duplicated here from the Python
 * tool because the two sides shouldn't share a runtime. Keep in sync
 * when updating.
 */

import { eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { getDb, schema } from "@/db";

export const GRADUATION_LEVELS = [
  "robo_labels",
  "batch_approval",
  "autonomous",
] as const;

export type GraduationLevel = (typeof GRADUATION_LEVELS)[number];

/**
 * What changes when a standard graduates — shown on the approval UI
 * so Robo can confirm the consequences before clicking.
 */
export const LEVEL_CONSEQUENCES: Record<GraduationLevel, string> = {
  robo_labels:
    "Every verdict on this standard routes to Robo's review queue. Default for new standards.",
  batch_approval:
    "Verdicts ship in batches with Robo spot-checking samples. Reviews go from every case to a slice. Rollback trigger: 2-week override rate ≥ 10%.",
  autonomous:
    "Verdicts ship without Robo's review. A sampled audit pulls in a slice for calibration. Rollback trigger: 2-week override rate ≥ 5%.",
};

/**
 * Admin gate for graduation approval. Today: a single-founder product
 * — graduation decisions are Robo-only. The allow-list ships as an
 * env-var-separated list of Clerk user IDs. Unset = no one can approve,
 * which is the safe default if the env var is missing in prod.
 *
 * Future: move to a role system when the team grows. The API route
 * enforces this; the UI additionally hides the approve button when
 * the user is not an admin, but never relies on the hide as the
 * security boundary.
 */
export function canApproveGraduation(clerkUserId: string | null | undefined): boolean {
  return isContentRXAdmin(clerkUserId);
}

/**
 * General-purpose admin check. Anyone in `CONTENTRX_ADMIN_CLERK_IDS`
 * is an admin for all internal surfaces (graduation approval,
 * `/admin/rule-review`, future admin features). Kept in this file
 * because graduation.ts was the first caller — other modules import
 * from here rather than growing a parallel copy.
 */
export function isContentRXAdmin(
  clerkUserId: string | null | undefined,
): boolean {
  if (!clerkUserId) return false;
  const raw = process.env.CONTENTRX_ADMIN_CLERK_IDS ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(clerkUserId);
}

// ---------------------------------------------------------------------------
// Session 12 — demotion + auto-rollback
// ---------------------------------------------------------------------------

/**
 * Rolling override-rate thresholds per level. A graduated standard
 * whose 2-week rate meets or exceeds its level's threshold auto-demotes
 * one step. Thresholds mirror Session 10's graduation cutoffs exactly
 * — the same ratio that permits graduation is the one that triggers
 * rollback when it reverses.
 */
export const AUTO_DEMOTION_THRESHOLD: Record<GraduationLevel, number> = {
  robo_labels: Infinity,       // floor — can't demote further via auto path
  batch_approval: 0.10,        // ≥ 10% overrides → drop to robo_labels
  autonomous: 0.05,            // ≥ 5% overrides → drop to batch_approval
};

/**
 * Rolling window for the auto-demotion monitor. 14 days per the plan
 * spec. Shorter windows catch regressions faster but amplify noise;
 * 14 days is the floor for statistical stability on low-traffic
 * standards.
 */
export const AUTO_DEMOTION_WINDOW_DAYS = 14;

/**
 * Minimum denominator to trust the rate. Low-traffic standards with
 * a handful of violations + overrides can produce wild percentages
 * that don't reflect real drift. 10 violations over 14 days is the
 * floor — below that, the monitor flags for review instead of demoting.
 */
export const AUTO_DEMOTION_MIN_VIOLATIONS = 10;

/**
 * Actor-role weights — mirror `ACTOR_ROLE_WEIGHTS` in the Python
 * `tools/graduation_metrics.py`. Designer overrides weigh more than
 * engineer overrides; missing/unknown → 1.0.
 */
export const ACTOR_ROLE_WEIGHT: Record<string, number> = {
  designer: 1.5,
  pm: 1.0,
  engineer: 0.75,
  other: 1.0,
};

/**
 * Return the level a graduated standard lands at when auto-demoted
 * one step. Returns the input unchanged for `robo_labels` (already at
 * the floor — auto-monitor should skip these).
 */
export function demoteOneStep(level: GraduationLevel): GraduationLevel {
  const i = levelRank(level);
  if (i <= 0) return level;
  return GRADUATION_LEVELS[i - 1]!;
}

/**
 * Given a graduated standard's 2-week override rate + denominator,
 * decide whether the auto-monitor should demote. Respects the
 * min-denominator floor to keep the monitor from firing on noise.
 */
export function shouldAutoDemote(
  level: GraduationLevel,
  rate: number,
  violationsInWindow: number,
): boolean {
  if (level === "robo_labels") return false;
  if (violationsInWindow < AUTO_DEMOTION_MIN_VIOLATIONS) return false;
  return rate >= AUTO_DEMOTION_THRESHOLD[level];
}

/**
 * Compute the actor-weighted override count given a set of override
 * records. Pure function — side-effect-free so it's trivially
 * testable.
 */
export function weightedOverrideCount(
  overrides: Array<{ actorRole?: string | null }>,
): number {
  let total = 0;
  for (const o of overrides) {
    const role = o.actorRole ?? "other";
    total += ACTOR_ROLE_WEIGHT[role] ?? 1.0;
  }
  return total;
}

export type GraduationStatus = InferSelectModel<typeof schema.graduationStatus>;

export interface GraduationHistoryEntry {
  level: GraduationLevel;
  reason: string;
  at: string;             // ISO 8601
  approver?: string;      // Clerk user_id of the approver, when applicable
  source: "metrics_tool" | "manual_approval" | "auto_demotion";
}

/** Returns the level as a numeric rank for ordering comparisons. */
export function levelRank(level: GraduationLevel): number {
  return GRADUATION_LEVELS.indexOf(level);
}

export function isPromotion(
  from: GraduationLevel,
  to: GraduationLevel,
): boolean {
  return levelRank(to) > levelRank(from);
}

/**
 * Fetch the current status row for a standard. Returns null when the
 * standard hasn't been recorded yet (default level is `robo_labels`).
 */
export async function getGraduationStatus(
  standardId: string,
): Promise<GraduationStatus | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.graduationStatus)
    .where(eq(schema.graduationStatus.standardId, standardId))
    .limit(1);
  return row ?? null;
}

export async function listGraduationStatuses(): Promise<GraduationStatus[]> {
  const db = getDb();
  return (await db.select().from(schema.graduationStatus)) as GraduationStatus[];
}

export interface WriteReadinessInput {
  standardId: string;
  readiness: unknown;           // opaque JSON — the Python tool's output
  computedAt: Date;
}

/**
 * Write a freshly-computed readiness snapshot without changing the
 * current level. Called after each `graduation_metrics.py compute`
 * run. Level changes go through `recordLevelChange` so the history
 * stays append-only.
 */
export async function writeReadinessSnapshot(
  input: WriteReadinessInput,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.graduationStatus)
    .values({
      standardId: input.standardId,
      level: "robo_labels",
      lastReadiness: input.readiness,
      lastReadinessAt: input.computedAt,
      history: [],
    })
    .onConflictDoUpdate({
      target: schema.graduationStatus.standardId,
      set: {
        lastReadiness: input.readiness,
        lastReadinessAt: input.computedAt,
        updatedAt: sql`now()`,
      },
    });
}

export interface LevelChangeInput {
  standardId: string;
  newLevel: GraduationLevel;
  reason: string;
  approver?: string;
  source: GraduationHistoryEntry["source"];
  at?: Date;
}

/**
 * Append a level-change entry to the history and update the current
 * level. The history is append-only — we never rewrite old entries.
 */
export async function recordLevelChange(
  input: LevelChangeInput,
): Promise<void> {
  const db = getDb();
  const current = await getGraduationStatus(input.standardId);
  const entry: GraduationHistoryEntry = {
    level: input.newLevel,
    reason: input.reason,
    at: (input.at ?? new Date()).toISOString(),
    approver: input.approver,
    source: input.source,
  };
  const history = [
    ...((current?.history as GraduationHistoryEntry[] | null) ?? []),
    entry,
  ];
  await db
    .insert(schema.graduationStatus)
    .values({
      standardId: input.standardId,
      level: input.newLevel,
      history,
    })
    .onConflictDoUpdate({
      target: schema.graduationStatus.standardId,
      set: {
        level: input.newLevel,
        history,
        updatedAt: sql`now()`,
      },
    });
}
