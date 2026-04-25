/**
 * Env-var helpers that distinguish "missing" from "empty string".
 *
 * Vercel's UI accepts empty values silently, and `if (!process.env.X)`
 * treats both undefined and "" the same. This bit prod once with
 * CLERK_WEBHOOK_SECRET="" silently 500-ing every webhook for ~37
 * minutes. requireEnv() makes that impossible to repeat:
 *
 *   - requireEnv()                  — throws on missing OR empty
 *   - optionalEnv()                 — undefined for either case
 *   - validateRequiredEnvAtStartup() — wired in instrumentation.ts;
 *     fails the cold start in production if any required var is unset
 *     or empty, so Vercel surfaces it as a deployment error instead of
 *     a per-request 500.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Required env var ${name} is not set or is empty. ` +
        `Set it via "vercel env add ${name}" for production, ` +
        `or in .env.local for development.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "INTERNAL_EVAL_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "NEXT_PUBLIC_APP_URL",
] as const;

/**
 * Throws at server startup if any required env var is missing or empty.
 * Wired in instrumentation.ts; only runs in production.
 *
 * Upstash Redis is "either-or" — either UPSTASH_REDIS_REST_URL+TOKEN
 * (native) or KV_REST_API_URL+TOKEN (Vercel Marketplace integration)
 * counts. Both being absent fails validation.
 */
export function validateRequiredEnvAtStartup(): void {
  const missing: string[] = [];

  for (const name of REQUIRED_IN_PRODUCTION) {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") {
      missing.push(name);
    }
  }

  const upstashOk =
    optionalEnv("UPSTASH_REDIS_REST_URL") &&
    optionalEnv("UPSTASH_REDIS_REST_TOKEN");
  const kvOk =
    optionalEnv("KV_REST_API_URL") && optionalEnv("KV_REST_API_TOKEN");
  if (!upstashOk && !kvOk) {
    missing.push(
      "(UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) OR " +
        "(KV_REST_API_URL + KV_REST_API_TOKEN)",
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Production env validation failed. Missing or empty: ` +
        `${missing.join(", ")}. ` +
        `Set them via "vercel env add" before deploying.`,
    );
  }
}
