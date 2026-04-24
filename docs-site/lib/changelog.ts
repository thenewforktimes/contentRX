/**
 * Taxonomy changelog aggregator.
 *
 * Human-eval build plan Session 23. Consolidates two canonical sources
 * into a single date-sorted timeline the `/model/changelog` page
 * renders:
 *
 *   - `version_history` arrays from each standard in
 *     `standards_library.json` (Session 1 added this per-standard).
 *   - The `## Approved refinements` section in
 *     `taxonomy_refinement_log.md` — parsed from the markdown headers
 *     `### REF-NNN:` underneath the Approved section and before any
 *     following `## ` section.
 *
 * The refinement-log parser is intentionally narrow. The log is a
 * human-curated document; we scan the section it publishes under and
 * extract only the entries we commit to — additions to the log's
 * pending / declined sections don't leak into the public changelog.
 *
 * No hand-maintained date lists. Both sources carry explicit dates;
 * the aggregator sorts newest-first.
 */

import fs from "node:fs";
import path from "node:path";
import libraryJson from "./standards_library.json";
import type { StandardsLibrary } from "./standards";

/**
 * Read the refinement log at build time. The log lives under
 * `docs-site/lib/taxonomy_refinement_log.md` (copied by the prebuild
 * script from the repo root). Kept out of `import` because
 * `next.config.mjs` maps `.md` to MDX pages — plain text needs fs.
 *
 * Next.js statically renders `/model/changelog`, so this fs call
 * happens once at build; the output HTML is then served without
 * further reads at runtime.
 */
function loadRefinementLogMarkdown(): string {
  const p = path.join(
    process.cwd(),
    "lib",
    "taxonomy_refinement_log.md",
  );
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

export type ChangelogEntry =
  | StandardVersionEntry
  | ApprovedRefinementEntry;

export interface StandardVersionEntry {
  kind: "standard_version";
  date: string; // ISO-ish "YYYY-MM-DD"
  standard_id: string;
  version: string;
  change_note: string;
}

export interface ApprovedRefinementEntry {
  kind: "approved_refinement";
  /** Best-effort date extracted from the log entry body. */
  date: string;
  /** REF-NNN identifier. */
  ref_id: string;
  /** Full header title minus the `REF-NNN: ` prefix. */
  title: string;
  /** Markdown body between this header and the next `### REF-` or `## `. */
  body: string;
}

export interface ChangelogData {
  entries: ChangelogEntry[];
  /** Window start + end used by the "last 30 days" success metric. */
  generated_at: string;
}

// Narrow regex for `### REF-012: title text`. The plan reserves
// REF-NNN for refinement identifiers; anything else in the Approved
// section is ignored.
const REF_HEADER_RE = /^###\s+(REF-\d+)\s*:?\s*(.*)$/;
// Best-effort date capture: `**Date logged:** 2026-03-30` or
// `**Approved on:** 2026-04-15`. Flexible keyword so the log's
// drafters can edit the prefix without breaking the parser.
const DATE_LINE_RE = /\*\*(?:Date\s+logged|Approved(?:\s+on)?):\*\*\s*(\d{4}-\d{2}-\d{2})/i;

export function parseApprovedRefinements(
  markdown: string,
): ApprovedRefinementEntry[] {
  const lines = markdown.split(/\r?\n/);
  // Find the `## Approved refinements` header and the next `## ` (top-
  // level) header. Everything between is the Approved block. The
  // Declined and Open sections live outside and are ignored.
  const startIdx = lines.findIndex((ln) =>
    /^##\s+Approved refinements\s*$/i.test(ln),
  );
  if (startIdx < 0) return [];
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]!) && !/^###/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }

  const out: ApprovedRefinementEntry[] = [];
  let current: {
    ref_id: string;
    title: string;
    bodyLines: string[];
    startLine: number;
  } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.bodyLines.join("\n").trim();
    const dateMatch = body.match(DATE_LINE_RE);
    out.push({
      kind: "approved_refinement",
      date: dateMatch ? dateMatch[1]! : "0000-00-00",
      ref_id: current.ref_id,
      title: current.title.trim(),
      body,
    });
    current = null;
  };

  for (let i = startIdx + 1; i < endIdx; i += 1) {
    const ln = lines[i]!;
    const header = ln.match(REF_HEADER_RE);
    if (header) {
      flush();
      current = {
        ref_id: header[1]!,
        title: header[2]!,
        bodyLines: [],
        startLine: i,
      };
    } else if (current) {
      current.bodyLines.push(ln);
    }
  }
  flush();
  return out;
}

export function collectStandardVersionEntries(
  library: StandardsLibrary,
): StandardVersionEntry[] {
  const out: StandardVersionEntry[] = [];
  for (const cat of library.categories) {
    for (const std of cat.standards) {
      const history = std.version_history ?? [];
      for (const entry of history) {
        out.push({
          kind: "standard_version",
          date: entry.date,
          standard_id: std.id,
          version: entry.version,
          change_note: entry.change_note,
        });
      }
    }
  }
  return out;
}

export function loadChangelog(
  nowIso: string = new Date().toISOString(),
): ChangelogData {
  const library = libraryJson as unknown as StandardsLibrary;
  const standards = collectStandardVersionEntries(library);
  const refinements = parseApprovedRefinements(loadRefinementLogMarkdown());
  const merged: ChangelogEntry[] = [...standards, ...refinements];
  merged.sort((a, b) => {
    if (a.date === b.date) {
      const aId =
        a.kind === "standard_version" ? a.standard_id : a.ref_id;
      const bId =
        b.kind === "standard_version" ? b.standard_id : b.ref_id;
      return aId.localeCompare(bId);
    }
    return b.date.localeCompare(a.date);
  });
  return {
    entries: merged,
    generated_at: nowIso,
  };
}

/**
 * Filter down to the last N days. Success criterion: "every taxonomy
 * change in the previous 30 days has a changelog entry." We surface
 * the recent window prominently at the top of the page.
 */
export function entriesWithinDays(
  entries: ChangelogEntry[],
  days: number,
  nowIso: string = new Date().toISOString(),
): ChangelogEntry[] {
  const now = Date.parse(nowIso);
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return entries.filter((e) => {
    const t = Date.parse(`${e.date}T00:00:00Z`);
    return Number.isFinite(t) && t >= cutoff;
  });
}
