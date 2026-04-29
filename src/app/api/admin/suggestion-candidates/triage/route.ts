/**
 * POST /api/admin/suggestion-candidates/triage — bulk-mark candidates
 *                                                 as approved or rejected.
 *
 * Block 2b of the calibration plan. The /admin/suggestions queue UI
 * calls this when Robert clicks Approve / Reject on a cluster.
 *
 * "Approve" merges N candidate rows into a single suggestion_precedent
 * row. The chosen `approved_text` is the most-frequent rewrite in the
 * cluster (or whatever Robert picked from the cluster's deduped list).
 * Each merged candidate's `status` flips to 'merged' and points back
 * to the precedent via no FK (sample_size on the precedent
 * aggregates the count instead).
 *
 * "Reject" flips the candidates' `status` to 'rejected'. No precedent
 * is written. Useful for slop-rejection metrics: high reject rates
 * on a specific bucket flag a cell where the LLM is producing bad
 * suggestions.
 *
 * Auth: founder-only via isContentRXAdmin (CONTENTRX_ADMIN_CLERK_IDS).
 *
 * Body shape:
 *   {
 *     action: "approve" | "reject",
 *     candidate_ids: string[],
 *     // approve-only: the canonical text to promote. Required when
 *     // action="approve". Robert may have edited this on the UI vs
 *     // copying the most-frequent candidate verbatim.
 *     approved_text?: string,
 *     // approve-only: the bucket axes for the new precedent. The
 *     // route validates that all candidate_ids share these values
 *     // so a typo doesn't pollute the wrong bucket.
 *     moment?: string,
 *     content_type?: string,
 *     standard_id?: string,
 *   }
 */

import { auth } from "@clerk/nextjs/server";
import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isContentRXAdmin } from "@/lib/graduation";
import {
  detectSensitivePatterns,
  sensitiveDataErrorMessage,
} from "@/lib/pii-screen";
import { logSafeError } from "@/lib/safe-error-log";
import { sanitizeZodIssues } from "@/lib/zod-errors";
import { getDb, schema } from "@/db";
import { getOrProvisionUser } from "@/lib/user-provisioning";

const RequestSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    candidate_ids: z.array(z.string().min(1).max(64)).min(1).max(200),
    approved_text: z.string().min(1).max(100_000).optional(),
    moment: z.string().min(1).max(64).optional(),
    content_type: z.string().min(1).max(64).optional(),
    standard_id: z.string().min(1).max(64).optional(),
  })
  .refine(
    (data) => {
      if (data.action === "approve") {
        return Boolean(
          data.approved_text &&
            data.moment &&
            data.content_type &&
            data.standard_id,
        );
      }
      return true;
    },
    {
      message:
        "Approve action requires approved_text + moment + content_type + standard_id",
      path: ["action"],
    },
  );

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId || !isContentRXAdmin(clerkId)) {
    // Same posture as src/app/admin/layout.tsx — non-founders get
    // 404 so the URL itself doesn't leak.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: sanitizeZodIssues(parsed.error.issues),
      },
      { status: 400 },
    );
  }

  // PII pre-screen on the approved_text. The candidate side already
  // screened, but the approver may have edited the text — re-screen
  // defense-in-depth.
  if (parsed.data.action === "approve" && parsed.data.approved_text) {
    const patterns = detectSensitivePatterns(parsed.data.approved_text);
    if (patterns.length > 0) {
      return NextResponse.json(
        {
          error: sensitiveDataErrorMessage(patterns),
          patterns,
        },
        { status: 400 },
      );
    }
  }

  try {
    const db = getDb();
    const user = await getOrProvisionUser(clerkId);
    const approvedBy = user?.id ?? null;
    const now = new Date();

    if (parsed.data.action === "reject") {
      // Bulk update: status = 'rejected', reviewedBy + reviewedAt set.
      const updated = await db
        .update(schema.suggestionCandidates)
        .set({
          status: "rejected",
          reviewedBy: approvedBy,
          reviewedAt: now,
        })
        .where(inArray(schema.suggestionCandidates.id, parsed.data.candidate_ids))
        .returning({ id: schema.suggestionCandidates.id });
      return NextResponse.json({
        rejected: updated.length,
      });
    }

    // Approve path: insert precedent, then mark candidates as merged.
    const [precedent] = await db
      .insert(schema.suggestionPrecedents)
      .values({
        moment: parsed.data.moment!,
        contentType: parsed.data.content_type!,
        standardId: parsed.data.standard_id!,
        approvedText: parsed.data.approved_text!,
        approvedBy,
        // sample_size starts at the count of merged candidates;
        // future approvals on the same bucket can bump it.
        sampleSize: parsed.data.candidate_ids.length,
        approvedAt: now,
      })
      .returning({ id: schema.suggestionPrecedents.id });

    const merged = await db
      .update(schema.suggestionCandidates)
      .set({
        status: "merged",
        reviewedBy: approvedBy,
        reviewedAt: now,
      })
      .where(inArray(schema.suggestionCandidates.id, parsed.data.candidate_ids))
      .returning({ id: schema.suggestionCandidates.id });

    return NextResponse.json({
      precedent_id: precedent.id,
      merged: merged.length,
    });
  } catch (err) {
    logSafeError("suggestion triage failed", err);
    return NextResponse.json(
      { error: "Failed to triage candidates" },
      { status: 500 },
    );
  }
}
