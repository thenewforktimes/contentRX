/**
 * Request schema for POST /api/violations/adjust.
 *
 * Per ADR 2026-05-11, Adjust is verdict-only. The customer's
 * private dismissal lands in `violation_overrides`. Calibration
 * contributions come exclusively through the Flag-for-Review consent
 * flow (/api/customer-flag).
 *
 * Extracted from route.ts so the validation rules can be unit-tested
 * without mounting the full route (which needs auth + DB + ratelimit
 * mocks). The route imports this and uses it as the parser for
 * incoming bodies.
 */

import { z } from "zod";

export const RequestSchema = z.object({
  // Same 100k cap as /api/check.
  text: z.string().min(1).max(100_000),
  signal_type: z.literal("verdict"),
  // Reuses the existing override-reason-code vocabulary from
  // src/lib/override-reasons.ts so the substrate signal contract
  // stays uniform.
  override_reason_code: z.enum([
    "not_applicable_here",
    "standard_too_strict",
    "fix_is_worse",
    "shipping_anyway",
    "confusing_need_more_context",
  ]),
  override_notes: z.string().min(1).max(500).optional(),
  // Public-envelope issue text, used for clustering.
  issue: z.string().min(1).max(500).optional(),
});

export type AdjustRequest = z.infer<typeof RequestSchema>;
