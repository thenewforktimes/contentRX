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
  if (!clerkUserId) return false;
  const raw = process.env.CONTENTRX_ADMIN_CLERK_IDS ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(clerkUserId);
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
