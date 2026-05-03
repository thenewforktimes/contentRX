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
import { Pill } from "@/components/ui/pill";
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
            className="text-stone-600 hover:underline dark:text-stone-400"
          >
            ← Back to model
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="font-mono text-xl text-stone-900 dark:text-stone-100">
            {standard.id}
          </h1>
          <span className="font-mono text-xs text-stone-500 dark:text-stone-400">
            v{standard.version} · {standard.category_name} ({standard.category_id})
          </span>
          <Pill tone="neutral" size="xs" className="uppercase tracking-wide">
            {standard.rule_type}
          </Pill>
        </div>
        <p className="mt-3 text-sm text-stone-800 dark:text-stone-200">
          {standard.rule}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <ExampleBlock label="Pass" tone="pass" text={standard.correct} />
        <ExampleBlock label="Fail" tone="fail" text={standard.incorrect} />
      </section>

      {standard.relevant_content_types.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Relevant content types
          </h2>
          <ul className="flex flex-wrap gap-2">
            {standard.relevant_content_types.map((ct) => (
              <li key={ct}>
                <Pill tone="neutral">{ct}</Pill>
              </li>
            ))}
          </ul>
        </section>
      )}

      {Object.keys(standard.content_type_notes).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Content-type notes
          </h2>
          <dl className="space-y-3">
            {Object.entries(standard.content_type_notes).map(([ct, note]) => (
              <div
                key={ct}
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
              >
                <dt className="font-mono text-xs text-stone-500 dark:text-stone-400">{ct}</dt>
                <dd className="mt-1 whitespace-pre-line text-sm text-stone-700 dark:text-stone-300">
                  {note}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {momentContexts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Moment context ({momentContexts.length})
          </h2>
          <ul className="space-y-2">
            {momentContexts.map(({ moment, weight }) => (
              <li
                key={moment.id}
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/admin/model/moments/${moment.id}`}
                    className="font-mono text-xs text-stone-700 hover:underline dark:text-stone-300"
                  >
                    {moment.id}
                  </Link>
                  <Pill
                    tone={
                      weight.modifier === "emphasize"
                        ? "emerald"
                        : weight.modifier === "relax"
                          ? "amber"
                          : "neutral"
                    }
                    size="xs"
                    className="uppercase tracking-wide"
                  >
                    {weight.modifier}
                  </Pill>
                </div>
                <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
                  {weight.rationale}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {standard.influences.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Influences
          </h2>
          <ul className="space-y-2">
            {standard.influences.map((inf, i) => (
              <li
                key={`${inf.source}-${i}`}
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {inf.source}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    {inf.direction}
                  </span>
                </div>
                {inf.note && (
                  <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Sources
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
            {standard.sources.map((src, i) => (
              <li key={`${src}-${i}`}>{src}</li>
            ))}
          </ul>
        </section>
      )}

      {standard.version_history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Version history
          </h2>
          <ol className="space-y-2">
            {standard.version_history.map((entry, i) => (
              <li
                key={`${entry.version}-${i}`}
                className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-stone-700 dark:text-stone-300">
                    v{entry.version}
                  </span>
                  {entry.date && (
                    <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                      {entry.date}
                    </span>
                  )}
                </div>
                {entry.change && (
                  <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
                    {entry.change}
                  </p>
                )}
                {entry.notes && (
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-500">
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
      : "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950";
  const labelTone =
    tone === "pass"
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-rose-800 dark:text-rose-300";
  return (
    <div className={`rounded-lg border p-3 ${classes}`}>
      <p
        className={`text-[10px] font-semibold uppercase tracking-wide ${labelTone}`}
      >
        {label}
      </p>
      <p className="mt-1 whitespace-pre-line text-sm text-stone-900 dark:text-stone-100">
        {text}
      </p>
    </div>
  );
}
