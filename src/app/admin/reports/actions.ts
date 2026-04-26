/**
 * `/admin/reports` review-state Server Action.
 *
 * Phase B6b of the post-pivot rolling plan. Toggles the review-state
 * sentinel for a single report file: `reports/<type>/.<filename>.reviewed`.
 *
 * Local-dev workflow (the architecture's preview-before-publish gate):
 *
 *   1. Generator commits a new report (e.g. `2026-15.md`).
 *   2. Founder reads it on `/admin/reports/<type>/<filename>` locally.
 *   3. Founder clicks "Mark reviewed" — sentinel file is written.
 *   4. Founder commits both the report and the sentinel; PR ships them.
 *
 * The sentinel file is a sibling of the report and starts with `.` so
 * it is excluded from the report-listing scan. Production (Vercel)
 * filesystem is read-only — the action returns `vercel_readonly` from
 * there, matching the same caveat documented for B4b.
 *
 * Auth handled by `src/app/admin/layout.tsx` via the `isContentRXAdmin`
 * Clerk role check. This file imports from `server-only` modules and
 * is itself only callable as a Server Action.
 */

"use server";

import fs from "node:fs";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { isContentRXAdmin } from "@/lib/graduation";
import {
  isReportType,
  reviewSentinelPath,
  type ReportType,
} from "@/lib/admin-reports.server";

interface ToggleResult {
  ok: boolean;
  reviewed: boolean;
  error?:
    | "not_authorised"
    | "invalid_type"
    | "invalid_filename"
    | "report_not_found"
    | "vercel_readonly"
    | "write_failed";
}

/**
 * Form-action variant: callable directly from `<form action={...}>`.
 *
 * The form contract requires the action to accept a single `FormData`
 * argument and return `Promise<void>`. Errors are intentionally
 * swallowed here because there is no client-side surface to display
 * them to — the page revalidates and any failure manifests as the row
 * not changing state.
 */
export async function toggleReviewedAction(formData: FormData): Promise<void> {
  const typeRaw = String(formData.get("type") ?? "");
  const filename = String(formData.get("filename") ?? "");
  const desiredRaw = String(formData.get("desired") ?? "");
  const desired = desiredRaw === "true";
  await toggleReviewed(typeRaw, filename, desired);
}

/**
 * Programmatic variant. Returns a structured result so unit tests and
 * any future client-side caller can branch on the outcome.
 */
export async function toggleReviewed(
  typeRaw: string,
  filename: string,
  desired: boolean,
): Promise<ToggleResult> {
  // Defense-in-depth: re-check the founder gate at the action boundary.
  // The /admin layout enforces it on render, but Server Actions are
  // independently POSTable so we cannot rely on the layout alone.
  const { userId: clerkId } = await auth();
  if (!isContentRXAdmin(clerkId)) {
    return { ok: false, reviewed: false, error: "not_authorised" };
  }

  if (!isReportType(typeRaw)) {
    return { ok: false, reviewed: false, error: "invalid_type" };
  }
  const type: ReportType = typeRaw;
  const sentinel = reviewSentinelPath(type, filename);
  if (sentinel === null) {
    // Either the filename is unsafe or the report file does not exist.
    // We can't tell the two apart from outside this module without
    // duplicating the validation, so return the more conservative
    // "not found" — both cases are user-visible as "the row is gone".
    return { ok: false, reviewed: false, error: "report_not_found" };
  }

  const exists = fileExists(sentinel);
  // Idempotent fast paths — no filesystem write needed.
  if (desired && exists) {
    revalidatePath("/admin/reports");
    revalidatePath(`/admin/reports/${type}/${encodeURIComponent(filename)}`);
    return { ok: true, reviewed: true };
  }
  if (!desired && !exists) {
    revalidatePath("/admin/reports");
    revalidatePath(`/admin/reports/${type}/${encodeURIComponent(filename)}`);
    return { ok: true, reviewed: false };
  }

  try {
    if (desired) {
      // Sentinel content is informational — the existence of the file
      // is what matters. We write a single line so an editor opening
      // it sees what it is.
      fs.writeFileSync(
        sentinel,
        `marked reviewed at ${new Date().toISOString()}\n`,
        "utf-8",
      );
    } else {
      fs.unlinkSync(sentinel);
    }
  } catch (err) {
    if (isReadOnlyFsError(err)) {
      return { ok: false, reviewed: exists, error: "vercel_readonly" };
    }
    return { ok: false, reviewed: exists, error: "write_failed" };
  }

  revalidatePath("/admin/reports");
  revalidatePath(`/admin/reports/${type}/${encodeURIComponent(filename)}`);
  return { ok: true, reviewed: desired };
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isReadOnlyFsError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "EROFS" || code === "EACCES";
}
