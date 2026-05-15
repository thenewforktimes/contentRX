/**
 * GET /api/admin/search?q=<query>
 *
 * Founder-only cross-source search across overrides + queue +
 * customer flags. Powers the ⌘K command palette on /admin/*.
 *
 * Auth: Clerk session + isContentRXAdmin gate. Browser-session call
 * (the palette is a client component in the admin layout). No
 * Bearer / API-key path — this isn't a public endpoint.
 *
 * Privacy: returned `textPreview` echoes the raw text already in the
 * row (overrides require a separate contributeUpstream opt-in to
 * carry text; flags carry text unconditionally because the flag
 * itself is the consent gate). Nothing new is exposed that the
 * detail pages don't already show.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { searchAdmin } from "@/lib/admin/search";
import { isContentRXAdmin } from "@/lib/graduation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!isContentRXAdmin(clerkId)) {
    // 404 to mirror the layout's notFound() behaviour — non-founders
    // don't get to confirm the existence of admin endpoints.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";

  const results = await searchAdmin(q);
  return NextResponse.json(results);
}
