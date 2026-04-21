/**
 * Team rule loading + post-evaluation filtering.
 *
 * Session 3 scope: load disabled standard IDs for a team and strip any
 * violations the engine produces for those IDs. This gives the "team can
 * turn off GRM-03" acceptance test without touching the engine itself.
 *
 * Session 16 expands this to full CRUD + pre-evaluation library merging
 * (override + add actions). Keep the signature stable so Session 16 can
 * swap the implementation without touching /api/check.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

type RuleAction = "disable" | "override" | "add";

type LoadedRules = {
  disabledStandardIds: Set<string>;
  // Placeholders for Session 16:
  overrides: typeof schema.teamRules.$inferSelect[];
  adds: typeof schema.teamRules.$inferSelect[];
};

export async function loadTeamRules(
  teamOwnerUserId: string | null,
): Promise<LoadedRules> {
  const empty: LoadedRules = {
    disabledStandardIds: new Set<string>(),
    overrides: [],
    adds: [],
  };

  if (!teamOwnerUserId) return empty;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, teamOwnerUserId));

  const disabled = new Set<string>();
  const overrides: LoadedRules["overrides"] = [];
  const adds: LoadedRules["adds"] = [];

  for (const row of rows) {
    const action = row.action as RuleAction;
    if (action === "disable") disabled.add(row.standardId);
    else if (action === "override") overrides.push(row);
    else if (action === "add") adds.push(row);
  }

  return { disabledStandardIds: disabled, overrides, adds };
}

type EvaluationResult = {
  violations?: Array<{ standard_id?: string; [k: string]: unknown }>;
  passes?: Array<{ standard_id?: string; [k: string]: unknown }>;
  [k: string]: unknown;
};

/**
 * Filter violations whose standard_id appears in the disabled set.
 * Returns a new object; does not mutate.
 */
export function applyDisabledFilter<T extends EvaluationResult>(
  result: T,
  disabled: Set<string>,
): T {
  if (disabled.size === 0) return result;

  const violations = (result.violations ?? []).filter(
    (v) => !v.standard_id || !disabled.has(v.standard_id),
  );

  const next = { ...result, violations };

  // If a violation was disabled, it's effectively "passing" for this team.
  // Keep the passes list unchanged — promoting a disabled rule into passes
  // would misrepresent what the engine decided.
  return next;
}

/**
 * overall_verdict: fail ⟺ any violation remains. Recompute after filtering.
 */
export function recomputeVerdict<T extends EvaluationResult>(
  result: T,
): T & { overall_verdict: "pass" | "fail" } {
  const violations = result.violations ?? [];
  return {
    ...result,
    overall_verdict: violations.length > 0 ? "fail" : "pass",
  };
}
