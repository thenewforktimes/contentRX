/**
 * Dashboard chrome — global wordmark + folder-tab section navigation.
 *
 * Three structural decisions:
 *
 * 1. **Wordmark consistency.** The marketing pages use the proper
 *    `<Wordmark>` component (mark + two-tone letterforms + accent
 *    colour). This layout uses the same component so customers
 *    crossing between dashboard and marketing surfaces see one
 *    identity. The Wordmark wraps in `<Link href="/">` by default,
 *    so clicking it goes home — matching SiteHeader.
 *
 * 2. **Folder tabs replace the secondary nav strip.** Earlier this
 *    layout shipped a flat `<Link>`-row "tab" strip floating between
 *    the global header and the page content — chrome with no visual
 *    relationship to what was below it. The active tab now visually
 *    merges into a folder body container (bg-raised, rounded-lg with
 *    a square top-left corner), so the user reads the active tab as
 *    "this folder is open" instead of "miscellaneous links."
 *
 *    See ./folder-tabs.tsx for the visual / surface-token rationale.
 *
 * 3. **Founder badge moved to the global header chrome.** Earlier it
 *    sat at the right edge of the secondary nav strip — visually a
 *    peer of the section tabs. It isn't a peer; it's a role-switch.
 *    Now it lives in the global header next to Settings + Sign out,
 *    where role-switching belongs.
 *
 * Surface layering:
 *   outer:           bg-canvas (page bg)
 *   global header:   bg-canvas (continuous with page)
 *   folder body:     bg-raised (pops against canvas)
 *   active tab:      bg-raised (matches body, seamless merge)
 *   inactive tabs:   bg-canvas (recessed, blends with page)
 */

import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { SiteFooter } from "@/components/site-footer";
import { Wordmark } from "@/components/wordmark";
import { isContentRXAdmin } from "@/lib/graduation";
import { FolderBody, FolderTabs } from "./folder-tabs";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Founders see the "Admin" link in chrome alongside Settings + Sign
  // out. Cheap string comparison against CONTENTRX_ADMIN_CLERK_IDS;
  // non-founders never see it, never know /admin exists from this
  // surface.
  const { userId } = await auth();
  const isFounder = userId ? isContentRXAdmin(userId) : false;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-6 px-6 py-5">
          <Wordmark size="xs" />
          <nav className="flex items-center gap-5 text-xs">
            {isFounder && (
              <Link
                href="/admin"
                className="rounded-md border border-line-strong px-2 py-0.5 font-medium text-default hover:bg-raised"
              >
                Founder dashboard →
              </Link>
            )}
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
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-2 pb-10">
        <FolderTabs />
        <FolderBody>{children}</FolderBody>
      </main>
      <SiteFooter />
    </div>
  );
}
