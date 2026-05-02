/**
 * Public API response envelope.
 *
 * Every public Next.js API route wraps its response with `envelope()`
 * so callers always see `schema_version` and `warnings` siblings on the
 * top-level response object. The semver policy lives in
 * `docs/API_VERSIONING.md`.
 *
 * Design choice — "lightweight envelope":
 *   We add `schema_version` and `warnings` to the existing top-level
 *   response shape rather than wrapping the previous payload inside a
 *   `result` key. That keeps every existing consumer (Figma plugin,
 *   CLI, MCP server, GitHub Action) working without code changes when
 *   we bump the version. The cost is non-uniform payloads across
 *   endpoints; the win is "old client still works after a minor bump,"
 *   which is the explicit Session 9 acceptance criterion.
 *
 *   New endpoints SHOULD put their primary data under `result` for
 *   consistency with the BUILD_PLAN_v2 envelope spec.
 */

// 1.0.0 — initial envelope (v2 Session 9)
// 1.1.0 — add `verdict`, per-Violation `confidence`, `review_reason`
//         on CheckResult (v2 Session 10). Additive.
// 1.2.0 — add `related_standards`, `ambiguity_flag`, `rule_version` on
//         Violation; add `rationale_chain` on CheckResult
//         (human-eval build plan Session 1). Additive.
// 1.3.0 — populate the remaining four typed `review_reason` subtypes:
//         standards_conflict, situation_ambiguity, out_of_distribution,
//         novel_pattern (human-eval build plan Session 2). Additive —
//         old clients reading `review_reason` as a raw string keep
//         working; clients that switch on the value should add arms.
// 1.4.0 — richer override signal on POST /api/violations/override:
//         override_stance, actor_role, rationale_expanded,
//         time_to_action_ms, suggested_text, applied_text (human-eval
//         build plan Session 3). Additive — pre-Session-3 clients
//         keep working without supplying any of the new fields.
// 1.5.0 — structured override-reason vocabulary + session grouping on
//         POST /api/violations/override: override_reason_code (5-item
//         enum), session_id (free-form grouping key for three+
//         same-standard overrides to collapse into a pushback)
//         (human-eval build plan Session 4). Additive only.
// 1.6.0 — `ensemble_disagreement` review_reason subtype +
//         `validate_rejection_reason` on Violation (human-eval build
//         plan Session 13). Scan/validate disagreement now has its
//         own subtype (previously conflated with standards_conflict).
//         Additive — old clients reading review_reason as a string
//         keep working; switch-on-value clients should add an arm.
// 1.7.0 — every Violation carries a `docs_url` field. (Python-side
//         only; TS skipped this minor bump because the field was
//         derived at serialization time and never set on the TS path.)
// 2.0.0 — **Breaking.** Private-taxonomy pivot (ADR 2026-04-25).
//         Public Violation envelope reduced to `{issue, suggestion,
//         severity, confidence}`. Removed entirely: `docs_url`,
//         `related_standards`, `rationale_chain`. Stripped from
//         user-visible surfaces but kept in substrate API
//         (founder-auth): `standard_id`, `rule`, `rule_version`,
//         `source`, `ambiguity_flag`, `validate_rejection_reason`.
//         New top-level public-envelope shape: `{schema_version,
//         violations, verdict, review_reason, warnings}` — `passes`,
//         `pipeline`, `moment`, `audience`, `content_type`, `summary`,
//         `overall_verdict` are dropped from public.
//         New: `severity` field on Violation (`high` | `medium` | `low`)
//         — auto-derived from confidence (>=0.85 high, >=0.65 medium,
//         else low). Team-rules can override per-standard.
//         Cutover is atomic: zero customers in flight; no deprecation
//         window; no field-level shim for old clients. The Python
//         engine bumps from 4.6.1 → 4.7.0 in lock-step.
// 2.1.0 — Pre-pilot metering rebuild. Adds top-level `metering` block
//         to /api/check responses: `{tier, units_consumed, input_chars,
//         input_segments, split_applied}`. Tier is one of
//         `standard | document | surface` and units_consumed is
//         denominated in standard-check equivalents (1× standard /
//         8× document / 25× surface). Additive — clients that don't
//         read `metering` continue to work unchanged. The /api/check
//         request schema gains an optional `segment_type` parameter
//         (defaults to `"standard"`).
// 2.2.0 — Customer-grounding fields. Adds `content_type` and `moment`
//         to the public envelope (both nullable). These ground each
//         check in the customer's specific situation — "Detected as a
//         button label · destructive confirmation" — so the
//         recommendations feel applied to their copy, not generic.
//         Already exposed on /dashboard/checks for the customer's
//         own history; this propagates them to live check responses
//         so surfaces can display the same context inline. Additive
//         — old clients ignoring unknown fields continue to work.
//         (No engine bump required — `to_substrate_dict()` already
//         carries the fields; this PR only changes which fields the
//         TS-side public projection forwards.)
export const SCHEMA_VERSION = "2.2.0" as const;

