/**
 * Site header — global chrome for marketing + transactional pages.
 *
 * Renders the ContentRX logo (always links home) plus the primary
 * cross-page nav (Pricing, Install, Sign in, Try free). Lives
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
import { Wordmark } from "@/components/wordmark";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-raised">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Wordmark size="sm" />
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link
            href="/pricing"
            className="text-quiet hover:text-strong"
          >
            Pricing
          </Link>
          <Link
            href="/install"
            className="text-quiet hover:text-strong"
          >
            Install
          </Link>
          <Link
            href="/sign-in"
            className="text-quiet hover:text-strong"
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
