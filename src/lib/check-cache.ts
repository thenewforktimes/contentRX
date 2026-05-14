/**
 * Result-level LLM response cache for /api/check.
 *
 * Anthropic prompt caching is already wired at the engine level
 * (cache_control on the standards block) and shaves the input-token
 * cost. This layer is one rung up — it short-circuits the engine call
 * entirely for repeat checks of identical input.
 *
 * Why this exists: UI copy repeats heavily. The same "Save", "Cancel",
 * "Submit" strings get linted across pages; CI workflows re-check
 * unchanged files; the dashboard's preview button re-fires checks as
 * users iterate. At 1000 DAU × 20 checks/day = 20K Anthropic calls/day;
 * even a conservative 20% repeat rate eliminates ~4K calls/day. Sonnet
 * input is ~$3 / 1M tokens, output ~$15 / 1M. At ~3K input tokens with
 * 80%+ cache hit on the standards block, plus ~500 output tokens, each
 * skipped call saves roughly $0.015 → ~$60/day → ~$1,800/month at the
 * 20% rate. The 24-hour TTL is generous; even at higher cache-miss
 * rates the savings dwarf the Redis cost.
 *
 * What's cached: the EvaluateResponse (the full engine output —
 * `result`, `tokens`, `latency_ms`). NOT the rewriteDocument output
 * (large-input only, lower hit rate; could add a parallel cache later
 * if hit data justifies it). The route still applies team rules,
 * overrides, violation logging, and usage incrementing on top of the
 * cached engine result — quota still ticks, violations still log.
 *
 * Cache key composition: every field that materially changes the
 * engine's output. Schema version is included so a wire-format bump
 * (e.g., 3.0.0 → 3.1.0) flushes stale entries automatically. The
 * caller-controlled cache namespace prefix `LLM_CACHE_VERSION` (env
 * var, defaults to "v1") gives a manual bust mechanism for the cases
 * the schema version doesn't capture — e.g., a substrate update that
 * changes engine behaviour without changing the wire shape. Bumping
 * `LLM_CACHE_VERSION` to "v2" invalidates every cached entry at once.
 *
 * Caller-supplied `precedents` are TEAM-SPECIFIC; caching when
 * precedents are present would let one team's precedent-influenced
 * result land in another team's lookup. Callers MUST skip the cache
 * (don't call get/set) when precedents are non-empty. The Boolean
 * helper `shouldCache(precedentCount)` is exported for readability.
 *
 * Failure mode: every Redis operation is wrapped in try/catch. A
 * Redis outage / DNS failure / quota exhaustion never fails a /api/check
 * request; we fall through to the engine call (or skip the cache
 * write) and log a safe error.
 */

import { createHash } from "node:crypto";
import { SCHEMA_VERSION } from "@/lib/api-envelope";
import type { EvaluateResponse } from "@/lib/evaluate";
import { getRedis } from "@/lib/redis";
import { logSafeError } from "@/lib/safe-error-log";
import { optionalEnv } from "@/lib/require-env";

// 24 hours. Long enough to absorb realistic re-check patterns (CI
// reruns of the same PR, dashboard preview iteration, teams running
// the same canonical copy from a style guide). Short enough that a
// substrate behaviour shift propagates within a day even when nobody
// bumps LLM_CACHE_VERSION manually.
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// Per-key prefix that lets operators force a full flush without
// reaching into Redis. Defaults to "v1"; bump to "v2" (or any other
// value) in Vercel env to invalidate every cached entry. Common
// reasons: a substrate library update that changes scan output, an
// engine prompt rewrite, a confidence-scoring change.
function namespace(): string {
  return optionalEnv("LLM_CACHE_VERSION") ?? "v1";
}

export interface CheckCacheKeyInputs {
  text: string;
  audience: string | undefined;
  moment: string | undefined;
  content_type: string | undefined;
}

/**
 * Build the cache key. Returns a Redis-safe string under ~150 chars.
 *
 * Exported for unit testing — the key shape is the load-bearing part
 * of correctness here. A drift in the input fields (or the order they
 * hash in) would silently re-cache wrong results.
 */
export function computeCheckCacheKey(inputs: CheckCacheKeyInputs): string {
  // sha256 over the canonical-encoded field list. Newline-delimited
  // with explicit field names so accidentally swapping moment <-> audience
  // can't produce a colliding key. Empty optionals normalized to "_".
  const canonical = [
    `schema=${SCHEMA_VERSION}`,
    `audience=${inputs.audience ?? "_"}`,
    `moment=${inputs.moment ?? "_"}`,
    `content_type=${inputs.content_type ?? "_"}`,
    `text=${inputs.text}`,
  ].join("\n");
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `check:${namespace()}:${digest}`;
}

/**
 * True iff the result of this check is safe to cache and to serve from
 * cache. Currently this means: precedent count is zero. Team-specific
 * precedents make the engine output team-specific, so caching would
 * cross-pollinate. Add new gates here as more team-specific seeds
 * land in the engine input.
 */
export function shouldCache(precedentCount: number): boolean {
  return precedentCount === 0;
}

/**
 * Look up a cached engine response. Returns null on miss, on Redis
 * outage, or on any deserialization issue (treated as miss; we'd
 * rather re-engine than serve corrupt data).
 */
export async function getCachedEvaluate(
  key: string,
): Promise<EvaluateResponse | null> {
  try {
    const redis = getRedis();
    // Upstash returns the value typed if known; we ask for unknown and
    // narrow ourselves rather than trusting the generic.
    const raw = await redis.get<unknown>(key);
    if (raw === null || raw === undefined) return null;
    if (!isEvaluateResponse(raw)) {
      // A future schema change could leave older-shaped entries in the
      // cache; treat them as misses. They'll TTL out within 24h.
      return null;
    }
    return raw;
  } catch (err) {
    logSafeError("[check-cache] get failed; falling through to engine", err);
    return null;
  }
}

/**
 * Store an engine response under the given key. Best-effort: Redis
 * failures are logged and swallowed so they never fail a request.
 * Callers typically invoke this fire-and-forget (no await, or under
 * `safeAfter`) so the cache write doesn't add latency to the response.
 */
export async function setCachedEvaluate(
  key: string,
  response: EvaluateResponse,
): Promise<void> {
  try {
    const redis = getRedis();
    // EX = TTL in seconds. Upstash supports SET with `ex` option in
    // one call (no separate EXPIRE round-trip).
    await redis.set(key, response, { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    logSafeError("[check-cache] set failed; engine response not cached", err);
  }
}

/**
 * Runtime shape guard. Cheap structural check — the engine response
 * has top-level `result`, `tokens`, `latency_ms`. We don't validate
 * the nested `result` shape because the wire format changes are
 * versioned via SCHEMA_VERSION (any breaking change bumps that and
 * invalidates cached keys automatically).
 */
function isEvaluateResponse(v: unknown): v is EvaluateResponse {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    "result" in obj &&
    "tokens" in obj &&
    "latency_ms" in obj &&
    typeof obj.latency_ms === "number"
  );
}
