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
 * Decision UI (approve / mark needing-fix) is deferred to a follow-up.
 * This PR ships the read-only preview; B6b adds the publication gate.
 *
 * Auth handled by `src/app/admin/layout.tsx`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  isReportType,
  loadReportFile,
  STALE_THRESHOLD_DAYS,
  type ReportType,
} from "@/lib/admin-reports.server";

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
            className="text-neutral-600 hover:underline dark:text-neutral-400"
          >
            ← Back to reports
          </Link>
        </p>
        <h1 className="mt-2 font-mono text-xl text-neutral-900 dark:text-neutral-100">
          {filename}
        </h1>
        <dl className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-600 dark:text-neutral-400">
          <div>
            <dt className="font-semibold uppercase tracking-wide text-neutral-500">
              Type
            </dt>
            <dd className="font-mono">{typeRaw}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-neutral-500">
              Modified
            </dt>
            <dd className="font-mono">{report.modified_at.replace("T", " ").slice(0, 16)}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide text-neutral-500">
              Size
            </dt>
            <dd className="font-mono">{report.size_bytes.toLocaleString()} bytes</dd>
          </div>
          {isStale && (
            <span className="self-start rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              stale ({ageDays.toFixed(1)}d &gt; {STALE_THRESHOLD_DAYS[typeRaw as ReportType]}d)
            </span>
          )}
        </dl>
      </header>

      <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
          Raw contents
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-neutral-800 dark:text-neutral-200">
{formatted}
        </pre>
      </div>

      <p className="text-xs text-neutral-500">
        Decision UI (approve / mark needing fix) ships in B6b. For now, copy
        the file path and edit on disk if the preview surfaces a generator
        bug:{" "}
        <code className="font-mono">reports/{typeRaw}/{filename}</code>.
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
