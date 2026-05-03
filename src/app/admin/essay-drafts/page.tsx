/**
 * `/admin/essay-drafts` — essay-drafting workspace.
 *
 * Phase B7 of the post-pivot rolling plan + B7b persistence layer.
 * Pulls the latest /accuracy numbers, the most recent calibration-log
 * entry, and active refinement-log candidates to produce a ~200-word
 * scaffold the founder opens with. The founder writes the actual
 * essay; the scaffold removes the cold-start tax.
 *
 * Persistence (B7b): the founder edits the draft body in-page and
 * saves to `essays/drafts/<filename>.md`. The save Server Action is
 * the entire persistence layer — drafts ride through git as ordinary
 * commits. Vercel runtime is read-only; saves only land in local
 * checkouts (matches B4b refinement-form / B6b mark-reviewed
 * caveats).
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { Pill } from "@/components/ui/pill";
import { getDb, schema } from "@/db";
import { buildAccuracySnapshot } from "@/lib/accuracy-data";
import {
  buildEssayScaffold,
  type EssayScaffoldInput,
} from "@/lib/admin-essay-scaffold";
import { getRefinementLog } from "@/lib/admin-refinement-log.server";
import { loadReports } from "@/lib/admin-reports.server";
import {
  draftFilenameForCalibration,
  draftFilenameForCurrentWeek,
  listDrafts,
  loadDraft,
  type DraftEntry,
} from "@/lib/admin-essay-drafts.server";
import { saveDraftAction } from "./actions";

const OVERRIDE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const metadata = {
  title: "Essay drafts · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminEssayDraftsPage() {
  const snapshot = buildAccuracySnapshot();
  const refinements = getRefinementLog();
  const reports = loadReports();
  const overrideCount = await loadOverrideCount();

  const recentCalibration = reports.calibration[0] ?? null;

  const input: EssayScaffoldInput = {
    measured_system: snapshot.measured_system,
    measured_self_drift: snapshot.measured_self_drift,
    design_target: snapshot.design_target,
    recent_calibration_filename: recentCalibration?.filename ?? null,
    recent_calibration_modified_at: recentCalibration?.modified_at ?? null,
    active_refinements: refinements.byStatus.open,
    override_count_30d: overrideCount,
  };

  const scaffold = buildEssayScaffold(input);

  // Pair the draft to the most recent calibration log entry, falling
  // back to current ISO week when none exists yet (Phase C lands the
  // generator).
  const draftFilename =
    draftFilenameForCalibration(recentCalibration?.filename ?? null) ??
    draftFilenameForCurrentWeek();

  const existingDraft = loadDraft(draftFilename);
  const allDrafts = listDrafts();

  // Initial textarea content: the saved draft if one exists, else
  // the freshly-generated scaffold so the founder can save and start
  // editing in one click.
  const initialBody = existingDraft
    ? existingDraft.contents
    : `# ${scaffold.title}\n\n${scaffold.body}\n`;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Essay drafts
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Cold-start scaffold drawn from the latest accuracy snapshot, the
          most recent calibration log entry, and open refinement-log
          candidates. The scaffold is the floor; you write the essay.
        </p>
      </header>

      <section
        aria-labelledby="inputs-heading"
        className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
      >
        <h2
          id="inputs-heading"
          className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400"
        >
          Inputs
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input
            label="Measured system κ"
            value={kappaPretty(snapshot.measured_system)}
          />
          <Input
            label="Self-drift κ"
            value={kappaPretty(snapshot.measured_self_drift)}
          />
          <Input
            label="Design target"
            value={snapshot.design_target.toFixed(2)}
            mono
          />
          <Input
            label={`Overrides (${OVERRIDE_WINDOW_DAYS}d)`}
            value={overrideCount.toString()}
            mono
          />
          <Input
            label="Open refinements"
            value={
              refinements.byStatus.open.length === 0
                ? "—"
                : refinements.byStatus.open
                    .slice(0, 3)
                    .map((r) => r.id)
                    .join(", ")
            }
            mono
          />
          <Input
            label="Recent calibration log"
            value={
              recentCalibration
                ? `reports/calibration/${recentCalibration.filename}`
                : "— (Phase C generator pending)"
            }
            mono
          />
        </dl>
      </section>

      <section className="space-y-3">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Draft
            </h2>
            <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
              Saving writes to{" "}
              <code className="font-mono">
                essays/drafts/{draftFilename}
              </code>
              .{" "}
              {existingDraft
                ? `Loaded from disk (${formatDate(existingDraft.modified_at)} UTC, ${existingDraft.size_bytes.toLocaleString()} bytes).`
                : `New draft — pre-filled with the scaffold (${scaffold.word_count} words, generated ${formatDate(scaffold.generated_at)} UTC).`}
            </p>
          </div>
          {existingDraft ? (
            <Pill tone="emerald" size="xs" className="uppercase tracking-wide">
              draft on disk
            </Pill>
          ) : (
            <Pill tone="neutral" size="xs" className="uppercase tracking-wide">
              unsaved
            </Pill>
          )}
        </header>
        <form action={saveDraftAction} className="space-y-3">
          <input type="hidden" name="filename" value={draftFilename} />
          <textarea
            name="body"
            defaultValue={initialBody}
            spellCheck
            rows={22}
            className="w-full rounded-lg border border-stone-300 bg-white p-4 font-mono text-xs leading-relaxed text-stone-800 focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-md border border-stone-900 bg-stone-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-stone-800 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              Save draft
            </button>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Vercel is read-only — saves only land in local checkouts. Commit
              the file alongside the calibration log entry it anchors to.
            </p>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="drafts-heading"
        className="space-y-3"
      >
        <header>
          <h2
            id="drafts-heading"
            className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400"
          >
            All drafts
          </h2>
          <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
            Files under{" "}
            <code className="font-mono">essays/drafts/</code>. Move a draft
            into <code className="font-mono">contentrx-docs/essays/</code> to
            publish it.
          </p>
        </header>
        {allDrafts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-3 text-xs text-stone-500 dark:text-stone-400 dark:border-stone-700 dark:bg-stone-900">
            No drafts yet. The first save creates one.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {allDrafts.map((entry) => (
              <DraftRow
                key={entry.filename}
                entry={entry}
                isCurrent={entry.filename === draftFilename}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        Voice prompt: open with a specific decision the κ moved this week,
        not the metric itself. The metric is evidence; the decision is the
        story.
      </p>
    </div>
  );
}

function DraftRow({
  entry,
  isCurrent,
}: {
  entry: DraftEntry;
  isCurrent: boolean;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <Link
          href={`/admin/essay-drafts/${encodeURIComponent(entry.filename)}`}
          className="font-mono text-sm text-stone-900 hover:underline dark:text-stone-100"
        >
          {entry.filename}
        </Link>
        {isCurrent && (
          <Pill tone="blue" size="xs" className="uppercase tracking-wide">
            this week
          </Pill>
        )}
      </div>
      <div className="flex items-baseline gap-4 font-mono text-[10px] text-stone-500 dark:text-stone-400">
        <span>{entry.size_bytes.toLocaleString()} bytes</span>
        <span>{formatDate(entry.modified_at)}</span>
      </div>
    </li>
  );
}

function Input({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </dt>
      <dd
        className={`mt-1 ${
          mono ? "font-mono text-xs" : "text-sm"
        } text-stone-800 dark:text-stone-200`}
      >
        {value}
      </dd>
    </div>
  );
}

function kappaPretty(
  k: ReturnType<typeof buildAccuracySnapshot>["measured_system"],
): string {
  if (k.state === "measured") {
    return `${k.value.toFixed(3)} (CI ${k.ci_low.toFixed(3)}, ${k.ci_high.toFixed(3)})`;
  }
  return `pending — ${k.reason}`;
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

async function loadOverrideCount(): Promise<number> {
  const since = new Date(Date.now() - OVERRIDE_WINDOW_DAYS * DAY_MS);
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.violationOverrides)
    .where(
      sql`${schema.violationOverrides.createdAt} >= ${since.toISOString()}`,
    );
  return Number(rows[0]?.count ?? 0);
}
