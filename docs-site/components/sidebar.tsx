/**
 * Server component sidebar — reads the standards library at build time
 * to render the category nav. No client-side state, no hydration cost.
 */

import Link from "next/link";
import { loadLibrary } from "@/lib/standards";

export function Sidebar() {
  const lib = loadLibrary();
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
        <li>
          <Link
            href="/model"
            className="block rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            The content model
          </Link>
          <ul className="mt-1 ml-4 space-y-0.5">
            <li>
              <Link
                href="/model/changelog"
                className="block rounded px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-900"
              >
                Changelog
              </Link>
            </li>
          </ul>
        </li>
        <li>
          <Link
            href="/spec"
            className="block rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            Spec overview
          </Link>
        </li>
        <li>
          <Link
            href="/spec/content-types"
            className="block rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            Content types
          </Link>
        </li>
        <li>
          <Link
            href="/spec/moments"
            className="block rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            Moments
          </Link>
        </li>
      </ul>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Standards
      </p>
      <ul className="mb-6 space-y-3">
        {lib.categories.map((cat) => (
          <li key={cat.id}>
            <Link
              href={`/spec/standards#${cat.id}`}
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 dark:text-neutral-300"
            >
              {cat.name}
            </Link>
            <ul className="mt-1 space-y-0.5 pl-2">
              {cat.standards.map((std) => (
                <li key={std.id}>
                  <Link
                    href={`/spec/standards/${std.id}`}
                    className="block rounded px-1 py-0.5 font-mono text-[11px] text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
                  >
                    {std.id}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
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
      <p className="mt-6 text-[10px] text-neutral-500">
        Library v{lib.version} · {lib.total_standards} standards
      </p>
    </nav>
  );
}