/**
 * Adds `schema_version` and `warnings` to a response payload. Existing
 * fields pass through unchanged.
 */
export function envelope<T extends Record<string, unknown>>(
  payload: T,
  opts: { warnings?: string[] } = {},
): T & { schema_version: string; warnings: string[] } {
  return {
    schema_version: SCHEMA_VERSION,
    warnings: opts.warnings ?? [],
    ...payload,
  };
}

/**
 * Type for an envelope-wrapped response. Use as the return type of any
 * public route handler so the contract is visible from the type system.
 */
export type ApiEnvelope<T extends Record<string, unknown>> = T & {
  schema_version: string;
  warnings: string[];
};

/**
 * Schema 2.0.0 public Violation shape. Mirrors the four-field public
 * dict produced by `Violation.to_public_dict()` in
 * `src/content_checker/models.py`. When `PUBLIC_TAXONOMY=true`,
 * substrate fields are surfaced inline alongside these — the type
 * captures the union.
 */
export type PublicViolation = {
  issue: string;
  suggestion: string;
  severity: string; // "high" | "medium" | "low"
  confidence: number;
  // Substrate fields — present only when PUBLIC_TAXONOMY=true.
  // Default product surfaces (web dashboard, MCP, CLI, Figma plugin,
  // GitHub Action, LSP, editor extensions) MUST NOT render these.
  standard_id?: string;
  rule?: string;
  source?: string;
  related_standards?: string[];
  ambiguity_flag?: string | null;
  rule_version?: string | null;
  validate_rejection_reason?: string | null;
};

/**
 * Schema 2.0.0 top-level public envelope. The /api/check route
 * decorates this with API-usage telemetry (`latency_ms`, `tokens`,
 * `usage`) at the same top level — those fields are about request
 * metadata, not taxonomy, so they live alongside the envelope rather
 * than inside it.
 */
export type PublicCheckEnvelope = {
  schema_version: typeof SCHEMA_VERSION;
  violations: PublicViolation[];
  verdict: string;
  review_reason: string | null;
  warnings: string[];
  // 2.2.0 — customer-grounding fields. The detected content type and
  // moment, in the engine's snake_case substrate enums (e.g.
  // "button" / "destructive_confirmation"). Render via
  // humanizeContentType + humanizeMoment at the boundary. Both
  // nullable because some inputs don't classify confidently.
  content_type: string | null;
  moment: string | null;
};

/**
 * Substrate-shaped CheckResult (what Python returns from /api/evaluate).
 * Loose typing; the only fields this module cares about are the ones
 * that get projected into `PublicCheckEnvelope`. Everything else is
 * substrate and gets stripped.
 */
type SubstrateCheckResult = {
  verdict?: string;
  overall_verdict?: string;
  review_reason?: string | null;
  violations?: SubstrateViolation[];
  content_type?: string | null;
  moment?: string | null;
  // ...other substrate fields ignored by the public projection.
  [key: string]: unknown;
};

