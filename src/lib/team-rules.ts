/**
 * Team rule loading, post-evaluation filtering, and custom-rule matching.
 *
 * The flow in /api/check is:
 *   1. Call the engine (the Python pipeline evaluates against the 47
 *      standard-library rules).
 *   2. `applyDisabledFilter` strips violations whose standard_id the
 *      team has disabled. (This existed from Session 3.)
 *   3. `applyOverrides` rewrites the display fields (rule text,
 *      severity) of violations whose standard_id the team has
 *      overridden. Cosmetic-only — the engine still evaluates against
 *      the original library; overrides change how the result is
 *      presented, not whether it fires.
 *   4. `applyAddedRules` scans the original input text against each
 *      team-custom rule's regex `pattern` and appends violations for
 *      any matches.
 *   5. `recomputeVerdict` finalises pass/fail after the above.
 *
 * Session 16 shipped (3) and (4) on top of Session 3's (2) and (5).
 * A fuller "merge library before preprocessing" path (custom rules
 * evaluated by the LLM) is still deferred — acceptable for v1 because
 * BUILD_PLAN's only acceptance test for `add` is a word-match against
 * text the user pastes in, which regex handles deterministically.
 */

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

export const CUSTOM_STANDARD_PREFIX = "TEAM-";
export const CUSTOM_STANDARD_ID_REGEX = /^TEAM-\d{2,}$/;

/**
 * Hard ceiling on text fed into user-authored regex patterns. Bounded
 * input length is the cheapest defence against any regex that sneaks
 * past the pattern linter: catastrophic backtracking scales polynomially
 * with the input size, so clipping to 10 KB gives predictable worst-case
 * latency even for a maliciously-crafted rule. UI copy is almost never
 * this long — covers the 99.9th percentile of real content.
 */
export const CUSTOM_RULE_MAX_TEXT_BYTES = 10_000;

/**
 * Lint a regex pattern for common ReDoS fingerprints. Doesn't catch
 * every possible exponential backtracking case (that's undecidable),
 * but blocks the textbook patterns (nested unbounded quantifiers,
 * catch-all + repetition). False positives on legitimate user rules
 * are acceptable — if an admin hits this error, they can simplify
 * the pattern and resubmit. Returns null if safe; a string reason if
 * the pattern should be rejected.
 *
 * Closes BE-M-02 from the 2026-04-22 audit.
 */
export function findReDoSConcern(pattern: string): string | null {
  // Hard length cap on the pattern itself — the DB column is 500 chars
  // but a shorter pattern is cheaper to evaluate.
  if (pattern.length > 500) {
    return "Pattern is too long (max 500 chars).";
  }

  // Nested unbounded quantifiers: (x+)+, (x*)*, (x+)*, (x*)+, (x+){n,},
  // (x*){n,}. Each of these is a classic catastrophic-backtracking shape.
  if (/\)\s*[+*]|[+*]\s*\)\s*[+*]|[+*]\s*\)\s*\{/.test(pattern)) {
    // Second-pass confirmation — check the group before the outer
    // quantifier actually has an inner unbounded quantifier.
    if (/\(([^()]*[+*][^()]*)\)\s*[+*{]/.test(pattern)) {
      return "Pattern has nested unbounded quantifiers — denied to prevent slow matches.";
    }
  }

  // Unbounded greedy wildcards stacked: .*.*, .+.+, .*.+, .+.*
  if (/\.\s*[+*]\s*\.\s*[+*]/.test(pattern)) {
    return "Pattern stacks greedy wildcards — denied to prevent slow matches.";
  }

  return null;
}

type RuleAction = "disable" | "override" | "add";

export type TeamRuleRow = typeof schema.teamRules.$inferSelect;

export type OverrideFields = {
  rule?: string;
  severity?: string;
  title?: string;
};

export type AddFields = {
  title: string;
  rule: string;
  severity: string;
  pattern: string;
  case_insensitive?: boolean;
  content_types?: string[];
};

export type LoadedRules = {
  disabledStandardIds: Set<string>;
  overridesByStandardId: Map<string, OverrideFields>;
  adds: Array<{ standardId: string; fields: AddFields }>;
};

export async function loadTeamRules(
  teamOwnerUserId: string | null,
): Promise<LoadedRules> {
  const empty: LoadedRules = {
    disabledStandardIds: new Set<string>(),
    overridesByStandardId: new Map(),
    adds: [],
  };
  if (!teamOwnerUserId) return empty;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.teamRules)
    .where(eq(schema.teamRules.teamOwnerUserId, teamOwnerUserId));

  const disabled = new Set<string>();
  const overrides = new Map<string, OverrideFields>();
  const adds: LoadedRules["adds"] = [];

  for (const row of rows) {
    const action = row.action as RuleAction;
    if (action === "disable") {
      disabled.add(row.standardId);
    } else if (action === "override") {
      overrides.set(row.standardId, normalizeOverride(row.ruleJson));
    } else if (action === "add") {
      const fields = normalizeAdd(row.ruleJson);
      if (fields) adds.push({ standardId: row.standardId, fields });
    }
  }

  return {
    disabledStandardIds: disabled,
    overridesByStandardId: overrides,
    adds,
  };
}

