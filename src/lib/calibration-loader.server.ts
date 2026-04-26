/**
 * Public calibration log loader.
 *
 * Phase C6 of the post-pivot rolling plan. Walks the
 * `reports/calibration/` directory and returns each weekly markdown
 * file's metadata + raw contents for the public `/calibration` page.
 *
 * The Phase C2 generator emits one file per ISO week named
 * `YYYY-WW.md`. Files starting with `.` are filtered out so the
 * `.gitkeep` sentinel doesn't show up as an entry.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";

export interface CalibrationLogEntry {
  /** ISO-week filename without extension, e.g. "2026-17". */
  week: string;
  filename: string;
  modified_at: string;
  size_bytes: number;
  contents: string;
}

const FILENAME_RE = /^(\d{4})-(\d{2})\.md$/;

const CALIBRATION_DIR = path.join(
  process.cwd(),
  "reports",
  "calibration",
);

export function listCalibrationLogs(): CalibrationLogEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(CALIBRATION_DIR);
  } catch {
    return [];
  }

  const entries: CalibrationLogEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const m = name.match(FILENAME_RE);
    if (!m) continue;
    const file = path.join(CALIBRATION_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let contents: string;
    try {
      contents = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    entries.push({
      week: name.replace(/\.md$/, ""),
      filename: name,
      modified_at: stat.mtime.toISOString(),
      size_bytes: stat.size,
      contents,
    });
  }

  // Newest week first.
  entries.sort((a, b) => b.week.localeCompare(a.week));
  return entries;
}

export function getCalibrationLog(week: string): CalibrationLogEntry | null {
  if (!FILENAME_RE.test(`${week}.md`)) return null;
  const file = path.join(CALIBRATION_DIR, `${week}.md`);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const contents = fs.readFileSync(file, "utf-8");
    return {
      week,
      filename: `${week}.md`,
      modified_at: stat.mtime.toISOString(),
      size_bytes: stat.size,
      contents,
    };
  } catch {
    return null;
  }
}
