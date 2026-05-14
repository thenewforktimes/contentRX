/**
 * `/admin` founder dashboard layout.
 *
 * Vertical left rail with weighted IA: MODEL primary, PILOTS and
 * REPORTS secondary. The MODEL group surfaces inline counts so the
 * rail itself flags what needs eyes — Today's queue, Override inbox,
 * Customer flags. The rail is always visible across every /admin/*
 * route so navigation never competes with page content for horizontal
 * real estate.
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
 */

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommandPalette } from "@/components/admin/command-palette";
import { Wordmark } from "@/components/wordmark";
import { isContentRXAdmin } from "@/lib/graduation";
import { loadSidebarCounts } from "@/lib/admin/sidebar-counts";
import { AdminNavLink } from "./admin-nav-link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    const requestedPath = await currentAdminPath();
    redirect(`/sign-in?redirect_url=${encodeURIComponent(requestedPath)}`);
  }
  if (!isContentRXAdmin(clerkId)) {
    notFound();
  }

  // Best-effort. If the count load throws (e.g. transient DB issue),
  // we'd rather render the rail with no badges than 500 the whole
  // admin surface.
  let counts = {
    todayQueue: 0,
    overrideInbox: 0,
    customerFlags: 0,
    library: 0,
  };
  try {
    counts = await loadSidebarCounts();
  } catch {
    // Swallow — the rail still renders, just without badges.
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex max-w-7xl">
        <aside className="hidden w-60 shrink-0 border-r border-line bg-raised px-4 py-6 md:block">
          {/*
            Wordmark + small "Admin" suffix replaces the plain-text
            "ContentRX · Admin" link. Founder dashboard now shares
            the same brand chrome as customer surfaces; the suffix
            disambiguates without breaking visual identity.
          */}
          <div className="flex items-baseline gap-1.5 px-2">
            <Wordmark size="xs" />
            <span className="text-xs font-semibold uppercase tracking-wider text-quiet">
              Admin
            </span>
          </div>
          <Link
            href="/dashboard"
            className="mt-2 inline-block rounded px-2 text-xs text-quiet hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            ← Dashboard
          </Link>

          <div className="mt-4 px-2">
            <CommandPalette />
          </div>

          <nav aria-label="Admin sections" className="mt-6 space-y-6 text-sm">
            <NavGroup label="Model">
              <AdminNavLink href="/admin" badge={counts.todayQueue}>
                Today&rsquo;s queue
              </AdminNavLink>
              <AdminNavLink href="/admin/overrides" badge={counts.overrideInbox}>
                Override inbox
              </AdminNavLink>
              <AdminNavLink href="/admin/customer-flags" badge={counts.customerFlags}>
                Customer flags
              </AdminNavLink>
              <AdminNavLink href="/admin/queue">Queue (full)</AdminNavLink>
              <AdminNavLink href="/admin/model" badge={counts.library}>
                Library
              </AdminNavLink>
              <AdminNavLink href="/admin/suggestions">Suggestions</AdminNavLink>
              <AdminNavLink href="/admin/refinement-log">Refinement</AdminNavLink>
              <AdminNavLink href="/admin/rule-review">Override rates</AdminNavLink>
              <AdminNavLink href="/admin/calibration">Calibration</AdminNavLink>
            </NavGroup>

            <NavGroup label="Pilots">
              <AdminNavLink href="/admin/pilots">Tracker</AdminNavLink>
              <AdminNavLink href="/admin/costs">Costs</AdminNavLink>
              <AdminNavLink href="/admin/costs/margin">Margin</AdminNavLink>
            </NavGroup>

            <NavGroup label="Reports">
              <AdminNavLink href="/admin/reports">Reports</AdminNavLink>
            </NavGroup>
          </nav>
        </aside>

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-6 py-8 outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function NavGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-quiet">
        {label}
      </p>
      <ul className="mt-2 space-y-0.5">{children}</ul>
    </div>
  );
}

// NavLink moved to ./admin-nav-link.tsx (client component) on
// 2026-05-14 so it can drive aria-current="page" from usePathname().

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
