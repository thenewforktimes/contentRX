/**
 * `/admin/essay-drafts` — essay-drafting workspace.
 *
 * Phase B7 of the post-pivot rolling plan. Pulls the latest /accuracy
 * numbers, the most recent calibration-log entry, and active
 * refinement-log candidates to produce a ~200-word scaffold the
 * founder opens with. The founder writes the actual essay; this just
 * removes the cold-start tax.
 *
 * Read-only scaffold view in this PR. A persistence layer (drafts
 * stored alongside the report that produced them, per the architecture
 * doc) lands in B7b.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildAccuracySnapshot } from "@/lib/accuracy-data";
import {
  buildEssayScaffold,
  type EssayScaffoldInput,
} from "@/lib/admin-essay-scaffold";
import { getRefinementLog } from "@/lib/admin-refinement-log.server";
import { loadReports } from "@/lib/admin-reports.server";

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

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Essay drafts
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Cold-start scaffold drawn from the latest accuracy snapshot, the
          most recent calibration log entry, and open refinement-log
          candidates. The scaffold is the floor; you write the essay.
        </p>
      </header>

      <section
        aria-labelledby="inputs-heading"
        className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <h2
          id="inputs-heading"
          className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Scaffold ({scaffold.word_count} words)
          </h2>
          <span className="font-mono text-[10px] text-neutral-500">
            generated {scaffold.generated_at.replace("T", " ").slice(0, 16)} UTC
          </span>
        </header>
        <article className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {scaffold.title}
          </h3>
          <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
{scaffold.body}
          </pre>
        </article>
        <p className="text-xs text-neutral-500">
          The scaffold is templated for consistency-of-format week to week —
          consistency is what makes drift in the writing detectable. Open
          with a specific decision the κ moved this week, not the metric
          itself. The metric is evidence; the decision is the story.
        </p>
      </section>

      <p className="text-xs text-neutral-500">
        Persistence (drafts saved alongside the report that produced them,
        per the architecture doc) lands in B7b. For now, copy the scaffold
        into the editor of your choice and link the published artifact back
        to the report file.
      </p>
    </div>
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
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd
        className={`mt-1 ${
          mono ? "font-mono text-xs" : "text-sm"
        } text-neutral-800 dark:text-neutral-200`}
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

