/**
 * Server-only substrate loaders for the founder `/admin/model` UI.
 *
 * Exposes the full substrate shape of `standards_library.json` and
 * `moments_taxonomy.json`: rule + examples + per-standard
 * `version_history`, `sources`, `influences`, `content_type_notes`,
 * plus moments with their weight rationale and `situation_property`.
 *
 * The existing `src/lib/standards.ts` loader is intentionally narrow
 * (id + rule + examples + category) because it powers the
 * customer-facing team-rules UI; this module is the substrate
 * companion for /admin/model. Don't merge them — keeping the
 * substrate shape behind `server-only` avoids accidental client-
 * bundle inclusion that could leak the taxonomy via stray hydrated
 * payloads.
 *
 * Phase B2 of the post-pivot rolling plan
 * (`decisions/2026-04-25-private-taxonomy-pivot.md`).
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Standards
// ---------------------------------------------------------------------------

export interface StandardVersionHistoryEntry {
  version: string;
  date?: string;
  change?: string;
  notes?: string;
}

export interface StandardInfluence {
  source: string;
  direction: "aligns" | "diverges" | "neutral" | string;
  note?: string;
}

export interface SubstrateStandard {
  id: string;
  category_id: string;
  category_name: string;
  rule: string;
  correct: string;
  incorrect: string;
  rule_type: string;
  checkable_from?: string;
  relevant_content_types: string[];
  content_type_notes: Record<string, string>;
  version: string;
  version_history: StandardVersionHistoryEntry[];
  sources: string[];
  influences: StandardInfluence[];
}

export interface SubstrateCategory {
  id: string;
  name: string;
  standards: SubstrateStandard[];
}

interface RawStandard {
  id: string;
  rule: string;
  correct: string;
  incorrect: string;
  rule_type?: string;
  checkable_from?: string;
  relevant_content_types?: string[];
  content_type_notes?: Record<string, string>;
  version?: string;
  version_history?: StandardVersionHistoryEntry[];
  sources?: string[];
  influences?: StandardInfluence[];
}

interface RawStandardsLibrary {
  version: string;
  total_standards: number;
  categories: Array<{
    id: string;
    name: string;
    standards: RawStandard[];
  }>;
}

let cachedStandards: {
  version: string;
  total_standards: number;
  categories: SubstrateCategory[];
  byId: Record<string, SubstrateStandard>;
} | null = null;

function loadStandards() {
  if (cachedStandards) return cachedStandards;
  const p = path.join(
    process.cwd(),
    "src",
    "content_checker",
    "standards",
    "standards_library.json",
  );
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as RawStandardsLibrary;

  const categories: SubstrateCategory[] = raw.categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    standards: cat.standards.map((s) => normaliseStandard(s, cat.id, cat.name)),
  }));
  const byId: Record<string, SubstrateStandard> = {};
  for (const cat of categories) {
    for (const s of cat.standards) byId[s.id] = s;
  }

  cachedStandards = {
    version: raw.version,
    total_standards: raw.total_standards,
    categories,
    byId,
  };
  return cachedStandards;
}

function normaliseStandard(
  s: RawStandard,
  categoryId: string,
  categoryName: string,
): SubstrateStandard {
  return {
    id: s.id,
    category_id: categoryId,
    category_name: categoryName,
    rule: s.rule,
    correct: s.correct,
    incorrect: s.incorrect,
    rule_type: s.rule_type ?? "unknown",
    checkable_from: s.checkable_from,
    relevant_content_types: s.relevant_content_types ?? [],
    content_type_notes: s.content_type_notes ?? {},
    version: s.version ?? "0.0.0",
    version_history: s.version_history ?? [],
    sources: s.sources ?? [],
    influences: s.influences ?? [],
  };
}

export function getStandardsLibrary() {
  return loadStandards();
}

export function getStandardById(id: string): SubstrateStandard | null {
  return loadStandards().byId[id] ?? null;
}

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

export interface MomentWeight {
  standard_id: string;
  modifier: "emphasize" | "relax" | "suppress" | string;
  rationale: string;
}

export interface SubstrateMoment {
  id: string;
  description: string;
  situation_property: string | null;
  weights: MomentWeight[];
  emphasized_count: number;
  relaxed_count: number;
  suppressed_count: number;
}

interface RawMomentsTaxonomy {
  schema_version?: string;
  total_moments: number;
  default_moment: string;
  moments: Array<{
    id: string;
    description: string;
    situation_property: string | null;
    weights: MomentWeight[];
  }>;
}

let cachedMoments: {
  total_moments: number;
  default_moment: string;
  moments: SubstrateMoment[];
  byId: Record<string, SubstrateMoment>;
} | null = null;

function loadMoments() {
  if (cachedMoments) return cachedMoments;
  // Substrate lives in the gitignored private/ subdir per ADR 2026-04-25.
  // Local dev populates it from the private substrate repo (submodule).
  const p = path.join(
    process.cwd(),
    "src",
    "content_checker",
    "standards",
    "private",
    "moments_taxonomy.json",
  );
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as RawMomentsTaxonomy;

  const moments: SubstrateMoment[] = raw.moments.map((m) => {
    const counts = { emphasize: 0, relax: 0, suppress: 0 };
    for (const w of m.weights) {
      if (w.modifier === "emphasize") counts.emphasize += 1;
      else if (w.modifier === "relax") counts.relax += 1;
      else if (w.modifier === "suppress") counts.suppress += 1;
    }
    return {
      id: m.id,
      description: m.description,
      situation_property: m.situation_property ?? null,
      weights: m.weights,
      emphasized_count: counts.emphasize,
      relaxed_count: counts.relax,
      suppressed_count: counts.suppress,
    };
  });
  const byId: Record<string, SubstrateMoment> = {};
  for (const m of moments) byId[m.id] = m;

  cachedMoments = {
    total_moments: raw.total_moments,
    default_moment: raw.default_moment,
    moments,
    byId,
  };
  return cachedMoments;
}

export function getMomentsTaxonomy() {
  return loadMoments();
}

export function getMomentById(id: string): SubstrateMoment | null {
  return loadMoments().byId[id] ?? null;
}

/**
 * For a given standard, return every moment that emphasizes / relaxes /
 * suppresses it, along with the rationale text. Used on the standard
 * detail page to show the moment-context map for a rule.
 */
export function getMomentsTouchingStandard(
  standardId: string,
): Array<{ moment: SubstrateMoment; weight: MomentWeight }> {
  const out: Array<{ moment: SubstrateMoment; weight: MomentWeight }> = [];
  for (const m of loadMoments().moments) {
    for (const w of m.weights) {
      if (w.standard_id === standardId) {
        out.push({ moment: m, weight: w });
      }
    }
  }
  return out;
}
