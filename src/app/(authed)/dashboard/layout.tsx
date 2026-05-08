/**
 * Dashboard chrome — global wordmark + secondary nav strip.
 *
 * Two structural decisions:
 *
 * 1. **Wordmark consistency.** Earlier this layout hand-rolled a flat
 *    `<Link>ContentRX</Link>` text mark sized like the nav links next
 *    to it. The marketing pages use the proper `<Wordmark>` component
 *    (mark + two-tone letterforms + accent colour). Customers cross
 *    between dashboard and marketing constantly and the inconsistency
 *    read as identity drift. This layout now imports the same
 *    component. The Wordmark already wraps in `<Link href="/">` so
 *    clicking it goes to the home page, matching the SiteHeader
 *    behaviour.
 *
 * 2. **Secondary nav strip.** The dashboard root used to ship a row
 *    of inline `<Link>`s (Check history, CI runs, Override report,
 *    Team rules, Founder dashboard) jammed between content panels.
 *    They were doing navigation work but living like content. The
 *    strip is now part of the chrome — directly under the wordmark
 *    header, GitHub-repo-tabs style. Frees the dashboard body for
 *    actual work.
 *
 *    The strip is rendered for every /dashboard/* page so the
 *    sub-page navigation context never disappears.
 *
 * The Founder badge stays in the chrome but sits at the right edge of
 * the secondary nav strip. Non-founders never see it.
 */

import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { SiteFooter } from "@/components/site-footer";
import { Wordmark } from "@/components/wordmark";
import { isContentRXAdmin } from "@/lib/graduation";

const SECONDARY_NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/checks", label: "Check history" },
  { href: "/dashboard/runs", label: "CI runs" },
  { href: "/dashboard/overrides", label: "Override report" },
  { href: "/dashboard/rules", label: "Team rules" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Founders see an "Admin" link in the chrome alongside the secondary
  // nav. Cheap string comparison against CONTENTRX_ADMIN_CLERK_IDS.
  // Non-founders never see the link, never know /admin exists from
  // this surface.
  const { userId } = await auth();
  const isFounder = userId ? isContentRXAdmin(userId) : false;

  return (
    <div className="flex min-h-screen flex-col bg-raised">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-6 px-6 py-5">
          <Wordmark size="sm" />
          <nav className="flex items-center gap-5 text-xs">
            <Link
              href="/dashboard/settings"
              className="text-quiet hover:text-strong"
            >
              Settings
            </Link>
            <SignOutButton>
              <button
                type="button"
                className="text-quiet hover:text-strong"
              >
                Sign out
              </button>
            </SignOutButton>
          </nav>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 overflow-x-auto px-6">
            <nav
              aria-label="Dashboard sections"
              className="flex items-center gap-5 py-2 text-xs"
            >
              {SECONDARY_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap text-default hover:text-strong"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            {isFounder && (
              <Link
                href="/admin"
                className="my-1.5 whitespace-nowrap rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-default hover:bg-overlay"
              >
                Founder dashboard →
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
