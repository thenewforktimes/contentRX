/**
 * App-side feature flags.
 *
 * Currently exposes one flag — `PUBLIC_TAXONOMY` — which controls
 * whether `standard_id` and `rule_version` populate on user-facing
 * surfaces. See `decisions/2026-04-25-private-taxonomy-pivot.md` for
 * the policy and the alternatives considered.
 *
 * Default is `false` everywhere. The flag is the single configurable
 * boundary between the (default) private-taxonomy world and the
 * (preserved-but-off) public-taxonomy world. Code paths gated by it
 * stay in the codebase even when off — they are reversibility
 * insurance, not dead code.
 *
 * Reads happen via `isPublicTaxonomyEnabled()` rather than a
 * module-level constant so tests can override `process.env` and
 * pre-render boundaries get the value at request time, not at module
 * import time.
 *
 * Truthy values (case-insensitive): `"true"`, `"1"`, `"yes"`, `"on"`.
 * Anything else (including the empty string and unset env vars) is
 * falsy. Unrecognized values fail closed (false) so a typo in the env
 * value doesn't accidentally leak the substrate.
 *
 * Mirrors `src/content_checker/config.py::is_public_taxonomy_enabled`
 * — the two must agree on truthiness rules. Parity is exercised by the
 * `.github/workflows/public-taxonomy-smoke.yml` CI job which runs both
 * test suites with `PUBLIC_TAXONOMY=true`.
 */

const PUBLIC_TAXONOMY_ENV_VAR = "PUBLIC_TAXONOMY";
const TRUTHY_VALUES: ReadonlySet<string> = new Set([
  "true",
  "1",
  "yes",
  "on",
]);

export function isPublicTaxonomyEnabled(): boolean {
  const raw = process.env[PUBLIC_TAXONOMY_ENV_VAR];
  if (raw === undefined) return false;
  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}
