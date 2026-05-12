/**
 * TypeScript view of the engine's standards library.
 *
 * The source of truth is
 * `src/content_checker/standards/standards_library.json` (the Python
 * engine uses it for prompt construction + preprocessing). We import
 * that same file here so the dashboard's team-rules UI lists exactly
 * the rules the engine evaluates.
 *
 * Treat this as read-only. If you need to add a standard, do it in
 * the JSON; don't branch a second copy.
 */

import library from "@/content_checker/standards/private/standards_library.json";

export type StandardSummary = {
  id: string;
  rule: string;
  correct: string;
  incorrect: string;
  category: string;
};

export type CategorySummary = {
  id: string;
  name: string;
  standards: StandardSummary[];
};

type RawLibrary = {
  version: string;
  total_standards: number;
  categories: Array<{
    id: string;
    name: string;
    standards: Array<{
      id: string;
      rule: string;
      correct: string;
      incorrect: string;
    }>;
  }>;
};

const raw = library as RawLibrary;

export const CATEGORIES: CategorySummary[] = raw.categories.map((cat) => ({
  id: cat.id,
  name: cat.name,
  standards: cat.standards.map((s) => ({
    id: s.id,
    rule: s.rule,
    correct: s.correct,
    incorrect: s.incorrect,
    category: cat.id,
  })),
}));

export const STANDARDS_BY_ID: Record<string, StandardSummary> = (() => {
  const out: Record<string, StandardSummary> = {};
  for (const cat of CATEGORIES) {
    for (const s of cat.standards) out[s.id] = s;
  }
  return out;
})();

export function isKnownStandardId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(STANDARDS_BY_ID, id);
}
