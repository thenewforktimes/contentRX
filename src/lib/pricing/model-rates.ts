/**
 * Anthropic per-million-token rates, in USD.
 *
 * Used by the cost monitor to estimate per-call spend without round-
 * tripping back to Anthropic for an actual invoice. The estimate is
 * approximate (rates are list-price; an enterprise customer with
 * negotiated rates would diverge); accurate enough to catch a runaway
 * pilot before it costs real money, which is the cost monitor's
 * single job.
 *
 * Cache pricing follows Anthropic's published prompt-caching rates:
 *   - cache write: 1.25× the base input rate
 *   - cache read:  0.10× the base input rate
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 *         (snapshot 2026-04-30; revisit quarterly).
 */

export interface ModelRate {
  /** Per-million-token input rate, USD. */
  inputUsd: number;
  /** Per-million-token output rate, USD. */
  outputUsd: number;
}

/**
 * Known Anthropic models the engine routes to. Add new entries when
 * the engine starts reading a new model — the cost monitor will fall
 * through to FALLBACK_RATE for unknown ones.
 */
const MODEL_RATES: Record<string, ModelRate> = {
  // Haiku 4.5 — fast, cheap. Engine's default for standard checks.
  "claude-haiku-4-5": { inputUsd: 1, outputUsd: 5 },
  "claude-haiku-4-5-20251001": { inputUsd: 1, outputUsd: 5 },
  // Sonnet 4.6 — quality balance. Engine's pick for document-tier
  // cross-string consistency reasoning.
  "claude-sonnet-4-6": { inputUsd: 3, outputUsd: 15 },
  // Opus 4.7 — top accuracy. Reserved for surface-tier agentic review.
  "claude-opus-4-7": { inputUsd: 15, outputUsd: 75 },
};

/**
 * When the engine reports a model_id we don't know, use Sonnet's rates
 * as a conservative default. The cost monitor's job is anomaly
 * detection; over-estimating spend on an unknown model is fine
 * (better to false-pause than to false-allow a runaway).
 */
const FALLBACK_RATE: ModelRate = MODEL_RATES["claude-sonnet-4-6"];

/** Lookup the rate for a given model id, falling back to a
 * conservative Sonnet-class estimate when the model is unknown. */
export function rateFor(modelId: string | null | undefined): ModelRate {
  if (!modelId) return FALLBACK_RATE;
  return MODEL_RATES[modelId] ?? FALLBACK_RATE;
}

/**
 * Estimate the USD cost of a single /api/check completion given its
 * token telemetry. Returns a value with 6 decimal places of precision —
 * the `usage_events.estimated_cost_usd` column is `numeric(10, 6)`.
 *
 * The arithmetic uses Number — JavaScript's float resolution is fine
 * for sub-dollar costs, and the persisted column truncates to 6
 * decimals via the Postgres numeric type's storage.
 */
export function estimateCostUsd(args: {
  modelId: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}): number {
  const rate = rateFor(args.modelId);
  const perMillion = 1_000_000;
  // Anthropic's published prompt-caching rates: write at 1.25× base
  // input, read at 0.10× base input.
  const cacheWriteUsd = rate.inputUsd * 1.25;
  const cacheReadUsd = rate.inputUsd * 0.1;
  const total =
    (args.inputTokens / perMillion) * rate.inputUsd +
    (args.outputTokens / perMillion) * rate.outputUsd +
    (args.cacheCreationInputTokens / perMillion) * cacheWriteUsd +
    (args.cacheReadInputTokens / perMillion) * cacheReadUsd;
  return Math.round(total * 1_000_000) / 1_000_000;
}
