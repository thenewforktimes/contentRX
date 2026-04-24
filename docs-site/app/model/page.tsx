/**
 * /model — the content model as a browsable asset.
 *
 * Human-eval build plan Session 20. Three-level taxonomy landing
 * page: 13 moments as cards on top (with situation-property tags for
 * destructive / permission-gated / compliance), a category-grouped
 * link list of all 47 standards below, and a client-side search box
 * covering standard IDs + rule text + category names.
 *
 * Data source: `loadMoments()` and `loadLibrary()`. No hand-
 * maintained lists — the page regenerates on every deploy from the
 * committed canonical JSON.
 *
 * The page is a Server Component; the search box is the only client
 * island.
 */

import Link from "next/link";
import type { Metadata } from "next";
import {
  SITUATION_PROPERTY_LABELS,
  loadMoments,
  type Moment,
} from "@/lib/moments";
import { loadLibrary } from "@/lib/standards";
import { StandardsSearch, type SearchItem } from "./standards-search";

export const metadata: Metadata = {
  title: "The content model · ContentRX docs",
  description:
    "13 moments, 47 standards, 8 content types. Browsable, linkable, permalinked per standard.",
};

export default function ModelIndexPage() {
  const moments = loadMoments();
  const lib = loadLibrary();

  const searchItems: SearchItem[] = lib.categories.flatMap((cat) =>
    cat.standards.map((std) => ({
      id: std.id,
      rule: std.rule,
      categoryName: cat.name,
    })),
  );

  return (
    <>
      <h1>The content model</h1>
      <p className="text-lg">
        {moments.total_moments} moments, {lib.total_standards} standards,{" "}
        {lib.content_types.length} content types. The full taxonomy
        ContentRX uses to evaluate product copy — browsable, permalinked,
        claimable.
      </p>

      <p>
        Start with the moment (where the reader is), drill to the
        standards (what rules apply), or search for the specific ID
        you&apos;re being flagged on.
      </p>

      <section>
        <h2>Find a standard</h2>
        <StandardsSearch items={searchItems} />
      </section>

      <section>
        <h2>13 moments</h2>
        <p>
          Moments encode the reader&apos;s situation. The same sentence
          lands differently in <em>destructive action</em> than in{" "}
          <em>browsing discovery</em> — moment-aware evaluation is the
          core of the model.
        </p>
        <ul className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-2">
          {moments.moments.map((m) => (
            <MomentCard key={m.id} moment={m} />
          ))}
        </ul>
      </section>

      <section>
        <h2>All standards by category</h2>
        <p>
          Every standard has a permalink at{" "}
          <code>/model/standards/&lt;id&gt;</code>. Each page carries
          the rule, pass/fail examples, content-type applicability,
          moment weights, attribution, and version history.
        </p>
        {lib.categories.map((cat) => (
          <section key={cat.id}>
            <h3 id={cat.id}>{cat.name}</h3>
            <ul>
              {cat.standards.map((std) => (
                <li key={std.id}>
                  <Link href={`/model/standards/${std.id}`}>
                    <code>{std.id}</code>
                  </Link>{" "}
                  — {std.rule}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>

      <hr />
      <p className="text-sm text-neutral-500">
        Library v{lib.version} · moments schema v
        {moments.schema_version}. Canonical sources:{" "}
        <a href="https://github.com/thenewforktimes/contentRX/blob/main/src/content_checker/standards/standards_library.json">
          standards_library.json
        </a>
        ,{" "}
        <a href="https://github.com/thenewforktimes/contentRX/blob/main/src/content_checker/moments.py">
          moments.py
        </a>
        ,{" "}
        <a href="https://github.com/thenewforktimes/contentRX/blob/main/evals/examples_corpus/pairs.json">
          examples corpus
        </a>
        .
      </p>
    </>
  );
}

function MomentCard({ moment }: { moment: Moment }) {
  return (
    <li className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline gap-2">
        <Link
          href={`/model/moments/${moment.id}`}
          className="font-mono text-sm font-semibold text-neutral-900 underline-offset-2 hover:underline dark:text-neutral-100"
        >
          {moment.id}
        </Link>
        {moment.situation_property && (
          <span className="rounded-full border border-neutral-400 bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
            {SITUATION_PROPERTY_LABELS[moment.situation_property] ??
              moment.situation_property}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        {moment.description}
      </p>
      <p className="mt-3 text-xs text-neutral-500">
        {moment.weights.length === 0
          ? "Default evaluation"
          : `${moment.weights.length} weighted standard${moment.weights.length === 1 ? "" : "s"}`}
      </p>
    </li>
  );
}
