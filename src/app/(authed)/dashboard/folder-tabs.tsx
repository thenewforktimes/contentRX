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
    label: "Github runs",
    // Match both the index and per-run pages so /dashboard/runs/<id>
    // keeps the tab highlighted. Earlier label was "CI runs"; renamed
    // to name the surface explicitly so engineers reach for it from
    // PR-comment context. "Action" elided for character economy —
    // anyone who ran the Action knows what they did.
    match: (p) => p.startsWith("/dashboard/runs"),
  },
  {
    href: "/dashboard/overrides",
    // Earlier label was "Override report" — internal vocabulary
    // (`violation_overrides` is the table name). Customers don't
    // think in terms of "overrides"; they think in terms of "which
    // rules keep getting dismissed?" The page is a tuning tool, so
    // "Rule patterns" frames the data correctly without conflating
    // with the configurative "Team rules" tab next door.
    //
    // URL stays /dashboard/overrides for stability — the table name
    // and route path are internal plumbing; the visible label is
    // what changes.
    label: "Rule patterns",
    match: (p) => p.startsWith("/dashboard/overrides"),
  },
  {
    href: "/dashboard/rules",
    label: "Team rules",
    match: (p) => p.startsWith("/dashboard/rules"),
  },
  {
    // Phase G3 — the weekly review agent install + preview surface.
    href: "/dashboard/agent",
    label: "Weekly agent",
    match: (p) => p.startsWith("/dashboard/agent"),
  },
  {
    // Per ADR 2026-05-11 the explicit-share calibration surface. Lists
    // every check the customer has shared via Flag for Review, plus
    // the revocation path. Visible to all plans (the consent contract
    // applies to every paying customer).
    href: "/dashboard/shared",
    label: "Shared checks",
    match: (p) => p.startsWith("/dashboard/shared"),
  },
];

export function FolderTabs() {
  const pathname = usePathname();
  return (
    // The nav wrapper owns the horizontal "shelf line" (border-b)
    // that runs across the full width below the tabs. Tabs sit on
    // top of that line:
    //   - inactive tabs: top + side borders only; bottom edge ends
    //     exactly at the shelf line (the line is the inactive tab's
    //     "floor")
    //   - active tab: same borders + `-mb-px` overlap so its
    //     bg-raised paints OVER the shelf line, hiding it directly
    //     beneath the active tab. The body below has no top border,
    //     so the active tab's bg-raised flows seamlessly into the
    //     body's bg-raised.
    //
    // This was redesigned from an earlier attempt that used
    // border-b-transparent on the active tab — that left the body's
    // top border visible right under the active tab, breaking the
    // merge. The shelf-line model keeps the line where it should be
    // (between inactive tabs and the body) and removes it where it
    // shouldn't be (under the active tab).
    <div className="border-b border-line">
      <nav
        aria-label="Dashboard sections"
        className="flex gap-1 overflow-x-auto pt-2"
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
                  ? "relative z-10 -mb-px whitespace-nowrap rounded-t-md border-x border-t border-line bg-raised px-4 py-2.5 text-sm font-medium text-strong"
                  : "whitespace-nowrap rounded-t-md border-x border-t border-line bg-canvas px-4 py-2.5 text-sm text-default hover:bg-raised hover:text-strong"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * The folder body — pairs with `<FolderTabs />`. Renders the
 * surrounding container that hangs off the bottom of the tabs' shelf
 * line.
 *
 * Borders intentionally only on left + right + bottom. The TOP edge
 * is handled by FolderTabs' shelf line (`border-b border-line` on
 * the nav wrapper). The bg-raised vs page bg-canvas surface
 * difference is what visually distinguishes the body's top edge from
 * the page above. The active tab's -mb-px overlap hides the shelf
 * line directly beneath itself; everywhere else the shelf line is
 * visible, completing the body's top boundary.
 */
export function FolderBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-b-lg border-x border-b border-line bg-raised p-6 sm:p-8">
      {children}
    </div>
  );
}
