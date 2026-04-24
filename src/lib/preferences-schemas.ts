/**
 * Zod schemas for the preferences surface. Shared between route
 * handlers and any tooling that submits/reads responses.
 */

import { z } from "zod";

export const PreferredSideSchema = z.enum(["left", "right", "neither"]);

export const SubmitResponseSchema = z.object({
  pair_id: z.string().min(1).max(200),
  preferred: PreferredSideSchema,
  note: z.string().max(500).optional(),
  time_ms: z.number().int().min(0).max(10 * 60 * 1000).optional(),
});
export type SubmitResponseRequest = z.infer<typeof SubmitResponseSchema>;

export const SubmitSessionSchema = z.object({
  responses: z.array(SubmitResponseSchema).min(1).max(10),
});
export type SubmitSessionRequest = z.infer<typeof SubmitSessionSchema>;

export const OptOutRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
