/**
 * Pure parser for `taxonomy_refinement_log.md`.
 *
 * Lives separately from `admin-refinement-log.server.ts` (which marks
 * itself `server-only` to keep fs reads off the client bundle) so the
 * parsing logic can be unit-tested without webpack treating
 * `server-only` as a hard build error.
 *
 * Phase B4 of the post-pivot rolling plan
 * (`decisions/2026-04-25-private-taxonomy-pivot.md`).
 */

export type RefinementStatus =
  | "open"
  | "auto_detected"
  | "approved"
  | "declined";

export interface RefinementEntry {
  id: string;
  title: string;
  status: RefinementStatus;
  current_category?: string;
  proposed_split?: string;
  triggering_case?: string;
  architectural_consequence?: string;
  verdict?: string;
  date_logged?: string;
  note?: string;
  raw: string;
}

export interface RefinementLog {
  preface: string;
  entries: RefinementEntry[];
  byStatus: Record<RefinementStatus, RefinementEntry[]>;
}

const STATUS_HEADERS: Array<{ marker: string; status: RefinementStatus }> = [
  { marker: "## Open refinements", status: "open" },
  { marker: "## Proposed refinements", status: "auto_detected" },
  { marker: "## Approved refinements", status: "approved" },
  { marker: "## Declined refinements", status: "declined" },
];

const REF_ID_RE = /^### (REF-A?\d+)(?::?\s*(.*))?$/;
const FIELD_RE = /^\*\*([^*:]+?):\*\*\s*(.*)$/;

export function parseRefinementLog(raw: string): RefinementLog {
  const lines = raw.split("\n");
  const preface = capturePreface(lines);
  const sections = splitBySectionHeader(lines);

  const entries: RefinementEntry[] = [];
  for (const section of sections) {
    if (section.status === null) continue;
    const entryBlocks = splitByEntryHeader(section.body);
    for (const block of entryBlocks) {
      const entry = parseEntry(block, section.status);
      if (entry) entries.push(entry);
    }
  }

  const byStatus: Record<RefinementStatus, RefinementEntry[]> = {
    open: [],
    auto_detected: [],
    approved: [],
    declined: [],
  };
  for (const e of entries) byStatus[e.status].push(e);

  return { preface, entries, byStatus };
}

export function emptyRefinementLog(): RefinementLog {
  return {
    preface: "",
    entries: [],
    byStatus: { open: [], auto_detected: [], approved: [], declined: [] },
  };
}

function capturePreface(lines: string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

interface SectionBlock {
  status: RefinementStatus | null;
  body: string[];
}

function splitBySectionHeader(lines: string[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let current: SectionBlock = { status: null, body: [] };
  for (const line of lines) {
    if (line.startsWith("## ")) {
      blocks.push(current);
      const match = STATUS_HEADERS.find((s) => line.startsWith(s.marker));
      current = { status: match ? match.status : null, body: [] };
    } else {
      current.body.push(line);
    }
  }
  blocks.push(current);
  return blocks;
}

function splitByEntryHeader(body: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let inEntry = false;
  for (const line of body) {
    if (line.startsWith("### ")) {
      if (inEntry) blocks.push(current);
      current = [line];
      inEntry = true;
    } else if (inEntry) {
      current.push(line);
    }
  }
  if (inEntry) blocks.push(current);
  return blocks;
}

function parseEntry(
  block: string[],
  status: RefinementStatus,
): RefinementEntry | null {
  if (block.length === 0) return null;
  const headerMatch = block[0].match(REF_ID_RE);
  if (!headerMatch) return null;

  const id = headerMatch[1];
  const title = (headerMatch[2] ?? "").trim();

  const entry: RefinementEntry = {
    id,
    title,
    status,
    raw: block.join("\n"),
  };

  let currentField: string | null = null;
  const buffer: Record<string, string[]> = {};

  for (let i = 1; i < block.length; i++) {
    const line = block[i];
    const fieldMatch = line.match(FIELD_RE);
    if (fieldMatch) {
      const key = normaliseFieldKey(fieldMatch[1]);
      currentField = key;
      buffer[key] = [fieldMatch[2]];
    } else if (currentField) {
      buffer[currentField].push(line);
    }
  }

  for (const [key, lines] of Object.entries(buffer)) {
    const value = lines.join("\n").trim();
    if (!value) continue;
    if (key === "current_category") entry.current_category = value;
    else if (key === "proposed_split") entry.proposed_split = value;
    else if (key === "triggering_case") entry.triggering_case = value;
    else if (key === "architectural_consequence") {
      entry.architectural_consequence = value;
    } else if (key === "verdict") entry.verdict = value;
    else if (key === "date_logged") entry.date_logged = value;
    else if (key === "note") entry.note = value;
  }

  return entry;
}

function normaliseFieldKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
