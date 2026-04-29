/**
 * Site header — global chrome for marketing + transactional pages.
 *
 * Renders the ContentRX logo (always links home) plus the primary
 * cross-page nav (Pricing, Install, About, Sign in, Try free). Lives
 * in the (marketing) route group's layout; doesn't render on the
 * dashboard (which has its own header in (authed)/dashboard/layout)
 * or on /admin (founder voice keeps its own dense layout).
 *
 * Mobile: nav collapses to a thinner row that wraps. No hamburger
 * menu yet — the link set is small enough that wrapping is fine.
 * Revisit if the nav grows past 5 items.
 *
 * The "Try free" CTA uses the primary button style (emerald per the
 * Calm Sage palette). "Sign in" is a ghost link to keep the right
 * side from feeling button-heavy.
 */

import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight"
          aria-label="ContentRX home"
        >
          ContentRX
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link
            href="/pricing"
            className="text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
          >
            Pricing
          </Link>
          <Link
            href="/install"
            className="text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
          >
            Install
          </Link>
          <Link
            href="/about"
            className="text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
          >
            About
          </Link>
          <Link
            href="/sign-in"
            className="text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className={buttonStyles({ variant: "primary", size: "sm" })}
          >
            Try free
          </Link>
        </nav>
      </div>
    </header>
  );
}
