/**
 * cx_... API key helpers.
 *
 * Raw keys are shown to the user exactly once, at mint or rotate time.
 * What persists in the database is sha256(rawKey) as hex plus a short
 * prefix for the dashboard UI — the raw key never hits disk.
 */

import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";

export const API_KEY_REGEX = /^cx_[A-Za-z0-9]{16,}$/;
export const API_KEY_PREFIX_LENGTH = 12;

/**
 * Mint a fresh cx_... key. The suffix is a 24-char cuid2 — collision-
 * resistant and URL-safe, so the Figma plugin can ship it through
 * headers and query params without encoding surprises. cuid2's default
 * RNG uses the Web Crypto API in Node ≥16, so the key body is
 * cryptographically random without any extra seeding from us.
 */
export function generateApiKey(): string {
  return `cx_${createId()}`;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function apiKeyPrefix(raw: string): string {
  return raw.slice(0, API_KEY_PREFIX_LENGTH);
}

export function isWellFormedApiKey(raw: string): boolean {
  return API_KEY_REGEX.test(raw);
}
