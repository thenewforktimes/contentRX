/**
 * /calibration — public weekly calibration log index.
 *
 * Phase C6 of the post-pivot rolling plan. Lists every weekly
 * markdown file produced by `reports/calibration/generate.py` and
 * links to single-week pages. The architecture's named-expert moat
 * depends on continuity-of-evidence — this index is where the public
 * sees that the founder is in there week after week.
 *
 * Each entry shows the most recent week's headline + a link to the
 * full markdown render at /calibration/[week].
 */

import type { Metadata } from "next";
import Link from "next/link";
import { listCalibrationLogs } from "@/lib/calibration-loader.server";

export const metadata: Metadata = {
  title: "Calibration log. ContentRX",
  description:
    "Weekly calibration log: kappa movement, drift signals, override count, active refinement-log entries. Templated for consistency-of-format week to week.",
};

export default function CalibrationIndexPage() {
  const entries = listCalibrationLogs();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400">
          Calibration log
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Weekly calibration log</h1>
        <p className="mt-4 text-sm text-stone-600 dark:text-stone-400">
          Every Monday, the substrate-to-report pipeline emits a
          calibration log entry. Each entry covers the previous week&apos;s
          measured κ movement, drift signals, override counts, and active
          taxonomy refinement candidates. The format is templated on
          purpose: consistency week to week is what makes drift in the
          writing detectable.
        </p>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          See{" "}
          <Link href="/accuracy" className="underline underline-offset-2">
            /accuracy
          </Link>{" "}
          for the headline κ numbers.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
          No calibration log entries yet. The Monday cron generator
          publishes new entries as they land.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.week}>
              <Link
                href={`/calibration/${entry.week}`}
                className="block rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-600"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-mono text-base font-semibold">
                    Week {entry.week}
                  </h2>
                  <span className="font-mono text-[10px] text-stone-500 dark:text-stone-400">
                    {formatIso(entry.modified_at)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
                  {extractHeadline(entry.contents)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Pull a one-line summary from the markdown — the line under the
 * "## Measured system κ" header. Falls back to the first non-empty
 * non-header line. */
function extractHeadline(md: string): string {
  const lines = md.split("\n");
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("## Measured system κ")) {
      inSection = true;
      continue;
    }
    if (inSection) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Strip leading bullet + bold markers.
      return trimmed.replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
    }
  }
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return "";
}

function formatIso(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
