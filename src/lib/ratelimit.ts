/**
 * Per-user rate limit via Upstash Redis.
 *
 * 60 requests / minute, sliding window — catches bursts without blocking
 * steady usage. Upstash client is lazy-initialized so the module can be
 * imported at build time without the env vars set.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
let _ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit {
  if (_ratelimit) return _ratelimit;

  // Accept both naming conventions:
  //   - UPSTASH_REDIS_REST_* — native Upstash naming (standalone Upstash account)
  //   - KV_REST_API_*        — Vercel Marketplace Upstash integration, which
  //                            preserves the legacy @vercel/kv env var names
  //                            for backward compat.
  // Identical Redis, different env var keys depending on how the DB was
  // provisioned. Try the native names first, fall back to Vercel Marketplace.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Redis credentials not set. Expected UPSTASH_REDIS_REST_URL + " +
        "UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL + KV_REST_API_TOKEN " +
        "(Vercel Marketplace integration).",
    );
  }

  _redis = new Redis({ url, token });
  _ratelimit = new Ratelimit({
    redis: _redis,
    limiter: Ratelimit.slidingWindow(60, "60 s"),
    prefix: "ratelimit:check",
    analytics: true,
  });

  return _ratelimit;
}

export type RatelimitResult = {
  success: boolean;
  remaining: number;
  reset: number;
};

export async function checkRateLimit(userId: string): Promise<RatelimitResult> {
  const rl = getRatelimit();
  const { success, remaining, reset } = await rl.limit(userId);
  return { success, remaining, reset };
}
