"use client";

/**
 * Dashboard folder-tab navigation.
 *
 * The visual metaphor is a stack of paper folders. Each tab is a
 * folder spine; clicking a tab brings that folder to the front and
 * its content is what shows beneath. The active tab visually merges
 * with the folder body below (no bottom border), so the active tab
 * and the body read as a single continuous shape. Inactive tabs sit
 * one layer back — a darker surface, fully bordered, separated from
 * the body by a hairline.
 *
 * Why this beats a top-anchored nav strip: the previous design had
 * the nav floating above the page content with no visual relationship
 * to anything below it. The eye read the bar as orphaned chrome. With
 * folder tabs, the active tab IS the page header — the user knows
 * exactly which "folder" they're in because its tab is the only one
 * that opens into the body.
 *
 * Surface token layering (works in both light + dark):
 *   page:           bg-canvas (warm cream / deep navy)
 *   folder body:    bg-raised (white / lighter navy) — pops against canvas
 *   active tab:     bg-raised — same as folder body, merges seamlessly
 *   inactive tabs:  bg-canvas — recessed, blends with the page background
 *
 * Mobile / narrow screens: the nav scrolls horizontally with momentum.
 * Folders don't wrap to a second row in real life either — that would
 * break the metaphor.
 *
 * The component is a Client Component because it needs `usePathname()`
 * to know which tab is active. The tab list itself is a static const,
 * not a prop, so the layout doesn't have to thread it through.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: ReadonlyArray<{
  href: string;
  label: string;
  /** Active when the predicate returns true for the current path. */
  match: (pathname: string) => boolean;
}> = [
  {
    href: "/dashboard",
    label: "Overview",
    // /dashboard/explain is the inline check-detail view reached
    // from the Try-a-check panel on Overview. Keep Overview lit when
    // the user is in that flow so the breadcrumb context doesn't
    // disappear.
    match: (p) => p === "/dashboard" || p.startsWith("/dashboard/explain"),
  },
  {
    href: "/dashboard/checks",
    label: "Check history",
    match: (p) => p.startsWith("/dashboard/checks"),
  },
  {
    href: "/dashboard/runs",
    label: "CI runs",
    // Match both the index and per-run pages so /dashboard/runs/<id>
    // keeps the tab highlighted.
    match: (p) => p.startsWith("/dashboard/runs"),
  },
  {
    href: "/dashboard/overrides",
    label: "Override report",
    match: (p) => p.startsWith("/dashboard/overrides"),
  },
  {
    href: "/dashboard/rules",
    label: "Team rules",
    match: (p) => p.startsWith("/dashboard/rules"),
  },
];

export function FolderTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Dashboard sections"
      // -mb-px lets the active tab's bottom edge overlap the folder
      // body's top border by 1px, so the seam disappears. The relative
      // wrapper + z-10 on the active tab ensures the active tab paints
      // above the folder body's border.
      className="-mb-px flex gap-1 overflow-x-auto px-1 pt-2"
    >
      {TABS.map((tab) => {
        const isActive = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? // Active tab — merges with the folder body. Note no
                  // bottom border (the body's top border is what the
                  // eye sees, and the active tab's -mb-px lap covers
                  // it directly behind the tab).
                  "relative z-10 whitespace-nowrap rounded-t-md border border-line border-b-transparent bg-raised px-4 py-2.5 text-sm font-medium text-strong"
                : // Inactive tab — recessed. bg-canvas is the page
                  // background, so the tab "blends back" into the
                  // page surface. On hover it lifts to the same
                  // surface as the folder body.
                  "whitespace-nowrap rounded-t-md border border-line bg-canvas px-4 py-2.5 text-sm text-default hover:bg-raised hover:text-strong"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The folder body — pairs with `<FolderTabs />`. Renders the
 * surrounding container that the active tab visually merges into.
 *
 * Two structural notes:
 *   - `rounded-tl-none` so the top-left corner is square; the active
 *     "Overview" tab sits there. If the active tab is anywhere else,
 *     visually the seam still lands cleanly because every tab has the
 *     same height and the body's top border runs the full width
 *     behind the inactive tabs.
 *   - The body sets its own bg-raised so the active tab's matching
 *     bg-raised reads as a continuous surface.
 */
export function FolderBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg rounded-tl-none border border-line bg-raised p-6 sm:p-8">
      {children}
    </div>
  );
}
