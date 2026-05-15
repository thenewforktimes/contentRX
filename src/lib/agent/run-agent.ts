/**
 * Weekly review agent — V1 worker (Phase G1, 2026-05-09 roadmap).
 *
 * The agent is a renderer, not a generator: every piece of substance
 * in its output already exists in the team's database before this
 * function runs. The worker reads the `violations` table (engine-
 * default flags), augments with team-customization signals
 * (overrides, custom examples, team rules) when they exist, and
 * passes the result to the deterministic grouping logic. Zero LLM
 * calls. Zero checks consumed. The cold-start path (zero overrides,
 * zero custom rules, zero custom examples) produces real
 * recommendations from engine defaults alone — team-customization
 * signal is additive, not required.
 *
 * The runtime path imports zero Anthropic SDK calls. Asserted by a
 * static-analysis test (run-agent.zero-llm.test.ts).
 *
 * Output is persisted to the `agent_runs` table for founder review
 * at `/admin/agent-runs`. The G3 work (day 4) will read these rows
 * and ship the customer-facing PR-comment digest; V1 is admin-only.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db";
import {
  digestHeaderVariant,
  groupByPattern,
  isolatedFlags,
  patternsOfTwoOrMore,
  topNPatterns,
  type Pattern,
  type ViolationSummary,
} from "./pattern-grouping";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default window the worker reads. The cron runs weekly but the read
 * window is monthly so patterns surface even when a team's checking
 * cadence is bursty (heavy on Monday, quiet through Wednesday). */
export const DEFAULT_WINDOW_DAYS = 30;

/** What the agent learned about the team's customization layer. The
 * G4 citation rendering uses these counts to decide between the
 * cold-start opener and the warmed-up opener; V1 surfaces them in
 * the payload so the agent's read of the team is auditable. */
export type CustomizationSignal = {
  overrideCount: number;
  teamRuleCount: number;
};

/** The persisted payload shape. Lives in `agent_runs.payload` as
 * JSONB. The renderer at src/lib/agent/render-digest.ts consumes this
 * shape; the digest output format is defined separately so a future
 * digest revision doesn't require backfilling old payloads.
 *
 * Schema versions:
 *   v1 (G1): teamId, runAt, windowDays, totalFlags, headerVariant,
 *            patterns, topPatterns, isolatedFlags, customization.
 *   v2 (G4): adds `agreedOverridesByStandardId` so the digest can
 *            render warmed-up citations ("your team has accepted
 *            this pattern's rewrites N times") without re-querying
 *            the DB at render time.
 */
export type AgentRunPayload = {
  schemaVersion: 2;
  teamId: string;
  runAt: string; // ISO
  windowDays: number;
  totalFlags: number;
  headerVariant: ReturnType<typeof digestHeaderVariant>;
  patterns: Pattern[];
  topPatterns: Pattern[];
  isolatedFlags: Pattern[];
  customization: CustomizationSignal;
  /** Per-standard count of "agree" overrides in the window. Used by
   * the digest's warmed-up citations: when a standard fires N times
   * in the cluster AND the team has agreed M times historically, the
   * citation cites the agreement count. Optional for forward-compat
   * with v1 payload rows already in the agent_runs table. */
  agreedOverridesByStandardId?: Record<string, number>;
};

/**
 * Read the team's recent violations and produce an agent run payload.
 * Pure with respect to time: takes `now` so tests can pin the window.
 *
 * Does NOT persist — see persistAgentRun for the DB write path.
 */
