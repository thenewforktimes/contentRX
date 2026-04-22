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

export const SCHEMA_VERSION = "1.1.0" as const;

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
