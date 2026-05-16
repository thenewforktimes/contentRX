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

/** Escape a literal token for safe embedding in a RegExp alternation.
 *  Covers every JS regex metacharacter. `-` is intentionally NOT
 *  escaped: it is only special inside a character class and we build
 *  alternations, never classes. The em dash (U+2014) and other
 *  punctuation are not metacharacters and pass through unescaped. */
function escapeRegexLiteral(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A token is "word-shaped" iff it starts and ends with an ASCII word
 *  character. Those get `\b` boundaries so a ban on "guy" doesn't fire
 *  inside "guytar". Tokens that begin or end on punctuation (the em
 *  dash "—", a leading-symbol phrase) must NOT take `\b` — a word
 *  boundary adjacent to a non-word char is unreliable across engines —
 *  so they match as bare literals. ASCII-only by design: `\b` semantics
 *  for non-ASCII letters diverge between JS (no /u) and Python `re`,
 *  and the canonical ban cases are ASCII words + the em-dash char. */
const _WORD_SHAPED = /^[A-Za-z0-9_].*[A-Za-z0-9_]$|^[A-Za-z0-9_]$/;

/**
 * Derive the single server-authored matcher for a set of literal ban
 * tokens (Project B). This is the ONE place a ban becomes a regex; the
 * customer never authors or sees it. The produced pattern string is
 * stored as `AddFields.pattern` and reused verbatim by every consumer
 * — `applyAddedRules` (the deterministic flag), the length-independent
 * `/api/check` trigger, and the engine's post-pass rewrite detector —
 * so flag, trigger, and guarantee can never disagree. It is also
 * regex-dialect-portable: the shapes emitted (`\b`, `(?:…)`,
 * alternation, escaped literals) compile identically in JS RegExp and
 * Python `re`, which is why the engine can compile the same string.
 *
 * Returns `null` when no usable token survives — the caller treats
 * that as the stylistic safe-failure (no pattern, no hard ban).
 */
export function deriveBanMatcher(
  tokens: readonly string[],
): { pattern: string; caseInsensitive: boolean } | null {
  const wordShaped: string[] = [];
  const literal: string[] = [];
  const seen = new Set<string>();

  for (const raw of tokens) {
    if (typeof raw !== "string") continue;
    const tok = raw.trim();
    if (!tok) continue;
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (_WORD_SHAPED.test(tok) ? wordShaped : literal).push(
      escapeRegexLiteral(tok),
    );
  }

  if (wordShaped.length === 0 && literal.length === 0) return null;

  const groups: string[] = [];
  if (wordShaped.length > 0) {
    groups.push(`\\b(?:${wordShaped.join("|")})\\b`);
  }
  if (literal.length > 0) {
    groups.push(`(?:${literal.join("|")})`);
  }
  const pattern =
    groups.length === 1 ? groups[0]! : `(?:${groups.join("|")})`;

  // Always case-insensitive: "Guys"/"guys"/"GUYS" are the same ban. The
  // flag is harmless for the em-dash / punctuation literals. (The
  // name-vs-colloquial concern is handled by leaveProperNouns at the
  // post-pass stage, NOT by making the matcher case-sensitive — a
  // case-sensitive matcher would silently miss "GUYS".)
  return { pattern, caseInsensitive: true };
}

type RuleAction = "disable" | "override" | "add";

export type TeamRuleRow = typeof schema.teamRules.$inferSelect;

export type OverrideFields = {
  rule?: string;
  severity?: string;
  title?: string;
};

/**
 * The deterministic-ban half of a classified custom rule (Project B,
 * 2026-05-15). Server-derived at rule-create time from the LLM
 * classifier's output — the customer states "never say guys" in plain
 * English and never sees a token list or a regex.
 *
 * `tokens` are the literal surface forms (e.g. `["guy","guys"]`, or
 * `["—"]` for an em-dash ban). They are NOT the matcher — the matcher
 * is the derived `AddFields.pattern`. Tokens drive the human-readable
 * pieces: the non-overridable TIER-1 rewrite instruction, the wording
 * of the single corrective re-prompt, and the proper-noun-collision
 * read. One derivation feeds flag + length-independent trigger +
 * post-pass detector so they can never disagree.
 */
export type BanSpec = {
  tokens: string[];
  /**
   * The "colloquial-only, leave proper nouns" hint. When true a
   * capitalized standalone occurrence that looks like a name is
   * surfaced for human disambiguation rather than auto-failed — the
   * accepted tradeoff for a real literal guarantee (you cannot have
   * both "token never ships" AND "names never flagged"
   * deterministically).
   */
  leaveProperNouns: boolean;
};

export type AddFields = {
  title: string;
  rule: string;
  severity: string;
  // Optional as of 2026-05-15. Customer-authored regex was cut from
  // the UI (hostile to write/debug, and a required field forced
  // garbage patterns into every rule). A pattern-less rule is
  // prose-only: it feeds the rewrite seam via `rule` and produces NO
  // flag. Deterministic exact-token bans return as a ContentRX-
  // *derived* pattern (project B) — never customer-authored.
  pattern?: string;
  case_insensitive?: boolean;
  content_types?: string[];
  // ---- Project B: server-DERIVED at rule-create. Customer never ----
  // ---- authors or edits these; the classifier + deriveBanMatcher ----
  // ---- set them. Absent on legacy rows ⇒ treated as style guidance, ----
  // ---- i.e. the pre-Project-B behaviour (prose → TIER 2 seam). ----
  /**
   * How this rule is enforced, and what the customer is shown.
   * "hard_ban" ⇒ deterministic flag + length-independent rewrite +
   * non-overridable TIER-1 constraint + post-pass guarantee.
   * "style_guidance" ⇒ rides the existing two-tier seam only.
   */
  enforcement?: "hard_ban" | "style_guidance";
  /** Present iff enforcement === "hard_ban". */
  ban?: BanSpec;
  /**
   * The stylistic component split out of a MIXED rule (e.g. "never
   * 'guys' AND keep long sentences" → the second clause). Rides TIER 2.
   * Empty/absent for a pure ban. For a pure stylistic rule the
   * existing `rule` prose stays the directive (unchanged path), so
   * this is only consulted for hard_ban rules that also carry style.
   */
  stylistic_directive?: string;
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

/**
 * Does `text` contain any team's hard-ban token? (Project B, length-
 * independence — Robert: "a ban is a ban, no ifs ands or buts".)
 *
 * Scope is PRECISELY the classifier-extracted ban component: only
 * `add` rules the save-time classifier marked `enforcement: "hard_ban"`
 * AND that carry a server-derived `pattern`. Stylistic directives have
 * no deterministic token, so they are not force-detected here — they
 * keep the normal rewrite-tier (length) gate. Legacy rows have no
 * `enforcement` and are skipped, preserving pre-Project-B behaviour.
 *
 * Reuses `compilePattern` and the same input clip as `applyAddedRules`,
 * so the length-independent rewrite trigger, the deterministic flag,
 * and (pt.3) the post-pass detector all match on the identical
 * server-authored matcher — they can never disagree about whether a
 * banned token is present. Pure + synchronous: the caller passes
 * already-loaded `teamRules.adds`; no extra I/O on the hot path.
 */
export function containsDerivedBanToken(
  text: string,
  adds: LoadedRules["adds"],
): boolean {
  if (adds.length === 0) return false;

  const clipped =
    text.length > CUSTOM_RULE_MAX_TEXT_BYTES
      ? text.slice(0, CUSTOM_RULE_MAX_TEXT_BYTES)
      : text;

  for (const { fields } of adds) {
    if (fields.enforcement !== "hard_ban" || !fields.pattern) continue;
    const re = compilePattern(fields);
    // compilePattern returns a non-global RegExp, so `.test` is
    // stateless (no lastIndex carry between rules).
    if (re && re.test(clipped)) return true;
  }
  return false;
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
  // pattern is NO LONGER required (2026-05-15). A rule needs only a
  // title + prose; a pattern-less rule is prose-only (feeds the
  // rewrite seam, produces no flag — see compilePattern).
  if (typeof obj.title !== "string" || typeof obj.rule !== "string") {
    return null;
  }
  const severity =
    typeof obj.severity === "string" ? obj.severity : "medium";
  const fields: AddFields = {
    title: obj.title,
    rule: obj.rule,
    severity,
    case_insensitive: obj.case_insensitive === true,
  };
  if (typeof obj.pattern === "string" && obj.pattern.length > 0) {
    fields.pattern = obj.pattern;
  }
  if (Array.isArray(obj.content_types)) {
    fields.content_types = obj.content_types
      .filter((t): t is string => typeof t === "string");
  }
  // ---- Project B server-derived fields (carried through from the ----
  // ---- jsonb verbatim; only ever written by /api/team-rules at ----
  // ---- create-time). Legacy rows have none of these → the rule is ----
  // ---- implicitly "style_guidance" and the existing seam path is ----
  // ---- preserved byte-for-byte. ----
  if (obj.enforcement === "hard_ban" || obj.enforcement === "style_guidance") {
    fields.enforcement = obj.enforcement;
  }
  if (
    typeof obj.stylistic_directive === "string" &&
    obj.stylistic_directive.length > 0
  ) {
    fields.stylistic_directive = obj.stylistic_directive;
  }
  // A ban spec is only honoured alongside a derived pattern — the
  // pattern is the matcher, the tokens are the human-readable half.
  // No pattern ⇒ nothing to deterministically enforce, so a stray
  // `ban` object can't resurrect a tokenless "ban".
  if (
    fields.enforcement === "hard_ban" &&
    fields.pattern &&
    obj.ban &&
    typeof obj.ban === "object"
  ) {
    const banObj = obj.ban as Record<string, unknown>;
    const tokens = Array.isArray(banObj.tokens)
      ? banObj.tokens.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        )
      : [];
    if (tokens.length > 0) {
      fields.ban = {
        tokens,
        leaveProperNouns: banObj.leaveProperNouns === true,
      };
    }
  }
  return fields;
}

function compilePattern(fields: AddFields): RegExp | null {
  // No pattern → no flag. Critical: without this guard,
  // `new RegExp(undefined)` compiles to /(?:)/ which matches EVERY
  // input, so every prose-only rule would flag on everything. A
  // pattern-less rule contributes only its prose to the rewrite seam.
  if (!fields.pattern) return null;
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
