/**
 * One-shot migration runner for the agent_runs table (Phase G1).
 *
 * Replaces a `drizzle-kit push` invocation that requires TTY-style
 * confirmation we can't provide from a non-interactive shell. The SQL
 * below mirrors the statements drizzle-kit generated for this schema
 * change (CREATE TABLE + RLS + FK + two indexes). Idempotent: every
 * statement is guarded by IF NOT EXISTS where the dialect supports
 * it, and the FK is wrapped in a DO block that catches duplicate-
 * object errors.
 *
 * Usage: `node scripts/apply-agent-runs-migration.mjs` from a shell
 * that has DATABASE_URL exported (or with .env.local present —
 * dotenv loads it).
 *
 * Delete this file after the change is rolled out and any subsequent
 * db:push has been run interactively.
 */

import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// dotenv loads from process.cwd()/.env on import; force-load
// .env.local explicitly because that's the Next.js convention here.
const envLocalPath = resolve(process.cwd(), ".env.local");
try {
  const raw = readFileSync(envLocalPath, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  }
} catch {
  // .env.local missing — fall back to whatever the shell exported.
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[apply-agent-runs] DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  console.log("[apply-agent-runs] Connecting...");
  await sql`SELECT 1`;
  console.log("[apply-agent-runs] Connected. Applying migration...");

  await sql`
    CREATE TABLE IF NOT EXISTS "agent_runs" (
      "id" text PRIMARY KEY NOT NULL,
      "team_id" text NOT NULL,
      "run_at" timestamp with time zone DEFAULT now() NOT NULL,
      "window_days" integer NOT NULL,
      "total_flags" integer NOT NULL,
      "header_variant" text NOT NULL,
      "payload" jsonb NOT NULL
    )
  `;
  console.log("[apply-agent-runs]   ✓ CREATE TABLE agent_runs");

  await sql`ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY`;
  console.log("[apply-agent-runs]   ✓ ENABLE ROW LEVEL SECURITY");

  // Foreign key — wrap in a DO block so a re-run doesn't fail on
  // "constraint already exists."
  await sql`
    DO $$
    BEGIN
      ALTER TABLE "agent_runs"
      ADD CONSTRAINT "agent_runs_team_id_users_id_fk"
      FOREIGN KEY ("team_id") REFERENCES "public"."users"("id")
      ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN
      RAISE NOTICE 'agent_runs_team_id_users_id_fk already exists';
    END $$
  `;
  console.log("[apply-agent-runs]   ✓ FOREIGN KEY agent_runs.team_id → users.id");

  await sql`
    CREATE INDEX IF NOT EXISTS "agent_runs_team_run_at_idx"
    ON "agent_runs" USING btree ("team_id", "run_at")
  `;
  console.log("[apply-agent-runs]   ✓ INDEX agent_runs_team_run_at_idx");

  await sql`
    CREATE INDEX IF NOT EXISTS "agent_runs_run_at_idx"
    ON "agent_runs" USING btree ("run_at")
  `;
  console.log("[apply-agent-runs]   ✓ INDEX agent_runs_run_at_idx");

  // Verify by selecting against the new table.
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM "agent_runs"`;
  console.log(`[apply-agent-runs] Verified. agent_runs has ${count} rows.`);
} catch (err) {
  console.error("[apply-agent-runs] FAILED:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
