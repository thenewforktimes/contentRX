"use client";

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
 *
 * 2026-05-14 — Converted to "use client" so `usePathname()` can drive
 * aria-current="page" on the matching nav link (WCAG 2.4.8 AAA, plus
 * a visible cue for sighted users — currently they could land on
 * /pricing from a deep link and have no header-level signal that
 * they're already there). FolderTabs uses the same pattern.
 *
 * `visited:` is locked to match `:link` on the global chrome nav.
 * Visited distinction here would be wrong — these links are permanent
 * navigation, not body-prose references. The lock prevents browser
 * default purple visited from creeping in on tinted backgrounds.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/install", label: "Install" },
  { href: "/sign-in", label: "Sign in" },
] as const;

const navLinkBase =
  "rounded transition-colors visited:text-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-raised";

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-raised">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Wordmark size="xs" />
        {/*
         * `aria-label="Primary"` (WCAG 2.4.6) distinguishes this nav
         * from the footer nav for screen-reader users navigating by
         * landmark.
         *
         * Link focus ring (WCAG 2.4.7): bare links on bg-raised were
         * relying on the browser default focus outline, which is
         * unreliable on tinted backgrounds. Now every link wears the
         * design-system focus ring explicitly.
         *
         * aria-current="page" (WCAG 2.4.8 AAA): pathname match flips
         * the link to text-strong + font-medium so sighted users see
         * the active page, and AT announces "current page" for the
         * matching link.
         */}
        <nav
          aria-label="Primary"
          className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
        >
          {NAV_LINKS.map((link) => {
            const isCurrent = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isCurrent ? "page" : undefined}
                className={`${navLinkBase} ${
                  isCurrent
                    ? "text-strong font-medium"
                    : "text-quiet hover:text-strong"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
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
