/**
 * Shared constants for the Figma plugin sign-in handoff.
 *
 * Used by:
 *   - src/app/auth/figma/route.ts — polling endpoint + browser entry
 *   - src/app/auth/figma-callback/page.tsx — writes the token
 *
 * Kept in one file so a tightening of the regex or TTL on one side
 * can't silently drift from the other.
 */

export const FIGMA_HANDOFF_REDIS_PREFIX = "figma_handoff:";

/** Seconds a handoff code stays valid in Redis. */
export const FIGMA_HANDOFF_TTL_SECONDS = 300;

/**
 * Handoff codes are 24 random bytes → base64url (~32 chars), generated
 * by the Figma plugin client. Minimum 16 chars (~96 bits of entropy)
 * is enough to make brute force uneconomical given the 5-minute TTL
 * and single-use consumption.
 */
export const FIGMA_HANDOFF_REGEX = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidHandoff(handoff: string | null | undefined): handoff is string {
  return typeof handoff === "string" && FIGMA_HANDOFF_REGEX.test(handoff);
}
