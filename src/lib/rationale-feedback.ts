/**
 * Zod schema + types for the rationale-chain feedback path.
 *
 * Separated from `src/app/api/feedback/rationale/route.ts` so the same
 * schema can be imported by tests (and by future clients that want
 * client-side validation). Human-eval build plan Session 21.
 */

import { z } from "zod";

/**
 * Canonical pipeline hop names — mirrors `VALID_HOPS` in
 * `src/content_checker/models.py`. Kept here rather than the DB enum
 * so new engine hops don't require a migration.
 */
export const RATIONALE_HOPS = [
  "classify",
  "detect_moment",
  "filter",
  "preprocess",
  "scan",
  "validate",
  "merge",
] as const;

export const RATIONALE_CORRECTION_TYPES = [
  "situation_ambiguity",
  "other",
] as const;

export const RATIONALE_SOURCES = [
  "plugin",
  "cli",
  "action",
  "dashboard",
  "mcp",
] as const;

export const RationaleFeedbackRequestSchema = z.object({
  // 64 lowercase/uppercase hex characters == sha256. The case-
  // insensitive regex catches accidentally-unhashed text at the
  // boundary; the DB column is case-free so either case persists.
  text_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "text_hash must be a lowercase sha256 hex string"),
  hop_step: z.enum(RATIONALE_HOPS),
  correction_type: z.enum(RATIONALE_CORRECTION_TYPES),
  original_value: z.string().min(1).max(128),
  corrected_value: z.string().min(1).max(128).optional(),
  note: z.string().min(1).max(500).optional(),
  source: z.enum(RATIONALE_SOURCES).default("dashboard"),
});

export type RationaleFeedbackRequest = z.infer<
  typeof RationaleFeedbackRequestSchema
>;
