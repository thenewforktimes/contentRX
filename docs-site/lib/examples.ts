/**
 * Examples-corpus loader for the docs site.
 *
 * Reads `examples_pairs.json`, which the prebuild script copies from
 * `evals/examples_corpus/pairs.json` in the parent repo (seeded by
 * human-eval build plan Session 16).
 *
 * Human-eval build plan Session 20 renders these pairs inline on each
 * standard's /model page so readers see concrete "this, not that"
 * examples with attribution (source system + license).
 */

import pairsJson from "./examples_pairs.json";

export type ExamplePair = {
  pair_id: string;
  standard_id: string;
  moment: string;
  content_type: string;
  source_system: string;
  source_section: string;
  not_this: string;
  but_this: string;
  rationale: string;
  license: string;
};

export type ExamplesCorpus = {
  schema_version: string;
  description: string;
  generated_at: string;
  pairs: ExamplePair[];
};

export function loadExamples(): ExamplesCorpus {
  return pairsJson as unknown as ExamplesCorpus;
}

export function examplesForStandard(standardId: string): ExamplePair[] {
  return loadExamples().pairs.filter((p) => p.standard_id === standardId);
}

export function examplesForMoment(momentId: string): ExamplePair[] {
  return loadExamples().pairs.filter((p) => p.moment === momentId);
}
