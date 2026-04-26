/**
 * `/admin/essay-drafts` save Server Action.
 *
 * Phase B7b of the post-pivot rolling plan. Persists the textarea
 * contents to `essays/drafts/<filename>.md`. The save is the entire
 * "persistence" — drafts travel through git as ordinary commits.
 *
 * Vercel runtime is read-only; the action returns `vercel_readonly`
 * there. Founder workflow is local-first by design (matches B4b
 * refinement-form and B6b reports-mark-reviewed caveats).
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

"use server";

import fs from "node:fs";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { isContentRXAdmin } from "@/lib/graduation";
import {
  draftFilePath,
  ensureDraftsDir,
  isSafeDraftFilename,
} from "@/lib/admin-essay-drafts.server";

interface SaveResult {
  ok: boolean;
  error?:
    | "not_authorised"
    | "invalid_filename"
    | "empty_body"
    | "body_too_large"
    | "vercel_readonly"
    | "write_failed"
    | "mkdir_failed";
}

const MAX_BODY_BYTES = 64 * 1024;

/** Form-action variant. Errors are swallowed; the page revalidates
 * and any failure manifests as the textarea contents not landing on
 * disk. */
export async function saveDraftAction(formData: FormData): Promise<void> {
  const filename = String(formData.get("filename") ?? "");
  const body = String(formData.get("body") ?? "");
  await saveDraft(filename, body);
}

/** Programmatic variant. Returns a structured result so unit tests
 * and any future client-side caller can branch on outcomes. */
export async function saveDraft(
  filename: string,
  body: string,
): Promise<SaveResult> {
  // Defense-in-depth: re-check the founder gate at the action boundary.
  // The /admin layout enforces it on render, but Server Actions are
  // independently POSTable so we cannot rely on the layout alone.
  const { userId: clerkId } = await auth();
  if (!isContentRXAdmin(clerkId)) {
    return { ok: false, error: "not_authorised" };
  }

  if (!isSafeDraftFilename(filename)) {
    return { ok: false, error: "invalid_filename" };
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "empty_body" };
  }
  if (Buffer.byteLength(body, "utf-8") > MAX_BODY_BYTES) {
    return { ok: false, error: "body_too_large" };
  }
  const target = draftFilePath(filename);
  if (target === null) {
    // Should not happen — isSafeDraftFilename already passed — but
    // we fail closed for the same reason validation always does.
    return { ok: false, error: "invalid_filename" };
  }

  if (!ensureDraftsDir()) {
    if (isReadOnlyFsError()) {
      return { ok: false, error: "vercel_readonly" };
    }
    return { ok: false, error: "mkdir_failed" };
  }

  try {
    // Body is written verbatim — markdown is plain text and the
    // founder is the only writer. `wx` would clobber the existing
    // file, but we want overwrite semantics here so multiple saves
    // of the same draft work.
    fs.writeFileSync(target, body, "utf-8");
  } catch (err) {
    if (isReadOnlyFsErrorFrom(err)) {
      return { ok: false, error: "vercel_readonly" };
    }
    return { ok: false, error: "write_failed" };
  }

  revalidatePath("/admin/essay-drafts");
  return { ok: true };
}

function isReadOnlyFsError(): boolean {
  // ensureDraftsDir swallows the original error, so we re-probe by
  // attempting a stat. On Vercel, the /var/task FS is read-only — a
  // mkdir failure with EROFS is the canonical signal.
  try {
    fs.accessSync(process.cwd(), fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

function isReadOnlyFsErrorFrom(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "EROFS" || code === "EACCES";
}
