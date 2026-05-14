"use client";

/**
 * AdminNavLink — sidebar rail link with `aria-current="page"` + active
 * visual treatment when the current pathname matches.
 *
 * Extracted as a client component on 2026-05-14 so the admin sidebar
 * can drive active-state from `usePathname()`. The previous inline
 * NavLink in `layout.tsx` was server-only and had no way to signal
 * "you are here" — a founder navigating 14 rail items got nothing but
 * `text-default` everywhere and could only know their location from
 * the page heading. WCAG 2.4.8 AAA + general "where am I" affordance.
 *
 * Match semantics:
 *   - For `/admin` (the index), match strictly (===)
 *   - For nested routes, match on `startsWith(href)` so deep links
 *     (e.g. /admin/calibration/2026-19) still light up Calibration
 *
 * The active state lifts the background to `bg-raised` (matching the
 * folder-tabs active treatment) plus `text-strong` + `font-medium`.
 * Focus ring + hover-only-when-inactive avoids the "active item
 * highlights on hover and looks broken" double-state.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pill } from "@/components/ui/pill";

export function AdminNavLink({
  href,
  children,
  badge,
}: {
  href: string;
  children: React.ReactNode;
  badge?: number;
}) {
  const pathname = usePathname();
  const isActive =
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const baseClass =
    "flex items-center justify-between rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
  const stateClass = isActive
    ? "bg-raised text-strong font-medium"
    : "text-default hover:bg-hover hover:text-strong";

  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`${baseClass} ${stateClass}`}
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
