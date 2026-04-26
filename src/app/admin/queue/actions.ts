/**
 * Server Actions for `/admin/queue`.
 *
 * Phase B3b of the post-pivot rolling plan. Records the founder's
 * triage decisions (agree / disagree / skip) on individual review-
 * recommended cases. Decisions persist into `violation_overrides`
 * so the queue's daily 15-minute review rhythm produces signal that
 * feeds future calibration logs.
 *
 * Auth: founder-only via `isContentRXAdmin`. The action returns
 * `{ ok: false, error: ... }` on auth or validation failure rather
 * than throwing — keeps the surface easy to handle from the
 * client island.
 *
 * Privacy: the action takes a `violationId` (substrate FK) and a
 * stance string; no plaintext is involved. The originating
 * `violations` row already stores `sha256(text)` only.
 */

"use server";

import { auth } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { isContentRXAdmin } from "@/lib/graduation";

type Stance = "agree" | "disagree" | "skip";

const STANCES: ReadonlySet<Stance> = new Set(["agree", "disagree", "skip"]);

export interface DecideResult {
  ok: boolean;
  error?: string;
  decided_violation_id?: string;
}

/**
 * Persist a triage decision on one violation.
 *
 *   "agree"    → overrideStance="agree",
 *                overrideType="accept_as_review"
 *                — the founder confirms the engine's review_recommended
 *                  verdict was correct; the case is genuinely uncertain.
 *
 *   "disagree" → overrideStance="disagree",
 *                overrideType="mark_false_positive"
 *                — the founder thinks the engine should not have
 *                  flagged this; trains the next iteration.
 *
 *   "skip"     → no row written. Skip means "come back later"; the
 *                cluster of three (per the architecture doc) doesn't
 *                require positive triage on every case in the same
 *                sitting.
 */
export async function recordQueueDecision(
  violationId: string,
  stance: Stance,
): Promise<DecideResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { ok: false, error: "not_authenticated" };
  if (!isContentRXAdmin(clerkId)) return { ok: false, error: "not_authorised" };

  if (typeof violationId !== "string" || violationId.length === 0) {
    return { ok: false, error: "missing_violation_id" };
  }
  if (!STANCES.has(stance)) {
    return { ok: false, error: "invalid_stance" };
  }

  if (stance === "skip") {
    // No DB write — surfacing-only signal. Revalidate so the page
    // renders consistently with other interactions.
    revalidatePath("/admin/queue");
    return { ok: true, decided_violation_id: violationId };
  }

  const db = getDb();
  const [row] = await db
    .select({
      id: schema.violations.id,
      userId: schema.violations.userId,
      teamId: schema.violations.teamId,
      standardId: schema.violations.standardId,
      moment: schema.violations.moment,
      textHash: schema.violations.textHash,
    })
    .from(schema.violations)
    .where(eq(schema.violations.id, violationId))
    .limit(1);
  if (!row) return { ok: false, error: "violation_not_found" };

  const overrideType =
    stance === "agree" ? "accept_as_review" : "mark_false_positive";

  // Idempotency: if this founder has already recorded a decision for
  // this violation, no-op. We treat the founder's first decision as
  // canonical; later changes should go through a more explicit
  // "revise" action that doesn't exist yet.
  const existing = await db
    .select({ id: schema.violationOverrides.id })
    .from(schema.violationOverrides)
    .where(
      and(
        eq(schema.violationOverrides.violationId, violationId),
        eq(schema.violationOverrides.source, "dashboard"),
        eq(schema.violationOverrides.actorRole, "designer"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    revalidatePath("/admin/queue");
    return { ok: true, decided_violation_id: violationId };
  }

  await db.insert(schema.violationOverrides).values({
    teamId: row.teamId,
    userId: row.userId,
    violationId: row.id,
    standardId: row.standardId,
    moment: row.moment,
    textHash: row.textHash,
    overrideType,
    overrideStance: stance,
    actorRole: "designer",
    source: "dashboard",
    rationaleExpanded: null,
    timeToActionMs: null,
  });

  revalidatePath("/admin/queue");
  return { ok: true, decided_violation_id: violationId };
}
