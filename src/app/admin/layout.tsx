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
 * The single-user-by-design principle means this layout doesn't try
 * to model multi-tenant permissions. There's one role: founder.
 * Everyone else gets a 404.
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
        <div className="mx-auto max-w-6xl space-y-3">
          <Link
            href="/admin"
            className="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
          >
            ContentRX · Admin
          </Link>
          <nav
            aria-label="Admin sections"
            className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
          >
            <NavGroup label="Pilots">
              <NavLink href="/admin">Tracker</NavLink>
              <NavLink href="/admin/overrides">Override inbox</NavLink>
              <NavLink href="/admin/costs">Costs</NavLink>
            </NavGroup>
            <NavGroup label="Rules">
              <NavLink href="/admin/model">Library</NavLink>
              <NavLink href="/admin/rule-review">Override rates</NavLink>
              <NavLink href="/admin/suggestions">Suggestions</NavLink>
              <NavLink href="/admin/refinement-log">Refinement</NavLink>
              <NavLink href="/admin/queue">Review queue</NavLink>
            </NavGroup>
            <NavGroup label="Reports">
              <NavLink href="/admin/calibration">Calibration</NavLink>
              <NavLink href="/admin/reports">Reports</NavLink>
              <NavLink href="/admin/essay-drafts">Essay drafts</NavLink>
              <NavLink href="/admin/case-studies">Case studies</NavLink>
            </NavGroup>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-neutral-700 hover:underline dark:text-neutral-300"
    >
      {children}
    </Link>
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
