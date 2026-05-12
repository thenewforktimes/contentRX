/**
 * `/admin/reports` — preview-before-publish gate.
 *
 * Lists every artifact in `reports/` (accuracy / calibration /
 * quarterly) and shows when each was last touched. Robert maintains
 * these artifacts manually as a solo founder — there is no
 * scheduled generator. This surface is the founder's "what does the
 * public surface look like right now?" review pane and the place
 * where the publication-ready sentinel is toggled.
 *
 * The stale threshold per type still drives the amber "stale" pill
 * so the founder sees at-a-glance which artifacts have aged out of
 * their voluntary cadence.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { Pill } from "@/components/ui/pill";
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
      "Per-standard kappa with 95% CI + system-level kappa. Consumed by the public /accuracy page. Numbers only — no narrative. Hand-maintained.",
    cadence: "Founder cadence",
    emptyHint:
      "No accuracy/latest.json on disk yet. Publish one by hand-editing reports/accuracy/latest.json — the public /accuracy page reads it as-is.",
  },
  calibration: {
    title: "Weekly calibration log",
    description:
      "Kappa movement vs prior week, drift signals, override count by subtype, most active refinement-log entries. Hand-maintained.",
    cadence: "Founder cadence",
    emptyHint:
      "No weekly markdown on disk yet. Drop a 2026-WW.md into reports/calibration/ when you're ready to publish a week.",
  },
  quarterly: {
    title: "Quarterly accuracy report",
    description:
      "Numbers + hand-edited narrative for the closing quarter. Hand-maintained.",
    cadence: "Founder cadence",
    emptyHint:
      "No quarterly scaffold on disk yet. Drop a YYYY-Q.md into reports/quarterly/ when you're ready to publish a quarter.",
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
        <h1 className="text-2xl font-semibold text-strong">
          Reports
        </h1>
        <p className="mt-1 text-sm text-quiet">
          Preview-before-publish gate for the public credibility surface.
          Robert hand-maintains every artifact under <code>reports/</code> on
          a solo-founder cadence — there is no scheduled generator. Stale
          entries (older than the per-type threshold below) get an amber
          pill so a slipped cadence is visible at a glance.
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
                  className="text-base font-semibold text-strong"
                >
                  {info.title}
                </h2>
                <p className="mt-1 text-xs text-quiet">
                  {info.description}
                </p>
              </div>
              <Pill tone="neutral" size="xs" className="uppercase tracking-wide">
                {info.cadence} · stale &gt; {STALE_THRESHOLD_DAYS[type]}d
              </Pill>
            </header>

            {entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong bg-raised px-4 py-3 text-xs text-quiet">
                {info.emptyHint}
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
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
          className="font-mono text-sm text-strong hover:underline"
        >
          {entry.filename}
        </Link>
        {entry.reviewed ? (
          <Pill tone="emerald" size="xs" className="uppercase tracking-wide">
            reviewed
          </Pill>
        ) : (
          <Pill tone="neutral" size="xs" className="uppercase tracking-wide">
            pending review
          </Pill>
        )}
        {entry.is_stale && (
          <Pill tone="amber" size="xs" className="uppercase tracking-wide">
            stale
          </Pill>
        )}
      </div>
      <div className="flex items-baseline gap-4 font-mono text-[10px] text-quiet">
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
        className="rounded-md border border-line-strong px-2 py-0.5 text-[10px] font-medium text-default hover:bg-hover"
      >
        {label}
      </button>
    </form>
  );
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}
