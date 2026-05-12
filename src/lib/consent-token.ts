/**
 * Signed-nonce CARL consent tokens.
 *
 * The auto-renewal consent path used to trust `autoRenewalConsented: true`
 * in the /api/checkout request body verbatim. That made the consent
 * record forgeable from outside the UI flow — a curl request could
 * stamp consent without the customer ever seeing the CARL checkbox.
 *
 * This module hardens the consent path with HMAC-signed, single-use,
 * time-bound tokens minted server-side during /dashboard render and
 * verified by /api/checkout.
 *
 * Cryptographic protocol (intentionally minimal — no JOSE header, no
 * algorithm-negotiation; HMAC-SHA256 only):
 *
 *   payload = JSON.stringify({
 *     uid:   <user.id>,                  // bound to the authenticated user
 *     iat:   <unix-ms>,                  // mint time; used for TTL
 *     act:   "auto-renewal",             // action this token authorises
 *     nonce: <16 random bytes b64url>,   // 128 bits, single-use
 *   })
 *   signature = HMAC-SHA256(CONSENT_HMAC_SECRET, payload)
 *   token     = b64url(payload) + "." + b64url(signature)
 *
 * Verify checks (all must pass):
 *   1. Token parses as `<b64url-payload>.<b64url-signature>`
 *   2. HMAC over the decoded payload matches the decoded signature
 *      (constant-time compare via Node `timingSafeEqual`)
 *   3. Payload `uid` matches the authenticated request's userId
 *   4. Payload `act` matches the expected action
 *   5. `iat` is within `TOKEN_TTL_MS` of now (default 15 min)
 *   6. Redis `SET NX` on the nonce succeeds (single-use; replays
 *      within the TTL window are rejected even though the token
 *      itself would otherwise verify)
 *
 * What this proves (legal evidence layer for CARL compliance):
 *   - The /dashboard page was server-rendered at time `iat` for user `uid`
 *   - The consent claim arrived at /api/checkout from a request that
 *     possessed the token (i.e. control of the UI session at mint time)
 *   - The token has not been replayed
 *
 * What this does NOT prove:
 *   - That the human eyes that read the checkbox label and the human
 *     fingers that ticked the box belong to the account owner. No
 *     stateless protocol can prove that; we rely on Clerk authentication
 *     + hardware-key MFA upstream.
 *
 * Env var: `CONSENT_HMAC_SECRET` — base64-encoded 32+ random bytes.
 * Generate with `openssl rand -base64 32` and store via `vercel env add`.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getRedis } from "./redis";
import { requireEnv } from "./require-env";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const NONCE_BYTES = 16; // 128 bits
const REDIS_NONCE_PREFIX = "consent_nonce:";
// Single-use window > TOKEN_TTL so a replay can never sneak through
// after the time-window check. We hold the nonce in Redis for 24h.
const REDIS_NONCE_TTL_SECONDS = 24 * 60 * 60;

export type ConsentAction = "auto-renewal";

export interface ConsentTokenPayload {
  uid: string;
  iat: number;
  act: ConsentAction;
  nonce: string;
}

export interface MintArgs {
  userId: string;
  action: ConsentAction;
}

export interface VerifyArgs {
  token: string;
  expectedUserId: string;
  expectedAction: ConsentAction;
  /** Override for tests; production uses TOKEN_TTL_MS. */
  ttlMs?: number;
  /** Override for tests; production uses Date.now(). */
  now?: number;
}

export type VerifyResult =
  | { ok: true; nonce: string; issuedAt: number }
  | { ok: false; reason: VerifyFailureReason };

export type VerifyFailureReason =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "wrong-user"
  | "wrong-action"
  | "replayed";

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  // Restore padding before base64 decode. The url-safe variant strips
  // it; Node `Buffer.from(..., "base64")` accepts padded input.
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
}

function getSecret(): Buffer {
  // requireEnv throws on missing OR empty — matches the posture used
  // for STRIPE_WEBHOOK_SECRET and CLERK_WEBHOOK_SECRET. The token
  // module is dead-on-arrival without a real secret; failing closed
  // here is what we want.
  return Buffer.from(requireEnv("CONSENT_HMAC_SECRET"), "utf8");
}

function sign(payload: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/**
 * Mint a consent token. The returned string is opaque to the client —
 * it goes into the /api/checkout request body unchanged.
 */
export function mintConsentToken(args: MintArgs): string {
  const payload: ConsentTokenPayload = {
    uid: args.userId,
    iat: Date.now(),
    act: args.action,
    nonce: b64urlEncode(randomBytes(NONCE_BYTES)),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = b64urlEncode(Buffer.from(payloadJson, "utf8"));
  const signature = sign(payloadEncoded, getSecret());
  return `${payloadEncoded}.${b64urlEncode(signature)}`;
}

/**
 * Verify a consent token. Returns either `{ ok: true, nonce, issuedAt }`
 * on success or `{ ok: false, reason }` describing the first check that
 * failed. Single-use enforcement happens via Redis — the nonce is
 * claimed on every successful verify and a replay returns
 * `{ ok: false, reason: "replayed" }`.
 */
export async function verifyConsentToken(
  args: VerifyArgs,
): Promise<VerifyResult> {
  const now = args.now ?? Date.now();
  const ttlMs = args.ttlMs ?? TOKEN_TTL_MS;

  const parts = args.token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadEncoded, signatureEncoded] = parts;
  if (!payloadEncoded || !signatureEncoded) {
    return { ok: false, reason: "malformed" };
  }

  let payload: ConsentTokenPayload;
  try {
    const payloadJson = b64urlDecode(payloadEncoded).toString("utf8");
    payload = JSON.parse(payloadJson) as ConsentTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload.uid !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.act !== "string" ||
    typeof payload.nonce !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }

  // Signature check before user/action/expiry so we don't leak
  // structural details about valid tokens to an attacker probing
  // with random payloads.
  const expected = sign(payloadEncoded, getSecret());
  let provided: Buffer;
  try {
    provided = b64urlDecode(signatureEncoded);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (provided.length !== expected.length) {
    return { ok: false, reason: "bad-signature" };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  if (payload.uid !== args.expectedUserId) {
    return { ok: false, reason: "wrong-user" };
  }
  if (payload.act !== args.expectedAction) {
    return { ok: false, reason: "wrong-action" };
  }
  if (now - payload.iat > ttlMs || payload.iat > now) {
    // `payload.iat > now` catches clock-skew + future-dated tokens. A
    // token minted ahead of the verifier's clock should not be accepted.
    return { ok: false, reason: "expired" };
  }

  // Single-use: claim the nonce in Redis. If the key already exists,
  // someone replayed the token within the TTL window. Reject.
  try {
    const redis = getRedis();
    const setResult = await redis.set(
      REDIS_NONCE_PREFIX + payload.nonce,
      "1",
      { nx: true, ex: REDIS_NONCE_TTL_SECONDS },
    );
    if (setResult === null) {
      return { ok: false, reason: "replayed" };
    }
  } catch {
    // Redis outage shouldn't block a legitimate consent. The other
    // verify checks (HMAC + TTL + uid + action) still hold; the
    // window of vulnerability is "Redis was down AND an attacker
    // captured a fresh-minted token AND replayed it within 15 min".
    // We accept that narrow window over hard-failing the customer's
    // checkout flow. Document in PR body so the trade-off is
    // explicit; consider promoting to hard-fail when the platform
    // settles.
  }

  return { ok: true, nonce: payload.nonce, issuedAt: payload.iat };
}