type SubstrateViolation = {
  issue?: string;
  suggestion?: string;
  severity?: string;
  confidence?: number;
  standard_id?: string;
  rule?: string;
  source?: string;
  related_standards?: string[];
  ambiguity_flag?: string | null;
  rule_version?: string | null;
  validate_rejection_reason?: string | null;
  [key: string]: unknown;
};

const TRUTHY_PUBLIC_TAXONOMY = new Set(["true", "1", "yes", "on"]);

function publicTaxonomyEnabled(): boolean {
  // Read at call time, not at import time — request-scoped flips and
  // test monkeypatches must be visible. Mirrors
  // `src/lib/feature-flags.ts::isPublicTaxonomyEnabled`; duplicated
  // locally to avoid a cyclic import (feature-flags imports nothing,
  // but the hint is to keep this module dependency-free).
  const raw = process.env.PUBLIC_TAXONOMY;
  if (raw === undefined) return false;
  return TRUTHY_PUBLIC_TAXONOMY.has(raw.trim().toLowerCase());
}

/**
 * Project a substrate Violation down to the schema 2.0.0 public shape.
 * Default mode strips substrate fields entirely; PUBLIC_TAXONOMY=true
 * surfaces them inline alongside the public ones for reversibility.
 */
export function publicViolation(v: SubstrateViolation): PublicViolation {
  const out: PublicViolation = {
    issue: typeof v.issue === "string" ? v.issue : "",
    suggestion: typeof v.suggestion === "string" ? v.suggestion : "",
    severity: typeof v.severity === "string" ? v.severity : "medium",
    confidence: typeof v.confidence === "number" ? v.confidence : 0,
  };
  if (publicTaxonomyEnabled()) {
    if (v.standard_id !== undefined) out.standard_id = v.standard_id;
    if (v.rule !== undefined) out.rule = v.rule;
    if (v.source !== undefined) out.source = v.source;
    if (v.related_standards !== undefined) {
      out.related_standards = [...v.related_standards];
    }
    if (v.ambiguity_flag !== undefined) {
      out.ambiguity_flag = v.ambiguity_flag;
    }
    if (v.rule_version !== undefined) out.rule_version = v.rule_version;
    if (v.validate_rejection_reason !== undefined) {
      out.validate_rejection_reason = v.validate_rejection_reason;
    }
  }
  return out;
}

/**
 * Build the public envelope from a substrate CheckResult (the shape
 * returned by the Python engine's /api/evaluate). Strips `passes`,
 * `pipeline`, `rationale_chain`, `audience`, `summary`, and
 * `overall_verdict` from the public surface — those fields stay
 * inside the substrate response for founder-only `/admin` API
 * consumption.
 *
 * Schema 2.2.0 forwards `content_type` and `moment`. They're not
 * substrate-only; they describe the customer's own input back to
 * them so surfaces can ground recommendations in the specific
 * situation ("Detected as a button label · destructive
 * confirmation"). Both nullable when the engine didn't classify
 * confidently.
 */
export function publicCheckEnvelope(
  result: SubstrateCheckResult,
  opts: { warnings?: string[] } = {},
): PublicCheckEnvelope {
  const violations = Array.isArray(result.violations)
    ? result.violations.map(publicViolation)
    : [];
  const content_type =
    typeof result.content_type === "string" && result.content_type.length > 0
      ? result.content_type
      : null;
  const moment =
    typeof result.moment === "string" && result.moment.length > 0
      ? result.moment
      : null;
  return {
    schema_version: SCHEMA_VERSION,
    violations,
    verdict: typeof result.verdict === "string" ? result.verdict : "pass",
    review_reason:
      typeof result.review_reason === "string" ? result.review_reason : null,
    warnings: opts.warnings ?? [],
    content_type,
    moment,
  };
}
