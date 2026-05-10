/**
 * Export pilot corrections to the private substrate's
 * `pilot_corrections.json`.
 *
 * Per ADR 2026-05-11, the sole source is `customer_flagged_reviews`
 * rows triaged to `addressed_corpus`. Plaintext is always present on
 * these rows because the row's existence implies explicit consent
 * recorded via the Flag-for-Review modal. The merge delegates to
 * `src/lib/corpus-export.ts` and writes to the private submodule.
 * Marks each exported row's `exported_at` so re-runs are idempotent.
 *
 * Usage:
 *
 *   # Dry run — see what would be exported
 *   dotenv -e .env.local -- tsx scripts/export-corpus.ts --dry-run
 *
 *   # Real run
 *   dotenv -e .env.local -- tsx scripts/export-corpus.ts
 *
 * After a real run, the private substrate has uncommitted changes:
 *
 *   cd src/content_checker/standards/private
 *   git diff pilot_corrections.json
 *   git add pilot_corrections.json
 *   git commit -m "corpus: export N pilot corrections"
 *   git push
 *
 * Founder review at the diff stage is the human gate per the design.
 * The export script doesn't auto-push the private repo.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import {
  emptyCorrectionsFile,
  mergeCorrections,
  serializeCorrections,
  type ExportableRow,
  type PilotCorrectionsFile,
} from "../src/lib/corpus-export";

const REPO_ROOT = join(__dirname, "..");
const PRIVATE_DIR = join(
  REPO_ROOT,
  "src",
  "content_checker",
  "standards",
  "private",
);
const TARGET_FILE = join(PRIVATE_DIR, "pilot_corrections.json");

interface Args {
  dryRun: boolean;
}

function parseArgs(): Args {
  const out: Args = { dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function loadExisting(now: Date): PilotCorrectionsFile {
  if (!existsSync(TARGET_FILE)) {
    return emptyCorrectionsFile(now);
  }
  const raw = readFileSync(TARGET_FILE, "utf-8");
  return JSON.parse(raw) as PilotCorrectionsFile;
}

async function loadPendingRows(): Promise<ExportableRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.customerFlaggedReviews.id,
      standardId: sql<string | null>`null`.as("standard_id"),
      moment: schema.customerFlaggedReviews.moment,
      text: schema.customerFlaggedReviews.text,
      flagReason: schema.customerFlaggedReviews.flagReason,
      customerNote: schema.customerFlaggedReviews.customerNote,
      sourceUserId: schema.customerFlaggedReviews.userId,
      sourceTeamId: schema.customerFlaggedReviews.teamId,
      triagedAt: schema.customerFlaggedReviews.triagedAt,
    })
    .from(schema.customerFlaggedReviews)
    .where(
      and(
        eq(schema.customerFlaggedReviews.status, "addressed_corpus"),
        isNull(schema.customerFlaggedReviews.exportedAt),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    standardId: row.standardId,
    moment: row.moment,
    text: row.text,
    overrideReasonCode: row.flagReason,
    overrideReason: row.customerNote,
    sourceUserId: row.sourceUserId,
    sourceTeamId: row.sourceTeamId,
    triagedAt: row.triagedAt,
  }));
}

async function markExported(ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db
    .update(schema.customerFlaggedReviews)
    .set({ exportedAt: now })
    .where(inArray(schema.customerFlaggedReviews.id, ids));
}

async function main(): Promise<void> {
  const args = parseArgs();
  const now = new Date();

  const pending = await loadPendingRows();
  if (pending.length === 0) {
    console.log("No pending corrections. Exiting.");
    exit(0);
  }

  const existing = loadExisting(now);
  const merged = mergeCorrections(existing, pending, now);

  console.log(
    `${merged.added.length} new · ${merged.updated.length} updated · ` +
      `${merged.unchanged.length} unchanged.`,
  );

  if (merged.added.length === 0 && merged.updated.length === 0) {
    console.log("Nothing to write — corpus already up to date.");
    exit(0);
  }

  if (args.dryRun) {
    console.log("(dry run — file not written; rows not marked exported)");
    for (const entry of [...merged.added, ...merged.updated]) {
      console.log(
        `  ${entry.id} · ${entry.standard_id} · ${entry.text.slice(0, 60)}`,
      );
    }
    exit(0);
  }

  // Write the file atomically — tmp + rename so a partial write
  // can't corrupt the substrate file.
  if (!existsSync(PRIVATE_DIR)) {
    mkdirSync(PRIVATE_DIR, { recursive: true });
  }
  const tmp = `${TARGET_FILE}.tmp`;
  writeFileSync(tmp, serializeCorrections(merged.file), "utf-8");
  // Node's renameSync is atomic on the same filesystem.
  const { renameSync } = await import("node:fs");
  renameSync(tmp, TARGET_FILE);

  // Mark the exported rows so re-runs are idempotent.
  const exportedIds = [...merged.added, ...merged.updated].map((e) => e.id);
  await markExported(exportedIds, now);

  console.log(`Wrote ${TARGET_FILE}`);
  console.log(
    `Marked ${exportedIds.length} row${exportedIds.length === 1 ? "" : "s"} exported.`,
  );
  console.log("");
  console.log("Next steps (private substrate is a separate git repo):");
  console.log(
    `  cd ${join("src", "content_checker", "standards", "private")}`,
  );
  console.log("  git diff pilot_corrections.json");
  console.log("  git add pilot_corrections.json");
  console.log(
    `  git commit -m "corpus: export ${exportedIds.length} pilot correction${exportedIds.length === 1 ? "" : "s"}"`,
  );
  console.log("  git push");
  exit(0);
}

main().catch((err) => {
  console.error(err);
  exit(2);
});
