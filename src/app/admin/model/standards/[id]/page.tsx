/**
 * `/admin/model/standards/[id]` — single standard detail.
 *
 * Phase B2 of the post-pivot rolling plan. Surfaces the full
 * substrate for one standard: rule, examples, version + version
 * history, sources, influences, content_type_notes, and the moment
 * context map (every moment that emphasizes / relaxes / suppresses
 * this standard, with rationale).
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMomentsTouchingStandard,
  getStandardById,
} from "@/lib/admin-substrate.server";

export const metadata = {
  title: "Standard · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminStandardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const standard = getStandardById(id);
  if (!standard) notFound();

  const momentContexts = getMomentsTouchingStandard(id);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs">
          <Link
            href="/admin/model"
            className="text-neutral-600 hover:underline dark:text-neutral-400"
          >
            ← Back to model
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="font-mono text-xl text-neutral-900 dark:text-neutral-100">
            {standard.id}
          </h1>
          <span className="font-mono text-xs text-neutral-500">
            v{standard.version} · {standard.category_name} ({standard.category_id})
          </span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            {standard.rule_type}
          </span>
        </div>
        <p className="mt-3 text-sm text-neutral-800 dark:text-neutral-200">
          {standard.rule}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <ExampleBlock label="Pass" tone="pass" text={standard.correct} />
        <ExampleBlock label="Fail" tone="fail" text={standard.incorrect} />
      </section>

      {standard.relevant_content_types.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Relevant content types
          </h2>
          <ul className="flex flex-wrap gap-2">
            {standard.relevant_content_types.map((ct) => (
              <li
                key={ct}
                className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {ct}
              </li>
            ))}
          </ul>
        </section>
      )}

      {Object.keys(standard.content_type_notes).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Content-type notes
          </h2>
          <dl className="space-y-3">
            {Object.entries(standard.content_type_notes).map(([ct, note]) => (
              <div
                key={ct}
                className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <dt className="font-mono text-xs text-neutral-500">{ct}</dt>
                <dd className="mt-1 whitespace-pre-line text-sm text-neutral-700 dark:text-neutral-300">
                  {note}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {momentContexts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Moment context ({momentContexts.length})
          </h2>
          <ul className="space-y-2">
            {momentContexts.map(({ moment, weight }) => (
              <li
                key={moment.id}
                className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/admin/model/moments/${moment.id}`}
                    className="font-mono text-xs text-neutral-700 hover:underline dark:text-neutral-300"
                  >
                    {moment.id}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      weight.modifier === "emphasize"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : weight.modifier === "relax"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {weight.modifier}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                  {weight.rationale}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {standard.influences.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Influences
          </h2>
          <ul className="space-y-2">
            {standard.influences.map((inf, i) => (
              <li
                key={`${inf.source}-${i}`}
                className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {inf.source}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-neutral-500">
                    {inf.direction}
                  </span>
                </div>
                {inf.note && (
                  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                    {inf.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {standard.sources.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Sources
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
            {standard.sources.map((src, i) => (
              <li key={`${src}-${i}`}>{src}</li>
            ))}
          </ul>
        </section>
      )}

      {standard.version_history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Version history
          </h2>
          <ol className="space-y-2">
            {standard.version_history.map((entry, i) => (
              <li
                key={`${entry.version}-${i}`}
                className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">
                    v{entry.version}
                  </span>
                  {entry.date && (
                    <span className="font-mono text-[10px] text-neutral-500">
                      {entry.date}
                    </span>
                  )}
                </div>
                {entry.change && (
                  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                    {entry.change}
                  </p>
                )}
                {entry.notes && (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
                    {entry.notes}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function ExampleBlock({
  label,
  tone,
  text,
}: {
  label: string;
  tone: "pass" | "fail";
  text: string;
}) {
  const classes =
    tone === "pass"
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
      : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950";
  const labelTone =
    tone === "pass"
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-red-800 dark:text-red-300";
  return (
    <div className={`rounded-lg border p-3 ${classes}`}>
      <p
        className={`text-[10px] font-semibold uppercase tracking-wide ${labelTone}`}
      >
        {label}
      </p>
      <p className="mt-1 whitespace-pre-line text-sm text-neutral-900 dark:text-neutral-100">
        {text}
      </p>
    </div>
  );
}
