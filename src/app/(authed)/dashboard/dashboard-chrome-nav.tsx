"use client";

/**
 * Dashboard chrome nav — the top-right cluster (Admin / Settings /
 * Sign out). Lives at the right edge of the dashboard layout header.
 *
 * Split out as a client component on 2026-05-14 so `usePathname()` can
 * drive `aria-current="page"` on Settings when the user is on
 * `/dashboard/settings/*`. The previous server-component version had
 * no way to signal "you are here," even though Settings has been
 * promoted to a real surface with its own subpages (overage, billing,
 * api keys, delete account).
 *
 * The chrome links also wear explicit design-system focus rings now —
 * the browser default outline on `bg-canvas` was inconsistent and
 * sometimes invisible (WCAG 2.4.7).
 */

import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

const chromeLinkBase =
  "rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function DashboardChromeNav({ isFounder }: { isFounder: boolean }) {
  const pathname = usePathname();
  const onSettings = pathname.startsWith("/dashboard/settings");

  return (
    <nav aria-label="Account" className="flex items-center gap-5 text-xs">
      {isFounder && (
        <Link
          href="/admin"
          className={`${chromeLinkBase} border border-line-strong px-2 py-0.5 font-medium text-default hover:bg-raised`}
        >
          Founder dashboard →
        </Link>
      )}
      <Link
        href="/dashboard/settings"
        aria-current={onSettings ? "page" : undefined}
        className={`${chromeLinkBase} ${
          onSettings ? "text-strong font-medium" : "text-quiet hover:text-strong"
        }`}
      >
        Settings
      </Link>
      <SignOutButton>
        <button
          type="button"
          className={`${chromeLinkBase} text-quiet hover:text-strong`}
        >
          Sign out
        </button>
      </SignOutButton>
    </nav>
  );
}
