/**
 * `/admin/reports` — preview-before-publish gate.
 *
 * Phase B6 of the post-pivot rolling plan. Lists every artifact in
 * `reports/` (accuracy / calibration / quarterly) and shows when each
 * was last touched. The architecture's operational discipline calls
 * for the founder to gate publication; this surface is where that
 * gate lives.
 *
 * The generators themselves ship in Phase C. Until they do, the page
 * shows empty states explaining what each subdirectory will hold
 * once the generators run.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import {
  loadReports,
  STALE_THRESHOLD_DAYS,
  type ReportEntry,
  type ReportType,
} from "@/lib/admin-reports.server";
import { toggleReviewedAction } from "./actions";

const TYPE_INFO: Record<
  ReportType,
  { title: string; description: string; cadence: string; emptyHint: string }
> = {
  accuracy: {
    title: "Accuracy snapshot",
    description:
      "Nightly. Per-standard kappa with 95% CI + system-level kappa. Consumed by the public /accuracy page. Numbers only — no narrative.",
    cadence: "Nightly cron",
    emptyHint:
      "No accuracy/latest.json yet. Phase C ships reports/accuracy/ generator that emits this file.",
  },
  calibration: {
    title: "Weekly calibration log",
    description:
      "Monday 14:00 UTC. Kappa movement vs prior week, drift signals, override count by subtype, most active refinement-log entries.",
    cadence: "Weekly cron",
    emptyHint:
      "No weekly markdown yet. Phase C ships reports/calibration/ generator that emits 2026-WW.md files.",
  },
  quarterly: {
    title: "Quarterly accuracy report",
    description:
      "First Monday of each quarter. Generated scaffold with numbers populated; the founder hand-edits the narrative before publishing.",
    cadence: "Quarterly cron",
    emptyHint:
      "No quarterly scaffold yet. Phase C ships reports/quarterly/ generator that emits YYYY-Q.md files.",
  },
};

const TYPE_ORDER: ReportType[] = ["accuracy", "calibration", "quarterly"];

export const metadata = {
  title: "Reports · ContentRX admin",
  robots: { index: false, follow: false },
};

export default function AdminReportsPage() {
  const reports = loadReports();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Reports
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Preview-before-publish gate for the public credibility surface.
          Generated reports surface here before the docs site picks them up.
          Stale entries (older than the cadence threshold) are flagged so
          a missing generator run is visible at a glance.
        </p>
      </header>

      {TYPE_ORDER.map((type) => {
        const entries = reports[type];
        const info = TYPE_INFO[type];
        return (
          <section
            key={type}
            aria-labelledby={`section-${type}`}
            className="space-y-3"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2
                  id={`section-${type}`}
                  className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
                >
                  {info.title}
                </h2>
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                  {info.description}
                </p>
              </div>
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                {info.cadence} · stale &gt; {STALE_THRESHOLD_DAYS[type]}d
              </span>
            </header>

            {entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-3 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
                {info.emptyHint}
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
                {entries.map((entry) => (
                  <ReportRow key={entry.filename} entry={entry} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ReportRow({ entry }: { entry: ReportEntry }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <Link
          href={`/admin/reports/${entry.type}/${encodeURIComponent(entry.filename)}`}
          className="font-mono text-sm text-neutral-900 hover:underline dark:text-neutral-100"
        >
          {entry.filename}
        </Link>
        {entry.reviewed ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            reviewed
          </span>
        ) : (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            pending review
          </span>
        )}
        {entry.is_stale && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            stale
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-4 font-mono text-[10px] text-neutral-500">
        <span>{entry.size_bytes.toLocaleString()} bytes</span>
        <span>{formatDate(entry.modified_at)}</span>
        <ToggleReviewForm entry={entry} />
      </div>
    </li>
  );
}

function ToggleReviewForm({ entry }: { entry: ReportEntry }) {
  const desired = entry.reviewed ? "false" : "true";
  const label = entry.reviewed ? "Reopen for review" : "Mark ready to publish";
  const tooltip = entry.reviewed
    ? "Clear the publication-ready sentinel and re-open this report for edits."
    : "Mark this report ready to publish. Writes a sentinel file at reports/<type>/.<filename>.reviewed — commit it alongside the report.";
  return (
    <form action={toggleReviewedAction}>
      <input type="hidden" name="type" value={entry.type} />
      <input type="hidden" name="filename" value={entry.filename} />
      <input type="hidden" name="desired" value={desired} />
      <button
        type="submit"
        title={tooltip}
        className="rounded-md border border-neutral-300 px-2 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        {label}
      </button>
    </form>
  );
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}