export async function buildAgentRunPayload(
  teamId: string,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<AgentRunPayload> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);

  const db = getDb();

  // Engine-default flag history. `violations` is always populated by
  // engine defaults whenever the team has run any check on any
  // surface, so the cold-start path (zero customization) still
  // produces real input here.
  const rawViolations = await db
    .select({
      standardId: schema.violations.standardId,
      severity: schema.violations.severity,
      createdAt: schema.violations.createdAt,
    })
    .from(schema.violations)
    .where(
      and(
        eq(schema.violations.teamId, teamId),
        gte(schema.violations.createdAt, windowStart),
      ),
    )
    .orderBy(desc(schema.violations.createdAt));

  const violations: ViolationSummary[] = rawViolations.map((row) => ({
    standardId: row.standardId,
    severity: coerceSeverity(row.severity),
    createdAt: row.createdAt,
  }));

  // Customization signals — purely additive. The cold-start path
  // (zero overrides, zero rules) produces a payload with
  // `customization: {0, 0}` and the digest opener falls back to the
  // cold-start variant in G4.
  const [overrideRows, agreedByStandard, teamRuleRows] = await Promise.all([
    db
      .select({ id: schema.violationOverrides.id })
      .from(schema.violationOverrides)
      .where(
        and(
          eq(schema.violationOverrides.teamId, teamId),
          gte(schema.violationOverrides.createdAt, windowStart),
        ),
      ),
    db
      .select({
        standardId: schema.violationOverrides.standardId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.violationOverrides)
      .where(
        and(
          eq(schema.violationOverrides.teamId, teamId),
          eq(schema.violationOverrides.overrideStance, "agree"),
          gte(schema.violationOverrides.createdAt, windowStart),
        ),
      )
      .groupBy(schema.violationOverrides.standardId),
    db
      .select({ id: schema.teamRules.id })
      .from(schema.teamRules)
      .where(eq(schema.teamRules.teamOwnerUserId, teamId)),
  ]);

  const customization: CustomizationSignal = {
    overrideCount: overrideRows.length,
    teamRuleCount: teamRuleRows.length,
  };

  const agreedOverridesByStandardId: Record<string, number> = {};
  for (const row of agreedByStandard) {
    agreedOverridesByStandardId[row.standardId] = row.count;
  }

  return {
    schemaVersion: 2,
    teamId,
    runAt: now.toISOString(),
    windowDays,
    totalFlags: violations.length,
    headerVariant: digestHeaderVariant(violations),
    patterns: groupByPattern(violations),
    topPatterns: topNPatterns(violations, 3),
    isolatedFlags: isolatedFlags(violations),
    customization: {
      ...customization,
    },
    agreedOverridesByStandardId,
  };
}

/**
 * Build the payload and persist it to `agent_runs`. Returns the row.
 * Used by the cron route. The two-stage shape (build + persist) keeps
 * the building step pure-ish and unit-testable, while the persistence
 * step is the side-effect that admin review surfaces depend on.
 *
 * Accepts an optional `db` handle (DbOrTx). The cron passes its
 * advisory-locked transaction so the dedupe-check and this insert
 * commit atomically — without that, two near-simultaneous cron fires
 * for the same team both saw "no existing run" and double-inserted.
 * `buildAgentRunPayload`'s reads stay on their own connection
 * (read-only; they don't need the lock — only the insert does).
 */
export async function persistAgentRun(
  teamId: string,
  opts: { windowDays?: number; now?: Date } = {},
  db: DbOrTx = getDb(),
) {
  const payload = await buildAgentRunPayload(teamId, opts);
  const [row] = await db
    .insert(schema.agentRuns)
    .values({
      teamId: payload.teamId,
      runAt: new Date(payload.runAt),
      windowDays: payload.windowDays,
      totalFlags: payload.totalFlags,
      headerVariant: payload.headerVariant,
      payload,
    })
    .returning();
  return row;
}

/** Patterns of 2+ for a payload — convenience for callers that don't
 * want to recompute. Re-uses the deterministic groupBy logic. */
export function patternsForPayload(payload: AgentRunPayload): Pattern[] {
  return patternsOfTwoOrMore(
    // Round-trip the patterns array back into ViolationSummary
    // shape via the count field so callers can reuse the helper.
    // For payload-shape inputs, we call the underlying helper
    // through the patterns array itself — the count predicate is
    // count >= 2.
    payload.patterns
      .filter((p) => p.count >= 2)
      .flatMap((p) =>
        Array.from({ length: p.count }, () => ({
          standardId: p.standardId,
          severity: "medium" as const,
          createdAt: p.lastSeen,
        })),
      ),
  );
}

/** Coerce the DB severity column (text) to the narrow union the
 * grouping logic expects. Defaults to "medium" for legacy rows that
 * predate the canonical enum. */
function coerceSeverity(raw: string): "high" | "medium" | "low" {
  if (raw === "high" || raw === "low") return raw;
  return "medium";
}
