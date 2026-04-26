/**
 * Server-only loader for the /admin/case-studies surface.
 *
 * Reads the artifacts written by `tools/case_study.py` from
 * `evals/case-studies/<slug>/`:
 *
 *   README.md              — per-target metadata + workflow notes
 *   extracted_strings.jsonl — one record per UI string from the target
 *   engine_results.jsonl   — engine public envelope per evaluated string
 *   summary.md             — auto-rolled stats from `summarize`
 *   notes.md               — hand-written observations (optional)
 *
 * The published case-study artifact lives at
 * `docs-site/content/case-studies/<slug>/page.mdx` once the target's
 * maintainers approve. THIS loader serves the *working* substrate UI:
 * what the engine saw, what the human noted, what's still pending.
 *
 * Privacy. The case-study artifacts contain only public-envelope fields
 * from the engine (`issue`, `suggestion`, `severity`, `confidence`) —
 * no `standard_id`, no `rule_version`. The PUBLIC_TAXONOMY flag is
 * irrelevant here because there's no substrate to gate.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  extractDescription,
  extractRepo,
} from "./admin-case-studies-parser";

const STUDIES_DIR = path.join(process.cwd(), "evals", "case-studies");

const FILENAME_RE = /^[A-Za-z0-9_-]+$/;

/** Engine public envelope, as written by case_study.py evaluate.
 * Mirrors `src/lib/api-envelope.ts` PublicCheckEnvelope but lives
 * here so this server file isn't coupled to the route module. */
export interface PublicCheckEnvelope {
  schema_version: string;
  verdict: "pass" | "violation" | "review_recommended" | "error";
  review_reason: string | null;
  violations: Array<{
    issue: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
    confidence: number;
  }>;
  warnings?: string[];
  latency_ms?: number;
  tokens?: {
    input?: number;
    output?: number;
    cache_read_input?: number;
    cache_creation_input?: number;
  };
  usage?: {
    plan?: string;
    used?: number;
    quota?: number;
    remaining?: number;
    month?: string;
    text_hash?: string;
  };
}

export interface EngineResultRow {
  input: {
    text: string;
    kind: string;
    source_file: string;
    line: number;
    target: string;
    head_sha: string;
  };
  response: PublicCheckEnvelope | { error: string; body?: string };
  elapsed_ms?: number;
}

export interface VerdictCounts {
  pass: number;
  violation: number;
  review_recommended: number;
  error: number;
}

export interface ReviewReasonCounts {
  [reason: string]: number;
}

export interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
}

export interface CaseStudySummary {
  slug: string;
  /** Last-modified mtime of the slug directory's README; ISO string. */
  modified_at: string;
  extracted_count: number;
  evaluated_count: number;
  error_count: number;
  verdict_counts: VerdictCounts;
  review_reason_counts: ReviewReasonCounts;
  severity_counts: SeverityCounts;
  /** Stripped from README front-matter / first paragraph; null if README absent. */
  description: string | null;
  /** Repo URL pulled from README; null if not declared. */
  repo: string | null;
  /** Last-crawled HEAD SHA; null if no extracted_strings.jsonl. */
  head_sha: string | null;
}

export interface CaseStudyDetail extends CaseStudySummary {
  readme: string | null;
  summary_md: string | null;
  notes_md: string | null;
  /** All evaluated rows. Caller paginates if needed. */
  results: EngineResultRow[];
}

/** List every case-study slug in evals/case-studies/, with per-target
 * roll-ups computed from the artifacts.
 *
 * Order: most-recently-modified first (by README mtime). */
export function listCaseStudies(): CaseStudySummary[] {
  if (!fs.existsSync(STUDIES_DIR)) return [];
  const entries = fs.readdirSync(STUDIES_DIR, { withFileTypes: true });
  const summaries: CaseStudySummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!FILENAME_RE.test(entry.name)) continue;
    const summary = loadCaseStudySummary(entry.name);
    if (summary !== null) summaries.push(summary);
  }
  summaries.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return summaries;
}

