/**
 * Server-only loader that scans the `reports/` directory.
 *
 * Robert hand-maintains every artifact under `reports/` on a
 * solo-founder cadence — there is no scheduled generator (the
 * earlier nightly / weekly / quarterly generators + staleness
 * watchdog were removed on 2026-05-11). This loader treats whatever
 * is currently on disk as the source of truth and feeds the
 * /admin/reports preview-before-publish gate.
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
 * touched in `STALE_THRESHOLD_DAYS` is flagged so the founder sees
 * at a glance which artifacts have aged out of their voluntary
 * cadence.
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
  /** Whether the founder has marked this report reviewed via /admin/reports.
   * Backed by a sentinel file `reports/<type>/.<filename>.reviewed` (see
   * `reviewSentinelPath`). The sentinel travels with the report through
   * git, so the review state is the same in every checkout. */
  reviewed: boolean;
}

export interface ReportsByType {
  accuracy: ReportEntry[];
  calibration: ReportEntry[];
  quarterly: ReportEntry[];
}

export const STALE_THRESHOLD_DAYS: Record<ReportType, number> = {
  // Robert's voluntary cadences. Anything older than these gets an
  // amber "stale" pill on /admin/reports as a cadence reminder.
  // Accuracy: refreshed roughly every couple of days.
  accuracy: 2,
  // Calibration: one entry per ISO week — 8 days is one day past the
  // weekly slot.
  calibration: 8,
  // Quarterly: ~3 months + slack.
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
  reviewed: boolean;
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
      reviewed: isReviewed(type, filename),
    };
  } catch {
    return null;
  }
}

/** Resolve the sentinel-file path for a (type, filename) pair, after
 * validating both inputs against {@link isReportType} / {@link isSafeFilename}.
 * Returns null on invalid inputs so callers can fail closed without
 * touching the filesystem. */
export function reviewSentinelPath(
  type: ReportType,
  filename: string,
): string | null {
  if (!isSafeFilename(filename)) return null;
  // Source-of-truth file must exist; we don't track review state for
  // non-existent reports.
  const reportFile = path.join(REPORTS_DIR, type, filename);
  try {
    const stat = fs.statSync(reportFile);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  return path.join(REPORTS_DIR, type, `.${filename}.reviewed`);
}

function isReviewed(type: ReportType, filename: string): boolean {
  const sentinel = reviewSentinelPath(type, filename);
  if (sentinel === null) return false;
  try {
    return fs.statSync(sentinel).isFile();
  } catch {
    return false;
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
      reviewed: isReviewed(type, name),
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
