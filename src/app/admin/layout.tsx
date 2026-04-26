/**
 * `/admin` founder dashboard layout.
 *
 * Phase B1 of the post-pivot rolling plan. Centralizes the founder-only
 * auth gate that every admin page would otherwise repeat. Pages under
 * `/admin/*` inherit this layout, so adding a new admin surface only
 * requires building the page — never re-implementing auth.
 *
 * Auth contract (per
 * `decisions/2026-04-25-private-taxonomy-pivot.md`):
 *
 *   1. Unauthenticated requests redirect to `/sign-in` with a
 *      `redirect_url` so the user lands back on the admin URL after
 *      signing in.
 *   2. Authenticated-but-non-founder requests `notFound()` (not 403).
 *      We don't confirm the existence of the admin surface to non-
 *      founders — the URL itself is privileged information.
 *   3. Founders (Clerk IDs in `CONTENTRX_ADMIN_CLERK_IDS`) get the
 *      page content.
 *
 * The single-user-by-design principle (ARCHITECTURE.md §`/admin`
 * dashboard) means this layout doesn't try to model multi-tenant
 * permissions. There's one role: founder. Everyone else gets a 404.
 */

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isContentRXAdmin } from "@/lib/graduation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    // Preserve the requested URL so post-sign-in we land back on
    // the admin surface rather than the customer dashboard.
    const requestedPath = await currentAdminPath();
    redirect(`/sign-in?redirect_url=${encodeURIComponent(requestedPath)}`);
  }
  if (!isContentRXAdmin(clerkId)) {
    // 404 rather than 403 — non-founders shouldn't even know /admin exists.
    notFound();
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/admin"
            className="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
          >
            ContentRX · Admin
          </Link>
          <nav
            aria-label="Admin sections"
            className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-400"
          >
            <Link href="/admin/model" className="hover:underline">
              Model
            </Link>
            <Link href="/admin/queue" className="hover:underline">
              Queue
            </Link>
            <Link href="/admin/refinement-log" className="hover:underline">
              Refinement log
            </Link>
            <Link href="/admin/calibration" className="hover:underline">
              Calibration
            </Link>
            <Link href="/admin/reports" className="hover:underline">
              Reports
            </Link>
            <Link href="/admin/essay-drafts" className="hover:underline">
              Essay drafts
            </Link>
            <Link href="/admin/case-studies" className="hover:underline">
              Case studies
            </Link>
            <Link href="/admin/rule-review" className="hover:underline">
              Rule review
            </Link>
            {/* Phase B mainline complete; follow-ups B3b/B4b/B5b/B6b/B7b
                add decision-recording, form entry, charts, approvals,
                and draft persistence. */}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

/**
 * Best-effort recovery of the current `/admin/...` URL so the
 * sign-in redirect_url lands back where the user was trying to go.
 * Falls back to `/admin` when the headers are not available.
 */
async function currentAdminPath(): Promise<string> {
  try {
    const h = await headers();
    const path =
      h.get("next-url") ?? h.get("x-pathname") ?? h.get("x-invoke-path");
    if (path && path.startsWith("/admin")) {
      return path;
    }
  } catch {
    // headers() throws outside a request scope; fall through.
  }
  return "/admin";
}
