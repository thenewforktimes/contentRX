/**
 * /model/changelog — public record of how the content model evolves.
 *
 * Human-eval build plan Session 23. Generates from two canonical
 * sources:
 *
 *   - `version_history` arrays from standards_library.json
 *     (per-standard Session-1 tracking).
 *   - `## Approved refinements` entries from taxonomy_refinement_log.md
 *     (human-curated; only the Approved section leaks public).
 *
 * The "last 30 days" window at the top enforces the plan's success
 * criterion that every recent taxonomy change surfaces as a
 * changelog entry. The CI guard in
 * `scripts/check_taxonomy_changelog.py` fails any PR that edits the
 * taxonomy without appending a version_history entry.
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  entriesWithinDays,
  loadChangelog,
  type ApprovedRefinementEntry,
  type ChangelogEntry,
  type StandardVersionEntry,
} from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Taxonomy changelog · ContentRX docs",
  description:
    "Every change to the content model — standards added, retired, or revised, plus approved refinements.",
};

const WINDOW_DAYS = 30;

export default function ChangelogPage() {
  const { entries, generated_at } = loadChangelog();
  const recent = entriesWithinDays(entries, WINDOW_DAYS, generated_at);
  const older = entries.filter((e) => !recent.includes(e));

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Taxonomy changelog
      </p>
      <h1>How the content model evolves</h1>
      <p className="text-lg">
        Every change ContentRX has published to the content model:
        standards added, retired, or revised; moments added or retired;
        approved refinements from the triage log. Each entry carries a
        date, a reason, and — where applicable — migration guidance for
        historical evaluations.
      </p>

      <p>
        Generated {formatDate(generated_at)} from{" "}
        <a href="https://github.com/thenewforktimes/contentRX/blob/main/src/content_checker/standards/standards_library.json">
          <code>standards_library.json</code>
        </a>{" "}
        and{" "}
        <a href="https://github.com/thenewforktimes/contentRX/blob/main/taxonomy_refinement_log.md">
          <code>taxonomy_refinement_log.md</code>
        </a>
        . The CI guard in{" "}
        <code>scripts/check_taxonomy_changelog.py</code> blocks PRs
        that change the taxonomy without appending a{" "}
        <code>version_history</code> entry or approving a refinement.
      </p>

      <section>
        <h2>Last {WINDOW_DAYS} days</h2>
        {recent.length === 0 ? (
          <p>No changes in the last {WINDOW_DAYS} days.</p>
        ) : (
          <EntryList entries={recent} />
        )}
      </section>

      {older.length > 0 && (
        <section>
          <h2>Earlier changes</h2>
          <EntryList entries={older} />
        </section>
      )}

      <hr />
      <p className="text-sm">
        <Link href="/model">← The content model</Link>
      </p>
    </>
  );
}

function EntryList({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <ol className="not-prose space-y-4">
      {entries.map((entry) => (
        <EntryCard
          key={
            entry.kind === "standard_version"
              ? `sv-${entry.standard_id}-${entry.version}-${entry.date}`
              : `ref-${entry.ref_id}`
          }
          entry={entry}
        />
      ))}
    </ol>
  );
}

function EntryCard({ entry }: { entry: ChangelogEntry }) {
  if (entry.kind === "standard_version") {
    return <StandardVersionCard entry={entry} />;
  }
  return <ApprovedRefinementCard entry={entry} />;
}

function StandardVersionCard({ entry }: { entry: StandardVersionEntry }) {
  return (
    <li className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-mono text-neutral-500">{entry.date}</span>
        <span className="rounded-full border border-neutral-300 px-2 py-0.5 uppercase tracking-wide text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
          Standard revision
        </span>
        <Link
          href={`/model/standards/${entry.standard_id}`}
          className="font-mono font-semibold"
        >
          {entry.standard_id}
        </Link>
        <span className="font-mono text-neutral-500">v{entry.version}</span>
      </div>
      <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">
        {entry.change_note}
      </p>
    </li>
  );
}

function ApprovedRefinementCard({
  entry,
}: {
  entry: ApprovedRefinementEntry;
}) {
  return (
    <li className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-mono text-neutral-500">
          {entry.date === "0000-00-00" ? "(date pending)" : entry.date}
        </span>
        <span className="rounded-full border border-neutral-300 px-2 py-0.5 uppercase tracking-wide text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
          Approved refinement
        </span>
        <span className="font-mono font-semibold">{entry.ref_id}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {entry.title || entry.ref_id}
      </p>
      {entry.body && (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs text-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
          {entry.body}
        </pre>
      )}
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
