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

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set",
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