/** Load the summary slice (counts, metadata) without the full results
 * array — cheap for the index page. */
export function loadCaseStudySummary(slug: string): CaseStudySummary | null {
  if (!FILENAME_RE.test(slug)) return null;
  const dir = path.join(STUDIES_DIR, slug);
  if (!fs.existsSync(dir)) return null;

  const readmePath = path.join(dir, "README.md");
  const extractedPath = path.join(dir, "extracted_strings.jsonl");
  const resultsPath = path.join(dir, "engine_results.jsonl");

  const readmeStat = safeStat(readmePath);
  const extractedStat = safeStat(extractedPath);
  const resultsStat = safeStat(resultsPath);

  // Pick the freshest mtime across the artifact set so the index sort
  // reflects "this study was just touched," not "the README was old."
  const mtimes = [readmeStat, extractedStat, resultsStat]
    .map((s) => s?.mtime.toISOString())
    .filter((v): v is string => v !== undefined);
  const modified_at = mtimes.length === 0
    ? new Date(0).toISOString()
    : mtimes.sort().reverse()[0]!;

  const extractedRows = readJsonl(extractedPath);
  const evaluatedRows = readJsonl(resultsPath) as EngineResultRow[];

  const verdict_counts: VerdictCounts = { pass: 0, violation: 0, review_recommended: 0, error: 0 };
  const review_reason_counts: ReviewReasonCounts = {};
  const severity_counts: SeverityCounts = { high: 0, medium: 0, low: 0 };
  let error_count = 0;

  for (const row of evaluatedRows) {
    const resp = row.response;
    if ("error" in resp) {
      error_count += 1;
      verdict_counts.error += 1;
      continue;
    }
    if (resp.verdict in verdict_counts) {
      verdict_counts[resp.verdict] += 1;
    }
    if (resp.review_reason) {
      review_reason_counts[resp.review_reason] =
        (review_reason_counts[resp.review_reason] ?? 0) + 1;
    }
    for (const v of resp.violations ?? []) {
      if (v.severity in severity_counts) {
        severity_counts[v.severity] += 1;
      }
    }
  }

  const readme = readFileMaybe(readmePath);
  const description = readme === null ? null : extractDescription(readme);
  const repo = readme === null ? null : extractRepo(readme);

  // head_sha: pull from any extracted-strings row (all rows share the
  // same SHA per crawl). Fall back to null.
  const head_sha =
    extractedRows.length > 0
      ? typeof (extractedRows[0] as { head_sha?: string }).head_sha === "string"
        ? (extractedRows[0] as { head_sha?: string }).head_sha ?? null
        : null
      : null;

  return {
    slug,
    modified_at,
    extracted_count: extractedRows.length,
    evaluated_count: evaluatedRows.length,
    error_count,
    verdict_counts,
    review_reason_counts,
    severity_counts,
    description,
    repo,
    head_sha,
  };
}

/** Load the full detail view for a single slug, including all results
 * rows. Use sparingly — engine_results.jsonl can be large. */
export function loadCaseStudyDetail(slug: string): CaseStudyDetail | null {
  const summary = loadCaseStudySummary(slug);
  if (summary === null) return null;
  const dir = path.join(STUDIES_DIR, slug);
  return {
    ...summary,
    readme: readFileMaybe(path.join(dir, "README.md")),
    summary_md: readFileMaybe(path.join(dir, "summary.md")),
    notes_md: readFileMaybe(path.join(dir, "notes.md")),
    results: readJsonl(path.join(dir, "engine_results.jsonl")) as EngineResultRow[],
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function readFileMaybe(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function readJsonl(p: string): unknown[] {
  if (!fs.existsSync(p)) return [];
  const out: unknown[] = [];
  const text = fs.readFileSync(p, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines — better than failing the whole render.
    }
  }
  return out;
}

// extractDescription + extractRepo live in admin-case-studies-parser.ts
// so they're testable without the `server-only` import-time throw.
