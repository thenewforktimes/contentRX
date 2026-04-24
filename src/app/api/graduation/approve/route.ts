/**
 * POST /api/graduation/approve — approve a standard's graduation.
 *
 * Human-eval build plan Session 11. Takes a standard + target level +
 * reason, confirms the caller is on the admin allow-list, appends an
 * entry to `graduation_status.history`, and updates `level`.
 *
 * Body:
 *   {
 *     standard_id: string,
 *     target_level: "batch_approval" | "autonomous",
 *     reason: string,
 *     readiness_snapshot?: any  // optional — passed through to the
 *                                 // history entry verbatim for audit
 *   }
 *
 * Auth:
 *   - Clerk session (required)
 *   - Clerk user ID present in CONTENTRX_ADMIN_CLERK_IDS env var
 *
 * Returns 403 when the caller isn't on the admin allow-list, 400 on
 * malformed bodies, 409 when the proposed level isn't a strict
 * promotion from the current level, 201 on success.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canApproveGraduation,
  getGraduationStatus,
  isPromotion,
  recordLevelChange,
  type GraduationLevel,
} from "@/lib/graduation";
import { sanitizeZodIssues } from "@/lib/zod-errors";

const RequestSchema = z.object({
  standard_id: z.string().min(1).max(64),
  target_level: z.enum(["batch_approval", "autonomous"]),
  reason: z.string().min(1).max(2000),
  readiness_snapshot: z.unknown().optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canApproveGraduation(userId)) {
    return NextResponse.json(
      {
        error:
          "Graduation approval is restricted. Add your Clerk user ID to the CONTENTRX_ADMIN_CLERK_IDS env var.",
      },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: sanitizeZodIssues(parsed.error.issues) },
      { status: 400 },
    );
  }

  const { standard_id, target_level, reason, readiness_snapshot } = parsed.data;

  const current = await getGraduationStatus(standard_id);
  const currentLevel: GraduationLevel = current?.level ?? "robo_labels";

  if (!isPromotion(currentLevel, target_level)) {
    return NextResponse.json(
      {
        error: `Cannot graduate from ${currentLevel} to ${target_level} — that's not a strict promotion. Use the demotion flow for level drops.`,
      },
      { status: 409 },
    );
  }

  // Stash the full readiness snapshot on the history entry so the
  // audit trail captures why the approver thought this was ready.
  const augmentedReason = readiness_snapshot
    ? `${reason}\n---\nreadiness_snapshot: ${JSON.stringify(readiness_snapshot)}`
    : reason;

  await recordLevelChange({
    standardId: standard_id,
    newLevel: target_level,
    reason: augmentedReason,
    approver: userId,
    source: "manual_approval",
  });

  return NextResponse.json(
    {
      ok: true,
      standard_id,
      previous_level: currentLevel,
      new_level: target_level,
      approver: userId,
    },
    { status: 201 },
  );
}
