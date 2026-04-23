/**
 * Sanitize zod validation errors before sending them back to clients.
 *
 * Defense-in-depth. Zod v4 is already stricter than v3 — it doesn't
 * include a raw `received` field on most issue kinds — but it has
 * added/renamed kinds across minor versions before. This allowlist
 * approach keeps the 400 response contract stable across future zod
 * upgrades: clients get `path` / `code` / `message` always, plus
 * `values` on enum-style rejections (public by design).
 *
 * Specifically excluded from the passthrough:
 *   - any field that could carry user-supplied input (e.g. a future
 *     `received` or `input` field)
 *   - zod-internal metadata that clients shouldn't key off
 *     (e.g. `origin`, `inclusive`) — we can add these back field by
 *     field if a real client use case appears
 */

import type { ZodIssue } from "zod";

export type SanitizedZodIssue = {
  path: (string | number)[];
  code: string;
  message: string;
  values?: readonly (string | number)[];
};

export function sanitizeZodIssues(issues: ZodIssue[]): SanitizedZodIssue[] {
  return issues.map((issue) => {
    const base: SanitizedZodIssue = {
      path: issue.path as (string | number)[],
      code: issue.code,
      message: issue.message,
    };
    // Enum rejections: zod v4 exposes the valid values as `values`.
    // These are part of our public API contract (same as the engine
    // taxonomy), so clients can safely display them.
    if (issue.code === "invalid_value" && "values" in issue) {
      base.values = (issue as unknown as { values: readonly (string | number)[] }).values;
    }
    return base;
  });
}
