/**
 * /model/standards/[id] — per-standard permalink.
 *
 * Human-eval build plan Session 20. Canonical URL for each of the 47
 * standards. Pre-renders at build via `generateStaticParams()`.
 *
 * Surfaces everything the committed data carries:
 *   - rule text + type (hard/nuanced)
 *   - pass/fail examples from the standards library
 *   - relevant content types + per-type notes (Session 16)
 *   - moments that weight this standard (from moments_taxonomy.json)
 *   - examples corpus pairs for this standard (Session 16)
 *   - sources / attribution (Session 16)
 *   - current version + version_history changelog (Session 1)
 *   - sibling standards in the same category (cross-reference)
 *
 * The moment in the URL is not part of the canonical path because a
 * standard can be weighted in multiple moments — the spec's literal
 * pattern `/model/moments/<moment>/standards/<id>` would require an
 * arbitrary primary-moment choice or a 13 × 47 page explosion. Moment
 * pages cross-link here with the moment context shown inline.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  SITUATION_PROPERTY_LABELS,
  momentsWeightingStandard,
} from "@/lib/moments";
import {
  allStandardIds,
  categoryOfStandard,
  categorySiblings,
  getStandard,
  loadLibrary,
  type VersionHistoryEntry,
} from "@/lib/standards";
import { examplesForStandard, type ExamplePair } from "@/lib/examples";

type Params = { id: string };

export function generateStaticParams(): Params[] {
  return allStandardIds().map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const std = getStandard(id);
  if (!std) return { title: "Not found · ContentRX docs" };
  return {
    title: `${std.id} · ContentRX model`,
    description: std.rule,
  };
}

export default async function StandardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const std = getStandard(id);
  if (!std) notFound();

  const category = categoryOfStandard(id);
  const lib = loadLibrary();
  const contentTypes = lib.content_types;
  const weightedIn = momentsWeightingStandard(id);
  const examples = examplesForStandard(id);
  const siblings = categorySiblings(id);

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {category?.name ?? "Standard"}
        {std.rule_type ? ` · ${std.rule_type}` : null}
        {std.version ? ` · v${std.version}` : null}
      </p>
      <h1>
        <code>{std.id}</code>
      </h1>
      <p className="text-lg">{std.rule}</p>

      {std.correct && (
        <section>
          <h2>Pass example</h2>
          <blockquote className="not-italic">{std.correct}</blockquote>
        </section>
      )}

      {std.incorrect && (
        <section>
          <h2>Fail example</h2>
          <blockquote className="not-italic">{std.incorrect}</blockquote>
        </section>
      )}

      {std.relevant_content_types && std.relevant_content_types.length > 0 && (
        <section>
          <h2>Relevant content types</h2>
          <ul>
            {std.relevant_content_types.map((ctId) => {
              const ct = contentTypes.find((t) => t.id === ctId);
              return (
                <li key={ctId}>
                  <Link href={`/spec/content-types#${ctId}`}>
                    {ct?.name ?? ctId}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {std.content_type_notes &&
        Object.keys(std.content_type_notes).length > 0 && (
          <section>
            <h2>Notes by content type</h2>
            <dl>
              {Object.entries(std.content_type_notes).map(([key, note]) => {
                const label =
                  key === "_global"
                    ? "All content types"
                    : (contentTypes.find((t) => t.id === key)?.name ?? key);
                return (
                  <div key={key}>
                    <dt className="font-semibold">{label}</dt>
                    <dd>{note}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        )}

      {weightedIn.length > 0 && (
        <section>
          <h2>Weighted in these moments</h2>
          <p>
            This standard behaves differently depending on the reader&apos;s
            moment. Moment-aware evaluation picks one of these
            adjustments when the moment matches.
          </p>
          <ul>
            {weightedIn.map(({ moment, weight }) => (
              <li key={moment.id}>
                <Link href={`/model/moments/${moment.id}`}>
                  <code>{moment.id}</code>
                </Link>
                {moment.situation_property ? (
                  <>
                    {" "}
                    <span className="rounded-full border border-neutral-400 bg-neutral-100 px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wide text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                      {SITUATION_PROPERTY_LABELS[moment.situation_property] ??
                        moment.situation_property}
                    </span>
                  </>
                ) : null}{" "}
                — <em>{weight.modifier}</em>
                <br />
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  {weight.rationale}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {examples.length > 0 && (
        <section>
          <h2>Example pairs</h2>
          <p>
            Concrete before/after pairs observed in public style guides,
            each with inline attribution. See{" "}
            <Link href="/sources">/sources</Link> for the full source
            list and licensing.
          </p>
          <ul className="not-prose space-y-4">
            {examples.map((ex) => (
              <ExampleCard key={ex.pair_id} example={ex} />
            ))}
          </ul>
        </section>
      )}

      {std.sources && std.sources.length > 0 && (
        <section>
          <h2>Sources</h2>
          <p>
            Style guides that shaped this standard. Each is listed on{" "}
            <Link href="/sources">/sources</Link> with its license and
            opt-out path.
          </p>
          <ul>
            {std.sources.map((src) => (
              <li key={src}>{src}</li>
            ))}
          </ul>
        </section>
      )}

      {std.version_history && std.version_history.length > 0 && (
        <section>
          <h2>Version history</h2>
          <VersionHistoryList entries={std.version_history} />
        </section>
      )}

      {siblings.length > 0 && (
        <section>
          <h2>Related standards</h2>
          <p>
            Other standards in the <em>{category?.name}</em> category.
          </p>
          <ul>
            {siblings.map((s) => (
              <li key={s.id}>
                <Link href={`/model/standards/${s.id}`}>
                  <code>{s.id}</code>
                </Link>{" "}
                — {s.rule}
              </li>
            ))}
          </ul>
        </section>
      )}

      <hr />
      <p className="text-sm">
        <Link href="/model">← The content model</Link>
      </p>
    </>
  );
}

function VersionHistoryList({ entries }: { entries: VersionHistoryEntry[] }) {
  const sorted = [...entries].sort((a, b) => {
    if (a.date === b.date) return a.version.localeCompare(b.version);
    return b.date.localeCompare(a.date);
  });
  return (
    <ol className="not-prose space-y-3 text-sm">
      {sorted.map((entry) => (
        <li
          key={`${entry.version}-${entry.date}`}
          className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
        >
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            v{entry.version} · {entry.date}
          </p>
          <p className="mt-1 text-neutral-700 dark:text-neutral-300">
            {entry.change_note}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ExampleCard({ example }: { example: ExamplePair }) {
  return (
    <li className="rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
        <span>
          {example.moment} · {example.content_type}
        </span>
        <span className="font-mono">{example.license}</span>
      </div>
      <p className="mt-3">
        <strong className="text-red-700 dark:text-red-400">Not this.</strong>{" "}
        <span className="text-neutral-700 dark:text-neutral-300">
          {example.not_this}
        </span>
      </p>
      <p className="mt-1">
        <strong className="text-green-700 dark:text-green-400">But this.</strong>{" "}
        <span className="text-neutral-700 dark:text-neutral-300">
          {example.but_this}
        </span>
      </p>
      <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
        {example.rationale}{" "}
        <span className="text-neutral-500">
          — {example.source_system}
          {example.source_section ? ` · ${example.source_section}` : null}
        </span>
      </p>
    </li>
  );
}
