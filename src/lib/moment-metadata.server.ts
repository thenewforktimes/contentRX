/**
 * Server-only moment metadata helpers.
 *
 * Reads the committed `moments_taxonomy.json` (written by
 * `tools/export_moments.py`) and produces precomputed
 * emphasized/relaxed/suppressed counts per moment.
 *
 * Split from `moment-metadata.ts` so client components can import the
 * static descriptions without webpack trying to bundle `node:fs`.
 * Human-eval build plan Session 22.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { MOMENTS } from "./engine-taxonomy";
import type { MomentWeightsSummary } from "./moment-metadata";

interface MomentsTaxonomyFile {
  moments: Array<{
    id: string;
    weights: Array<{
      standard_id: string;
      modifier: string;
      rationale: string;
    }>;
  }>;
}

let cachedTaxonomy: MomentsTaxonomyFile | null = null;

function loadTaxonomy(): MomentsTaxonomyFile {
  if (cachedTaxonomy) return cachedTaxonomy;
  const p = path.join(
    process.cwd(),
    "src",
    "content_checker",
    "standards",
    "moments_taxonomy.json",
  );
  const raw = fs.readFileSync(p, "utf-8");
  cachedTaxonomy = JSON.parse(raw) as MomentsTaxonomyFile;
  return cachedTaxonomy;
}

export function getMomentWeightsSummary(
  momentId: string,
): MomentWeightsSummary | null {
  const file = loadTaxonomy();
  const entry = file.moments.find((m) => m.id === momentId);
  if (!entry) return null;
  const counts = { emphasized: 0, relaxed: 0, suppressed: 0 };
  for (const w of entry.weights) {
    if (w.modifier === "emphasize") counts.emphasized += 1;
    else if (w.modifier === "relax") counts.relaxed += 1;
    else if (w.modifier === "suppress") counts.suppressed += 1;
  }
  return {
    total: counts.emphasized + counts.relaxed + counts.suppressed,
    ...counts,
  };
}

export function getAllMomentWeightsSummaries(): Record<
  string,
  MomentWeightsSummary
> {
  const out: Record<string, MomentWeightsSummary> = {};
  for (const id of MOMENTS) {
    const s = getMomentWeightsSummary(id);
    if (s) out[id] = s;
  }
  return out;
}
