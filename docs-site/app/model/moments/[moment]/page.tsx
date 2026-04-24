/**
 * /model/moments/[moment] — per-moment permalink.
 *
 * Human-eval build plan Session 20. SSG'd page for each of the 13
 * moments. Shows the moment's description, its situation property (if
 * any), its weight modifiers against specific standards, and any
 * examples corpus pairs tagged with this moment.
 *
 * Data sources: `loadMoments()` for the taxonomy + weights,
 * `loadLibrary()` to resolve standard IDs to their rules,
 * `loadExamples()` for attribution-bearing before/after pairs.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  SITUATION_PROPERTY_LABELS,
  allMomentIds,
  getMoment,
  type MomentWeight,
} from "@/lib/moments";
import { getStandard } from "@/lib/standards";
import { examplesForMoment, type ExamplePair } from "@/lib/examples";

type Params = { moment: string };

export function generateStaticParams(): Params[] {
  return allMomentIds().map((moment) => ({ moment }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { moment } = await params;
  const m = getMoment(moment);
  if (!m) return { title: "Not found · ContentRX docs" };
  return {
    title: `${m.id} · ContentRX model`,
    description: m.description,
  };
}

export default async function MomentPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { moment } = await params;
  const m = getMoment(moment);
  if (!m) notFound();

  const weightsByModifier: Record<string, MomentWeight[]> = {
    emphasize: [],
    relax: [],
    suppress: [],
  };
  for (const w of m.weights) {
    (weightsByModifier[w.modifier] ??= []).push(w);
  }

  const examples = examplesForMoment(m.id);

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Moment
      </p>
      <h1>
        <code>{m.id}</code>
      </h1>
      <p className="text-lg">{m.description}</p>

      {m.situation_property && (
        <p>
          <span className="rounded-full border border-neutral-400 bg-neutral-100 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
            {SITUATION_PROPERTY_LABELS[m.situation_property] ??
              m.situation_property}
          </span>
        </p>
      )}

      {m.weights.length === 0 ? (
        <section>
          <h2>Weights</h2>
          <p>
            No standards are weighted specifically for this moment.
            Evaluation falls back to the default.
          </p>
        </section>
      ) : (
        <section>
          <h2>Weights</h2>
          <p>
            ContentRX adjusts how strictly each standard is enforced in
            this moment. Cross-reference any standard by its ID to read
            the full rule.
          </p>
          {(["emphasize", "relax", "suppress"] as const).map((mod) => {
            const entries = weightsByModifier[mod] ?? [];
            if (entries.length === 0) return null;
            return (
              <WeightGroup key={mod} modifier={mod} entries={entries} />
            );
          })}
        </section>
      )}

      {examples.length > 0 && (
        <section>
          <h2>Example pairs</h2>
          <p>
            Concrete &quot;this, not that&quot; examples observed in{" "}
            {new Set(examples.map((e) => e.source_system)).size} style
            guides. Attribution is inline — see{" "}
            <Link href="/ethics">/ethics</Link> for the commitment and{" "}
            <Link href="/sources">/sources</Link> for the full list.
          </p>
          <ul className="not-prose space-y-4">
            {examples.map((ex) => (
              <ExampleCard key={ex.pair_id} example={ex} />
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

function WeightGroup({
  modifier,
  entries,
}: {
  modifier: "emphasize" | "relax" | "suppress";
  entries: MomentWeight[];
}) {
  const title =
    modifier === "emphasize"
      ? "Emphasized — flag more aggressively"
      : modifier === "relax"
        ? "Relaxed — minor deviations acceptable"
        : "Suppressed — rarely applies here";
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {entries.map((w) => {
          const std = getStandard(w.standard_id);
          return (
            <li key={w.standard_id}>
              <Link href={`/model/standards/${w.standard_id}`}>
                <code>{w.standard_id}</code>
              </Link>
              {std ? ` — ${std.rule}` : null}
              <br />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                {w.rationale}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExampleCard({ example }: { example: ExamplePair }) {
  return (
    <li className="rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-neutral-500">
        <span>
          <Link href={`/model/standards/${example.standard_id}`}>
            <code>{example.standard_id}</code>
          </Link>{" "}
          · {example.content_type}
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
