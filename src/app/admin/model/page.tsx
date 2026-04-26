/**
 * `/admin/model` — browsable substrate (moments + standards).
 *
 * Phase B2 of the post-pivot rolling plan. Founder-only surface for
 * inspecting the private taxonomy. Auth is enforced by the parent
 * `src/app/admin/layout.tsx`.
 *
 * The page lists:
 *   - All 13 moments as cards, with their emphasize/relax/suppress
 *     counts.
 *   - All 9 categories of standards, each linking to per-standard
 *     detail pages at `/admin/model/standards/[id]`.
 *
 * Per the ADR (`decisions/2026-04-25-private-taxonomy-pivot.md`),
 * everything rendered here is substrate. This page must never end up
 * accessible to non-founders — the layout's `isContentRXAdmin()`
 * gate is load-bearing.
 */

import Link from "next/link";
import {
  getMomentsTaxonomy,
  getStandardsLibrary,
} from "@/lib/admin-substrate.server";

export const metadata = {
  title: "Model · ContentRX admin",
  description: "Browsable substrate — moments and standards.",
  robots: { index: false, follow: false },
};

export default function AdminModelPage() {
  const { moments } = getMomentsTaxonomy();
  const { categories, version, total_standards } = getStandardsLibrary();

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Model
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Browsable taxonomy. {moments.length} moments,{" "}
            {total_standards} standards across {categories.length} categories.
          </p>
        </div>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          library v{version}
        </span>
      </header>

      <section aria-labelledby="moments-heading" className="space-y-3">
        <h2
          id="moments-heading"
          className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          Moments
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {moments.map((m) => (
            <li key={m.id}>
              <Link
                href={`/admin/model/moments/${m.id}`}
                className="block h-full rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs text-neutral-500">
                    {m.id}
                  </span>
                  {m.situation_property && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                      {m.situation_property}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-neutral-900 dark:text-neutral-100">
                  {m.description}
                </p>
                <div className="mt-3 flex gap-3 text-xs text-neutral-600 dark:text-neutral-400">
                  <WeightCount label="emphasize" count={m.emphasized_count} />
                  <WeightCount label="relax" count={m.relaxed_count} />
                  <WeightCount label="suppress" count={m.suppressed_count} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="categories-heading" className="space-y-6">
        <h2
          id="categories-heading"
          className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          Standards
        </h2>
        {categories.map((cat) => (
          <article
            key={cat.id}
            className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <header className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {cat.name}
              </h3>
              <span className="font-mono text-xs text-neutral-500">
                {cat.id} · {cat.standards.length} standard
                {cat.standards.length === 1 ? "" : "s"}
              </span>
            </header>
            <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
              {cat.standards.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/model/standards/${s.id}`}
                    className="flex items-baseline gap-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <span className="w-16 shrink-0 font-mono text-xs text-neutral-500">
                      {s.id}
                    </span>
                    <span className="flex-1 text-neutral-800 dark:text-neutral-200">
                      {s.rule}
                    </span>
                    <span className="hidden font-mono text-[10px] text-neutral-400 sm:inline">
                      v{s.version}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}

function WeightCount({ label, count }: { label: string; count: number }) {
  if (count === 0) return null;
  return (
    <span>
      <span className="font-semibold text-neutral-800 dark:text-neutral-200">
        {count}
      </span>{" "}
      {label}
    </span>
  );
}