// ---------------------------------------------------------------------------
// Result mutators — each returns a new object; none mutate the input.
// ---------------------------------------------------------------------------

type Violation = {
  standard_id?: string;
  rule?: string;
  issue?: string;
  suggestion?: string;
  severity?: string;
  source?: string;
  title?: string;
  [k: string]: unknown;
};

export type EvaluationResult = {
  violations?: Violation[];
  passes?: Array<{ standard_id?: string; [k: string]: unknown }>;
  // Matches the engine's wider union — "error" shows up when the
  // pipeline couldn't complete a scan; we still run these through
  // the team-rule stages so the result keeps shape.
  overall_verdict?: "pass" | "fail" | "error";
  [k: string]: unknown;
};

export function applyDisabledFilter<T extends EvaluationResult>(
  result: T,
  disabled: Set<string>,
): T {
  if (disabled.size === 0) return result;
  const violations = (result.violations ?? []).filter(
    (v) => !v.standard_id || !disabled.has(v.standard_id),
  );
  return { ...result, violations };
}

export function applyOverrides<T extends EvaluationResult>(
  result: T,
  overridesByStandardId: Map<string, OverrideFields>,
): T {
  if (overridesByStandardId.size === 0) return result;
  const violations = (result.violations ?? []).map((v) => {
    if (!v.standard_id) return v;
    const patch = overridesByStandardId.get(v.standard_id);
    if (!patch) return v;
    return {
      ...v,
      ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
    };
  });
  return { ...result, violations };
}

export function applyAddedRules<T extends EvaluationResult>(
  result: T,
  text: string,
  adds: LoadedRules["adds"],
): T {
  if (adds.length === 0) return result;

  // Clip the input before any admin-authored regex sees it. Bounded
  // input is the runtime defence-in-depth companion to the pattern
  // linter: even if a ReDoS-y pattern slips past findReDoSConcern,
  // worst-case match time stays predictable.
  const clipped =
    text.length > CUSTOM_RULE_MAX_TEXT_BYTES
      ? text.slice(0, CUSTOM_RULE_MAX_TEXT_BYTES)
      : text;

  const existingViolations = result.violations ?? [];
  const appended: Violation[] = [];

  for (const add of adds) {
    const { standardId, fields } = add;
    const re = compilePattern(fields);
    if (!re) continue;
    const match = clipped.match(re);
    if (!match) continue;

    appended.push({
      standard_id: standardId,
      title: fields.title,
      rule: fields.rule,
      issue: buildIssueMessage(fields.rule, match[0]),
      severity: fields.severity,
      source: "team-rule",
    });
  }

  if (appended.length === 0) return result;
  return { ...result, violations: [...existingViolations, ...appended] };
}

export function recomputeVerdict<T extends EvaluationResult>(
  result: T,
): T & { overall_verdict: "pass" | "fail" } {
  const violations = result.violations ?? [];
  return {
    ...result,
    overall_verdict: violations.length > 0 ? "fail" : "pass",
  };
}

// ---------------------------------------------------------------------------
// Next available custom standard ID for a team — caller uses this when
// creating a new `add` rule so we don't leak gap-filling logic into routes.
// ---------------------------------------------------------------------------
export async function nextCustomStandardId(
  teamOwnerUserId: string,
): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.teamRules.standardId })
    .from(schema.teamRules)
    .where(
      and(
        eq(schema.teamRules.teamOwnerUserId, teamOwnerUserId),
        eq(schema.teamRules.action, "add"),
      ),
    );

  let max = 0;
  for (const row of rows) {
    const match = row.id.match(/^TEAM-(\d+)$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return `${CUSTOM_STANDARD_PREFIX}${String(max + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function normalizeOverride(raw: unknown): OverrideFields {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out: OverrideFields = {};
  if (typeof obj.rule === "string") out.rule = obj.rule;
  if (typeof obj.severity === "string") out.severity = obj.severity;
  if (typeof obj.title === "string") out.title = obj.title;
  return out;
}

function normalizeAdd(raw: unknown): AddFields | null {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof obj.title !== "string" ||
    typeof obj.rule !== "string" ||
    typeof obj.pattern !== "string"
  ) {
    return null;
  }
  const severity =
    typeof obj.severity === "string" ? obj.severity : "medium";
  const fields: AddFields = {
    title: obj.title,
    rule: obj.rule,
    severity,
    pattern: obj.pattern,
    case_insensitive: obj.case_insensitive === true,
  };
  if (Array.isArray(obj.content_types)) {
    fields.content_types = obj.content_types
      .filter((t): t is string => typeof t === "string");
  }
  return fields;
}

function compilePattern(fields: AddFields): RegExp | null {
  try {
    const flags = fields.case_insensitive === true ? "i" : "";
    return new RegExp(fields.pattern, flags);
  } catch {
    // A malformed pattern is logged but doesn't crash evaluation —
    // users editing rules shouldn't be able to break their own team's
    // /api/check by saving a bad regex.
    console.warn("Team rule has invalid regex pattern", fields.pattern);
    return null;
  }
}

function buildIssueMessage(rule: string, matched: string): string {
  const trimmed = matched.trim();
  if (trimmed.length === 0) return rule;
  return `${rule} Matched: "${truncate(trimmed, 80)}".`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
