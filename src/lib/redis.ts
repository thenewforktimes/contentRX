/**
 * Shared lazy Upstash Redis client.
 *
 * The Figma sign-in flow uses Redis as a short-lived handoff channel: the
 * callback page writes the user's cx_token under a random handoff code,
 * the plugin polls for that code until the token appears. See
 * src/app/auth/figma/route.ts and src/app/auth/figma-callback/page.tsx.
 */

import { Redis } from "@upstash/redis";
import { optionalEnv } from "./require-env";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;

  // Either-or: UPSTASH_REDIS_REST_* (native) OR KV_REST_API_* (Vercel
  // Marketplace integration). optionalEnv treats empty string the same
  // as unset so an `X=""` env var doesn't silently win the ?? chain
  // and pass an empty value to Redis().
  const url =
    optionalEnv("UPSTASH_REDIS_REST_URL") ?? optionalEnv("KV_REST_API_URL");
  const token =
    optionalEnv("UPSTASH_REDIS_REST_TOKEN") ??
    optionalEnv("KV_REST_API_TOKEN");
  if (!url || !token) {
    throw new Error(
      "Redis credentials not set. Expected UPSTASH_REDIS_REST_URL + " +
        "UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL + KV_REST_API_TOKEN " +
        "(Vercel Marketplace integration).",
    );
  }

  _redis = new Redis({ url, token });
  return _redis;
}
