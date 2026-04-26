/**
 * Server-only loader for the essay-drafts directory.
 *
 * Phase B7b of the post-pivot rolling plan. Drafts live in
 * `essays/drafts/<filename>.md` — the founder's private staging area
 * before a piece moves to `contentrx-docs/essays/` for publication.
 *
 * Design rules (mirrors `admin-reports.server.ts`):
 *
 * - Filenames travel via URL paths and Server Action form fields, so
 *   they are validated against `^[A-Za-z0-9._-]+$` and capped at 64
 *   chars before the filesystem is touched.
 * - Files starting with `.` are excluded from the listing scan
 *   (`.gitkeep`, future `.<filename>.reviewed`-style sentinels).
 * - The drafts directory is a fixed sibling of the package root; we
 *   resolve it once relative to `process.cwd()` and never reach
 *   outside it.
 * - Path escapes (`..`, `/`) are blocked at the validation step rather
 *   than via `path.resolve` checks — defense in depth.
 *
 * The page composes this loader with the scaffold builder; the
 * Server Action lives in `src/app/admin/essay-drafts/actions.ts`.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";

export interface DraftEntry {
  filename: string;
  modified_at: string;
  size_bytes: number;
}

export interface DraftDetail extends DraftEntry {
  contents: string;
}

const DRAFTS_DIR = path.join(process.cwd(), "essays", "drafts");

const FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isSafeDraftFilename(filename: string): boolean {
  if (filename.length === 0 || filename.length > 64) return false;
  if (filename.startsWith(".")) return false;
  return FILENAME_PATTERN.test(filename);
}

export function listDrafts(): DraftEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(DRAFTS_DIR);
  } catch {
    return [];
  }
  const entries: DraftEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (!isSafeDraftFilename(name)) continue;
    const file = path.join(DRAFTS_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    entries.push({
      filename: name,
      modified_at: stat.mtime.toISOString(),
      size_bytes: stat.size,
    });
  }
  entries.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return entries;
}

export function loadDraft(filename: string): DraftDetail | null {
  if (!isSafeDraftFilename(filename)) return null;
  const file = path.join(DRAFTS_DIR, filename);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return {
      filename,
      modified_at: stat.mtime.toISOString(),
      size_bytes: stat.size,
      contents: fs.readFileSync(file, "utf-8"),
    };
  } catch {
    return null;
  }
}

/** Resolve the writable filesystem path for a draft. Returns null if
 * the filename fails validation, so callers can fail closed before
 * the FS write. The path is guaranteed to live under
 * `essays/drafts/`. */
export function draftFilePath(filename: string): string | null {
  if (!isSafeDraftFilename(filename)) return null;
  return path.join(DRAFTS_DIR, filename);
}

/** Ensure the drafts directory exists. Used by the Server Action so
 * the first save in a fresh checkout doesn't fail with ENOENT. */
export function ensureDraftsDir(): boolean {
  try {
    fs.mkdirSync(DRAFTS_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Suggest a draft filename derived from a calibration-log filename
 * (e.g. `2026-15.md` → `2026-15.md`). The convention pairs the
 * draft to the calibration entry it anchors against, so the founder
 * sees the same week-number on both files. */
export function draftFilenameForCalibration(
  calibrationFilename: string | null,
): string | null {
  if (calibrationFilename === null) return null;
  if (!isSafeDraftFilename(calibrationFilename)) return null;
  return calibrationFilename;
}

/** Suggest a draft filename for the current ISO week when no
 * calibration log entry exists yet. ISO-8601 week (1–53) padded to
 * two digits. Pure helper — same logic as the scaffold builder. */
export function draftFilenameForCurrentWeek(now: Date = new Date()): string {
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${target.getUTCFullYear()}-${String(weekNum).padStart(2, "0")}.md`;
}
