/**
 * Server Action for `/admin/refinement-log`.
 *
 * Phase B4b of the post-pivot rolling plan. Appends a new manual
 * refinement candidate to `taxonomy_refinement_log.md` directly on
 * disk. The file is committed to the repo, so on Vercel the action
 * also has to play nice with the read-only filesystem — the action
 * is documented as a *local-only* convenience for now; production
 * appends still go through the standard "edit the markdown locally,
 * commit, push" flow until a database-backed refinement queue lands.
 *
 * Auth: founder-only via `isContentRXAdmin`.
 */

"use server";

import { auth } from "@clerk/nextjs/server";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { isContentRXAdmin } from "@/lib/graduation";
import {
  appendRefinement,
  type RefinementSubmission,
} from "@/lib/admin-refinement-log-writer";

const LOG_PATH = path.join(process.cwd(), "taxonomy_refinement_log.md");

export interface AddRefinementResult {
  ok: boolean;
  error?: string;
  assigned_id?: string;
}

/**
 * Form-action variant. Form actions must return `void | Promise<void>`,
 * so this wrapper logs the result + revalidates without surfacing a
 * structured response to the caller. The detailed shape is available
 * via `addRefinementWithResult` for programmatic use.
 */
export async function addRefinement(formData: FormData): Promise<void> {
  const result = await addRefinementWithResult(formData);
  if (!result.ok) {
    console.error("[admin/refinement-log] addRefinement failed:", result.error);
  } else {
    console.log(
      `[admin/refinement-log] added ${result.assigned_id} to taxonomy_refinement_log.md`,
    );
  }
}

export async function addRefinementWithResult(
  formData: FormData,
): Promise<AddRefinementResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { ok: false, error: "not_authenticated" };
  if (!isContentRXAdmin(clerkId)) {
    return { ok: false, error: "not_authorised" };
  }

  const parsed = parseFormData(formData);
  if ("error" in parsed) return parsed as AddRefinementResult;
  const submission = parsed as RefinementSubmission;

  let raw: string;
  try {
    raw = fs.readFileSync(LOG_PATH, "utf-8");
  } catch (err) {
    return {
      ok: false,
      error: `read_failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  let next: string;
  let assignedId: string;
  try {
    const result = appendRefinement(raw, submission);
    next = result.next_md;
    assignedId = result.assigned_id;
  } catch (err) {
    return {
      ok: false,
      error: `append_failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  try {
    fs.writeFileSync(LOG_PATH, next, "utf-8");
  } catch (err) {
    // Vercel's filesystem is read-only at runtime — this branch hits
    // in production. Surface the error so the caller can route the
    // founder to the local-only flow.
    return {
      ok: false,
      error: `write_failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  revalidatePath("/admin/refinement-log");
  return { ok: true, assigned_id: assignedId };
}

function parseFormData(
  formData: FormData,
): RefinementSubmission | AddRefinementResult {
  const get = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v : "";
  };

  const current_category = get("current_category").trim();
  const proposed_split = get("proposed_split").trim();
  const triggering_case = get("triggering_case").trim();
  const architectural_consequence = get("architectural_consequence").trim();
  const title = get("title").trim();
  const note = get("note").trim();
  const date_logged_raw = get("date_logged").trim();

  if (!current_category) {
    return { ok: false, error: "missing_current_category" };
  }
  if (!proposed_split) {
    return { ok: false, error: "missing_proposed_split" };
  }
  if (!triggering_case) {
    return { ok: false, error: "missing_triggering_case" };
  }
  if (!architectural_consequence) {
    return { ok: false, error: "missing_architectural_consequence" };
  }

  const date_logged = isIsoDate(date_logged_raw)
    ? date_logged_raw
    : new Date().toISOString().slice(0, 10);

  return {
    origin: "manual",
    title: title || undefined,
    current_category,
    proposed_split,
    triggering_case,
    architectural_consequence,
    note: note || undefined,
    date_logged,
  };
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
