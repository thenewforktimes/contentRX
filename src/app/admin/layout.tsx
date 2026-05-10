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
import { Pill } from "@/components/ui/pill";
import { isContentRXAdmin } from "@/lib/graduation";
import { loadSidebarCounts } from "@/lib/admin/sidebar-counts";

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
          <Link
            href="/admin"
            className="block px-2 text-sm font-semibold text-strong"
          >
            ContentRX · Admin
          </Link>
          <Link
            href="/dashboard"
            className="mt-1 block px-2 text-xs text-quiet hover:text-strong"
          >
            ← Dashboard
          </Link>

          <div className="mt-4 px-2">
            <CommandPalette />
          </div>

          <nav aria-label="Admin sections" className="mt-6 space-y-6 text-sm">
            <NavGroup label="Model">
              <NavLink href="/admin" badge={counts.todayQueue}>
                Today&rsquo;s queue
              </NavLink>
              <NavLink href="/admin/overrides" badge={counts.overrideInbox}>
                Override inbox
              </NavLink>
              <NavLink href="/admin/customer-flags" badge={counts.customerFlags}>
                Customer flags
              </NavLink>
              <NavLink href="/admin/queue">Queue (full)</NavLink>
              <NavLink href="/admin/model" badge={counts.library}>
                Library
              </NavLink>
              <NavLink href="/admin/suggestions">Suggestions</NavLink>
              <NavLink href="/admin/refinement-log">Refinement</NavLink>
              <NavLink href="/admin/rule-review">Override rates</NavLink>
              <NavLink href="/admin/calibration">Calibration</NavLink>
            </NavGroup>

            <NavGroup label="Pilots">
              <NavLink href="/admin/pilots">Tracker</NavLink>
              <NavLink href="/admin/costs">Costs</NavLink>
              <NavLink href="/admin/costs/margin">Margin</NavLink>
            </NavGroup>

            <NavGroup label="Reports">
              <NavLink href="/admin/reports">Reports</NavLink>
            </NavGroup>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
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

function NavLink({
  href,
  children,
  badge,
}: {
  href: string;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md px-2 py-1 text-default hover:bg-hover hover:text-strong"
      >
        <span>{children}</span>
        {badge && badge > 0 ? (
          <Pill tone="neutral" size="xs">
            {badge}
          </Pill>
        ) : null}
      </Link>
    </li>
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
