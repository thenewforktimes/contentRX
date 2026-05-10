/**
 * Server component sidebar.
 *
 * Post-pivot (ADR 2026-04-25): the docs site no longer renders the
 * standards library or the moment taxonomy by name. The public
 * surface is `/accuracy`, `/calibration`, `/essays`, and `/reports`
 * — the substrate-to-report pipeline output, not the substrate
 * itself. The sidebar links to the routes the docs site does ship.
 */

import Link from "next/link";

export function Sidebar() {
  return (
    <nav className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-6 text-sm md:block dark:border-neutral-800 dark:bg-neutral-950">
      <Link href="/" className="mb-6 block text-base font-semibold">
        ContentRX docs
      </Link>
      <ul className="mb-6 space-y-1">
        <li>
          <Link
            href="/guides"
            className="block rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            Guides
          </Link>
        </li>
      </ul>
      <ul className="space-y-1 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <li>
          <Link
            href="/whitepaper"
            className="block rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            Whitepaper
          </Link>
        </li>
        <li>
          <Link
            href="/contributing"
            className="block rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            Contributing
          </Link>
        </li>
      </ul>
    </nav>
  );
}
