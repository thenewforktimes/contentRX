/**
 * Server-only loader for `taxonomy_refinement_log.md`.
 *
 * Reads the file at the repo root and delegates parsing to the pure
 * `admin-refinement-log-parser.ts` module (kept separate so the parser
 * can be unit-tested without webpack tripping over the
 * `server-only` import).
 *
 * Phase B4 of the post-pivot rolling plan.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  emptyRefinementLog,
  parseRefinementLog,
  type RefinementLog,
} from "./admin-refinement-log-parser";

export type {
  RefinementEntry,
  RefinementLog,
  RefinementStatus,
} from "./admin-refinement-log-parser";

let cached: RefinementLog | null = null;

export function getRefinementLog(): RefinementLog {
  if (cached) return cached;
  const p = path.join(process.cwd(), "taxonomy_refinement_log.md");
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf-8");
  } catch {
    cached = emptyRefinementLog();
    return cached;
  }
  cached = parseRefinementLog(raw);
  return cached;
}
