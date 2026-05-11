/**
 * Helpers for /api/dashboard/export/* endpoints (PR-30).
 *
 * Exports are scoped to the requesting user's team and are
 * field-whitelisted at the query level — every export route uses an
 * explicit Drizzle `.select({...})` rather than `SELECT *`. This is
 * the principle: a customer can export the substrate THEY supplied
 * (their team_rules, custom_examples, override actions) but cannot
 * export substrate the engine emitted (rationale_chain,
 * ambiguity_flag, validate_rejection_reason) or the taxonomy itself
 * (standards_library.json, moments_taxonomy.json, engine internals).
 *
 * Auth is Clerk-session-only (no API key) — exports are a dashboard
 * feature, not a programmatic surface.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/ratelimit";
import type { ProvisionedUser } from "@/lib/user-provisioning";
import { getOrProvisionUser } from "@/lib/user-provisioning";

export type ExportAuth = {
  user: ProvisionedUser;
  /** The team's effective id (teamOwnerUserId for members; user.id for owners or solo users). */
  teamOwnerUserId: string;
};

/**
 * Resolve the requesting user + their team scope. Returns either the
 * auth context or a NextResponse that should be returned as-is.
 *
 * Rate-limited at the standard 60/min/user tier so a misbehaving CI
 * loop or a single noisy customer can't DoS the database via the
 * unbounded 90-day-window export queries. Added in the 2026-05-11
 * round-3 audit alongside the matching helpers on the other
 * dashboard routes.
 */
export async function requireExportAuth(): Promise<ExportAuth | NextResponse> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getOrProvisionUser(clerkId);
  if (!user) {
    return NextResponse.json(
      { error: "User not provisioned yet" },
      { status: 404 },
    );
  }
  const rl = await checkRateLimit(user.id);
  if (!rl.success) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((rl.reset - Date.now()) / 1000),
    );
    return NextResponse.json(
      { error: "Rate limit exceeded", retry_after_seconds: retryAfterSeconds },
      {
        status: 429,
        headers: { "retry-after": String(retryAfterSeconds) },
      },
    );
  }
  const teamOwnerUserId = user.teamOwnerUserId ?? user.id;
  return { user, teamOwnerUserId };
}

/**
 * RFC 4180 cell escaping. Quote when the value contains comma, quote,
 * CR, or LF; double internal quotes.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize an array of homogeneous rows to a CSV string. Cells are
 * pulled from each row by header name (so the header order is the
 * column order on output).
 */
export function serializeCsv(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  const lines: string[] = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Stable date-stamped filename: `<base>-YYYY-MM-DD.<ext>` in UTC. */
export function exportFilename(base: string, ext: "csv" | "json"): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${base}-${today}.${ext}`;
}

/** JSON download response with content-disposition + 2-space pretty print. */
export function jsonExportResponse(
  filename: string,
  payload: unknown,
): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

/** CSV download response with content-disposition. */
export function csvExportResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
