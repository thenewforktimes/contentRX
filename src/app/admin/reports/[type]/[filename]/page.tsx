/**
 * `/admin/reports/[type]/[filename]` — single-report preview.
 *
 * Phase B6 of the post-pivot rolling plan. Renders the raw contents
 * of a generated report file before publication. Markdown files
 * render as `<pre>` (no rich rendering yet — the architecture's
 * "preview-before-publish gate" is about checking the raw output for
 * automation bugs, not about pretty rendering); JSON files render as
 * formatted JSON.
 *
 * Decision UI (mark reviewed / unmark) lives in the header — backed by
 * a sentinel file (`reports/<type>/.<filename>.reviewed`) the founder
 * commits alongside the report.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Pill } from "@/components/ui/pill";
import {
  isReportType,
  loadReportFile,
  STALE_THRESHOLD_DAYS,
  type ReportType,
} from "@/lib/admin-reports.server";
import { toggleReviewedAction } from "../../actions";

const DAY_MS = 24 * 60 * 60 * 1000;

export const metadata = {
  title: "Report · ContentRX admin",
  robots: { index: false, follow: false },
};

export default async function AdminReportPreviewPage({
  params,
}: {
  params: Promise<{ type: string; filename: string }>;
}) {
  const { type: typeRaw, filename: filenameRaw } = await params;
  if (!isReportType(typeRaw)) notFound();
  const filename = decodeURIComponent(filenameRaw);

  const report = loadReportFile(typeRaw, filename);
  if (!report) notFound();

  const isJson = filename.toLowerCase().endsWith(".json");
  const formatted = isJson ? prettyJson(report.contents) : report.contents;
  const ageDays = computeAgeDays(report.modified_at);
  const isStale = ageDays > STALE_THRESHOLD_DAYS[typeRaw as ReportType];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs">
          <Link
            href="/admin/reports"
            className="text-stone-600 hover:underline dark:text-stone-400"
          >
            ← Back to reports
          </Link>
        </p>
        <h1 className="mt-2 font-mono text-xl text-stone-900 dark:text-stone-100">
          {filename}
        </h1>
        <dl className="mt-3 flex flex-wrap gap-4 text-xs text-stone-600 dark:text-stone-400">
          <div>
            <dt className="font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Type
            </dt>
            <dd className="font-mono">{typeRaw}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Modified
            </dt>
            <dd className="font-mono">{report.modified_at.replace("T", " ").slice(0, 16)}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Size
            </dt>
            <dd className="font-mono">{report.size_bytes.toLocaleString()} bytes</dd>
          </div>
          {isStale && (
            <Pill
              tone="amber"
              size="xs"
              className="self-start uppercase tracking-wide"
            >
              stale ({ageDays.toFixed(1)}d &gt; {STALE_THRESHOLD_DAYS[typeRaw as ReportType]}d)
            </Pill>
          )}
        </dl>
        <div className="mt-4 flex items-center gap-3">
          {report.reviewed ? (
            <Pill tone="emerald" size="xs" className="uppercase tracking-wide">
              reviewed
            </Pill>
          ) : (
            <Pill tone="neutral" size="xs" className="uppercase tracking-wide">
              pending review
            </Pill>
          )}
          <form action={toggleReviewedAction}>
            <input type="hidden" name="type" value={typeRaw} />
            <input type="hidden" name="filename" value={filename} />
            <input
              type="hidden"
              name="desired"
              value={report.reviewed ? "false" : "true"}
            />
            <button
              type="submit"
              title={
                report.reviewed
                  ? "Clear the publication-ready sentinel and re-open this report for edits."
                  : "Mark this report ready to publish. Writes a sentinel — commit it alongside the report."
              }
              className="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              {report.reviewed ? "Reopen for review" : "Mark ready to publish"}
            </button>
          </form>
        </div>
      </header>

      <div className="rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="border-b border-stone-200 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 dark:border-stone-800">
          Raw contents
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-stone-800 dark:text-stone-200">
{formatted}
        </pre>
      </div>

      <p className="text-xs text-stone-500 dark:text-stone-400">
        Marking reviewed writes a sentinel at{" "}
        <code className="font-mono">
          reports/{typeRaw}/.{filename}.reviewed
        </code>{" "}
        — commit it alongside the report so the publication gate
        travels through git. If a generator bug surfaces, edit{" "}
        <code className="font-mono">
          reports/{typeRaw}/{filename}
        </code>{" "}
        on disk before re-marking. Vercel runtime is read-only, so use
        a local checkout.
      </p>
    </div>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function computeAgeDays(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / DAY_MS;
}
