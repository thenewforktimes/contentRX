/**
 * Moments loader for the docs site.
 *
 * Reads `moments_taxonomy.json`, the JSON sibling of
 * `standards_library.json`. The JSON is generated from the Python
 * `src/content_checker/moments.py` source of truth by
 * `tools/export_moments.py`; a pytest check in
 * `tests/test_moments_taxonomy_export.py` pins drift.
 *
 * The docs prebuild script copies the JSON into `lib/` so webpack can
 * bundle it via a plain `import`. See `lib/standards.ts` for the same
 * pattern + the rationale for bundle-over-fs.
 *
 * Human-eval build plan Session 20.
 */

import taxonomyJson from "./moments_taxonomy.json";

export type MomentWeight = {
  standard_id: string;
  modifier: "emphasize" | "relax" | "suppress" | string;
  rationale: string;
};

export type Moment = {
  id: string;
  description: string;
  /** "destructive" | "permission-gated" | "compliance" | null */
  situation_property: string | null;
  weights: MomentWeight[];
};

export type MomentsTaxonomy = {
  schema_version: string;
  total_moments: number;
  default_moment: string;
  confidence_threshold: number;
  confidence_matched: number;
  moments: Moment[];
};

export function loadMoments(): MomentsTaxonomy {
  return taxonomyJson as unknown as MomentsTaxonomy;
}

export function getMoment(id: string): Moment | null {
  return loadMoments().moments.find((m) => m.id === id) ?? null;
}

export function allMomentIds(): string[] {
  return loadMoments().moments.map((m) => m.id);
}

/**
 * Every moment that assigns a weight to the given standard — the
 * inverse of `Moment.weights` indexed by standard_id. Drives the
 * "weighted by these moments" section on each standard page.
 */
export function momentsWeightingStandard(
  standardId: string,
): Array<{ moment: Moment; weight: MomentWeight }> {
  const out: Array<{ moment: Moment; weight: MomentWeight }> = [];
  for (const moment of loadMoments().moments) {
    const weight = moment.weights.find((w) => w.standard_id === standardId);
    if (weight) out.push({ moment, weight });
  }
  return out;
}

/** Human-readable labels for `situation_property` filter chips. */
export const SITUATION_PROPERTY_LABELS: Record<string, string> = {
  destructive: "Destructive",
  "permission-gated": "Permission-gated",
  compliance: "Compliance",
};
