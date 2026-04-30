/**
 * Pure-function library for the pilot-corrections corpus export.
 *
 * Session 8b of the post-launch corpus loop. The CLI runner at
 * `scripts/export-corpus.ts` reads `violation_overrides` rows
 * triaged to `addressed_corpus` with explicit pilot consent, then
 * delegates the JSON merge + serialization to this module so the
 * shape can be unit-tested without DB or filesystem.
 *
 * Output target: the private substrate submodule at
 * `src/content_checker/standards/private/pilot_corrections.json`.
 *
 * Idempotency contract: each entry is keyed by the override row id.
 * Re-running the export with the same input produces the same file
 * byte-for-byte (sorted keys + stable JSON formatting). New rows
 * append; updates to existing rows overwrite by id; deletes are
 * not supported — the founder edits the JSON manually if a
 * correction needs to be retracted.
 */

export const PILOT_CORRECTIONS_SCHEMA_VERSION = "1.0.0" as const;

export interface ExportableRow {
  /** The `violation_overrides.id` — used as the corpus entry key. */
  id: string;
  standardId: string;
  moment: string | null;
  text: string;
  overrideReasonCode: string | null;
  overrideReason: string | null;
  sourceUserId: string | null;
  sourceTeamId: string | null;
  /** When the row was triaged to `addressed_corpus`. Null on the
   * legacy rows that pre-date the triage flow but somehow have
   * consent + status — defensive only. */
  triagedAt: Date | null;
}

export interface PilotCorrectionEntry {
  id: string;
  standard_id: string;
  moment: string | null;
  text: string;
  human_verdict: "pass";
  override_reason_code: string | null;
  override_reason: string | null;
  source_user_id: string | null;
  source_team_id: string | null;
  triaged_at: string | null;
  exported_at: string;
}

export interface PilotCorrectionsFile {
  schema_version: typeof PILOT_CORRECTIONS_SCHEMA_VERSION;
  description: string;
  generated_at: string;
  corrections: PilotCorrectionEntry[];
}

/** Build a fresh empty file (no existing corpus on disk). */
export function emptyCorrectionsFile(now: Date = new Date()): PilotCorrectionsFile {
  return {
    schema_version: PILOT_CORRECTIONS_SCHEMA_VERSION,
    description:
      "Pilot corrections — overrides triaged `addressed_corpus` with " +
      "explicit pilot consent. Each entry represents a single dismissal " +
      "where the human verdict ('pass') overrode the engine's verdict. " +
      "Per-entry data, never aggregated; private to the substrate repo.",
    generated_at: now.toISOString(),
    corrections: [],
  };
}

/** Convert a DB row into an exported corpus entry. */
function toEntry(row: ExportableRow, exportedAt: Date): PilotCorrectionEntry {
  return {
    id: row.id,
    standard_id: row.standardId,
    moment: row.moment,
    text: row.text,
    human_verdict: "pass",
    override_reason_code: row.overrideReasonCode,
    override_reason: row.overrideReason,
    source_user_id: row.sourceUserId,
    source_team_id: row.sourceTeamId,
    triaged_at: row.triagedAt ? row.triagedAt.toISOString() : null,
    exported_at: exportedAt.toISOString(),
  };
}

export interface MergeResult {
  file: PilotCorrectionsFile;
  /** Newly-added entries (id wasn't present before). */
  added: PilotCorrectionEntry[];
  /** Replaced entries (id was present; field values changed). */
  updated: PilotCorrectionEntry[];
  /** Existing entries that are unchanged after merge. */
  unchanged: PilotCorrectionEntry[];
}

/**
 * Merge new exportable rows into an existing corpus file. Entries
 * are sorted by id so the output is deterministic across runs.
 *
 * Pure: no side effects, no IO. Caller writes the result to disk.
 */
export function mergeCorrections(
  existing: PilotCorrectionsFile,
  rows: ExportableRow[],
  now: Date = new Date(),
): MergeResult {
  const byId = new Map<string, PilotCorrectionEntry>();
  for (const entry of existing.corrections) {
    byId.set(entry.id, entry);
  }

  const added: PilotCorrectionEntry[] = [];
  const updated: PilotCorrectionEntry[] = [];
  const unchanged: PilotCorrectionEntry[] = [];
  const seenInBatch = new Set<string>();

  for (const row of rows) {
    const next = toEntry(row, now);
    const prev = byId.get(row.id);
    seenInBatch.add(row.id);
    if (!prev) {
      added.push(next);
      byId.set(row.id, next);
      continue;
    }
    if (entriesEqualIgnoringExport(prev, next)) {
      // No real change; keep the prior entry (preserves original
      // exported_at so re-runs don't churn the file).
      unchanged.push(prev);
      continue;
    }
    updated.push(next);
    byId.set(row.id, next);
  }

  // Existing entries that weren't in this batch — preserved as-is,
  // counted under unchanged so the caller's summary is accurate.
  for (const [id, entry] of byId.entries()) {
    if (!seenInBatch.has(id) && !added.some((e) => e.id === id)) {
      unchanged.push(entry);
    }
  }

  const sorted = Array.from(byId.values()).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  return {
    file: {
      schema_version: PILOT_CORRECTIONS_SCHEMA_VERSION,
      description: existing.description,
      generated_at: now.toISOString(),
      corrections: sorted,
    },
    added,
    updated,
    unchanged,
  };
}

function entriesEqualIgnoringExport(
  a: PilotCorrectionEntry,
  b: PilotCorrectionEntry,
): boolean {
  return (
    a.id === b.id &&
    a.standard_id === b.standard_id &&
    a.moment === b.moment &&
    a.text === b.text &&
    a.human_verdict === b.human_verdict &&
    a.override_reason_code === b.override_reason_code &&
    a.override_reason === b.override_reason &&
    a.source_user_id === b.source_user_id &&
    a.source_team_id === b.source_team_id &&
    a.triaged_at === b.triaged_at
  );
}

/** Serialize the file with stable formatting (2-space indent,
 * trailing newline) so a re-run produces a byte-identical file
 * when nothing changed. */
export function serializeCorrections(file: PilotCorrectionsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
