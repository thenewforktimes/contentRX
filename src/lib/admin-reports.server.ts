/**
 * Server-only loader that scans the `reports/` directory.
 *
 * Phase B6 of the post-pivot rolling plan. The generators
 * themselves (accuracy snapshot, weekly calibration log, quarterly
 * scaffold) ship in Phase C; this loader treats whatever's currently
 * on disk as the source of truth, so as soon as Phase C generators
 * land their first output, the /admin/reports page picks it up
 * automatically.
 *
 * Each subdirectory has a known shape:
 *
 *   reports/accuracy/latest.json     — one rolling file
 *   reports/calibration/YYYY-WW.md   — one per ISO week
 *   reports/quarterly/YYYY-Q.md      — one per quarter
 *
 * Files starting with `.` (e.g. `.gitkeep`) are ignored.
 *
 * Staleness is computed against the file's mtime. Any report not
 * touched in `STALE_THRESHOLD_DAYS` is flagged so the founder can
 * see at a glance whether a generator has stalled.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";

export type ReportType = "accuracy" | "calibration" | "quarterly";

export interface ReportEntry {
  type: ReportType;
  /** Filename relative to the type's subdirectory (e.g. `2026-15.md`). */
  filename: string;
  /** ISO mtime — drives staleness + sort order. */
  modified_at: string;
  size_bytes: number;
  is_stale: boolean;
}

export interface ReportsByType {
  accuracy: ReportEntry[];
  calibration: ReportEntry[];
  quarterly: ReportEntry[];
}

export const STALE_THRESHOLD_DAYS: Record<ReportType, number> = {
  // Nightly. Anything older than 2 days is stale.
  accuracy: 2,
  // Weekly Monday cron. 8 days is one day past expected cadence.
  calibration: 8,
  // Quarterly first-Monday cron. 95 days = ~3 months + slack.
  quarterly: 95,
};

const TYPE_ORDER: ReportType[] = ["accuracy", "calibration", "quarterly"];

const REPORTS_DIR = path.join(process.cwd(), "reports");

const DAY_MS = 24 * 60 * 60 * 1000;

export function loadReports(now: Date = new Date()): ReportsByType {
  const result: ReportsByType = {
    accuracy: [],
    calibration: [],
    quarterly: [],
  };

  for (const type of TYPE_ORDER) {
    result[type] = scanType(type, now);
  }
  return result;
}

export function loadReportFile(
  type: ReportType,
  filename: string,
): {
  contents: string;
  modified_at: string;
  size_bytes: number;
} | null {
  if (!isSafeFilename(filename)) return null;
  const file = path.join(REPORTS_DIR, type, filename);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const contents = fs.readFileSync(file, "utf-8");
    return {
      contents,
      modified_at: stat.mtime.toISOString(),
      size_bytes: stat.size,
    };
  } catch {
    return null;
  }
}

function scanType(type: ReportType, now: Date): ReportEntry[] {
  const dir = path.join(REPORTS_DIR, type);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const entries: ReportEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const file = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const ageDays = (now.getTime() - stat.mtimeMs) / DAY_MS;
    entries.push({
      type,
      filename: name,
      modified_at: stat.mtime.toISOString(),
      size_bytes: stat.size,
      is_stale: ageDays > STALE_THRESHOLD_DAYS[type],
    });
  }
  // Newest first.
  entries.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return entries;
}

/** Filenames that travel via URL paths must not contain path traversal
 * sequences. Conservatively: only allow filenames that look like
 * canonical report names — alphanumerics, underscore, hyphen, dot.
 */
function isSafeFilename(filename: string): boolean {
  if (filename.length === 0 || filename.length > 64) return false;
  if (filename.startsWith(".")) return false;
  return /^[A-Za-z0-9._-]+$/.test(filename);
}

export function isReportType(value: string): value is ReportType {
  return value === "accuracy" || value === "calibration" || value === "quarterly";
}
