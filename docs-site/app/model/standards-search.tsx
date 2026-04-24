/**
 * Client-island search box for the /model landing page.
 *
 * Scope kept narrow on purpose: the `docs-site/CLAUDE.md` rule is
 * "every page is a Server Component" — this is not a page, it's a
 * small interactive sub-tree that the SSR'd landing page mounts.
 *
 * Takes a pre-rendered list of {id, rule, categoryName} as props (SSG
 * data, no network), filters on the client as the user types, and
 * renders plain links. Zero external state libraries, no autocomplete
 * magic, no fuzzy matching — a substring match is enough to answer
 * "the standard I'm being flagged on," which is the primary job.
 *
 * Human-eval build plan Session 20.
 */

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface SearchItem {
  id: string;
  rule: string;
  categoryName: string;
}

export function StandardsSearch({ items }: { items: SearchItem[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return items;
    return items.filter(
      (it) =>
        it.id.toLowerCase().includes(q) ||
        it.rule.toLowerCase().includes(q) ||
        it.categoryName.toLowerCase().includes(q),
    );
  }, [items, q]);

  return (
    <div className="not-prose">
      <label htmlFor="standards-search" className="sr-only">
        Search standards
      </label>
      <input
        id="standards-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search standards — try 'error', 'ACT', 'active voice'…"
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <p className="mt-2 text-xs text-neutral-500">
        {q
          ? `${filtered.length} of ${items.length} standards`
          : `${items.length} standards`}
      </p>
      {q && (
        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          {filtered.length === 0 ? (
            <li className="px-2 py-1 text-neutral-500">
              No standards match <q>{query}</q>.
            </li>
          ) : (
            filtered.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/model/standards/${it.id}`}
                  className="flex items-baseline gap-3 rounded px-2 py-1 hover:bg-white dark:hover:bg-neutral-950"
                >
                  <code className="shrink-0 font-mono text-xs text-neutral-700 dark:text-neutral-300">
                    {it.id}
                  </code>
                  <span className="truncate text-neutral-700 dark:text-neutral-300">
                    {it.rule}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
