/**
 * Standards loader for the docs site.
 *
 * Reads the engine's `standards_library.json` directly so docs stay in
 * lock-step with the running version of the evaluator. The JSON is
 * resolved relative to the docs-site directory so this works under both
 * `next dev` and the deployed build.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Standard = {
  id: string;
  rule: string;
  correct?: string;
  incorrect?: string;
  rule_type?: "hard" | "nuanced" | string;
  checkable_from?: string;
  relevant_content_types?: string[];
  content_type_notes?: Record<string, string>;
};

export type Category = {
  id: string;
  name: string;
  standards: Standard[];
};

export type ContentType = {
  id: string;
  name: string;
  description: string;
};

export type StandardsLibrary = {
  version: string;
  total_standards: number;
  content_types: ContentType[];
  categories: Category[];
};

let cached: StandardsLibrary | null = null;

export function loadLibrary(): StandardsLibrary {
  if (cached) return cached;
  // Resolve relative to the docs-site root, walking up to the repo root
  // for the canonical engine path.
  const path = join(
    process.cwd(),
    "..",
    "src",
    "content_checker",
    "standards",
    "standards_library.json",
  );
  const raw = readFileSync(path, "utf-8");
  cached = JSON.parse(raw) as StandardsLibrary;
  return cached;
}

export function getStandard(id: string): Standard | null {
  const lib = loadLibrary();
  for (const cat of lib.categories) {
    const std = cat.standards.find((s) => s.id === id);
    if (std) return std;
  }
  return null;
}

export function categoryOfStandard(id: string): Category | null {
  const lib = loadLibrary();
  return (
    lib.categories.find((c) => c.standards.some((s) => s.id === id)) ?? null
  );
}

export function allStandardIds(): string[] {
  return loadLibrary().categories.flatMap((c) => c.standards.map((s) => s.id));
}
