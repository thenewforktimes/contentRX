/**
 * Tests for the shared bearer-token auth on cron + admin
 * server-to-server endpoints.
 *
 * `requireCronAuth` is the timing-safe replacement for the
 * pre-2026-04 string-equality check that leaked the secret byte by
 * byte. The audit's test-coverage findings flagged this as a P0
 * gap — anything that protects every `/api/cron/*` and
 * `/api/admin/refinement-signals` endpoint deserves regression
 * coverage.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireCronAuth } from "./cron-auth";

const VALID_SECRET = "super-secret-cron-token-abcdef0123456789";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/cron/whatever", { headers });
}

describe("requireCronAuth", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, CRON_SECRET: VALID_SECRET };
  });
  afterEach(() => {
    process.env = original;
  });

  it("returns null on a valid Bearer header", () => {
    const req = makeRequest({ authorization: `Bearer ${VALID_SECRET}` });
    expect(requireCronAuth(req)).toBeNull();
  });

  it("accepts the spec's case-insensitive 'bearer' prefix", () => {
    const req = makeRequest({ authorization: `bearer ${VALID_SECRET}` });
    expect(requireCronAuth(req)).toBeNull();
  });

  it("tolerates surrounding whitespace inside the token segment", () => {
    const req = makeRequest({
      authorization: `Bearer   ${VALID_SECRET}   `,
    });
    expect(requireCronAuth(req)).toBeNull();
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const req = makeRequest({});
    const res = requireCronAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when the header lacks the Bearer prefix", async () => {
    const req = makeRequest({ authorization: VALID_SECRET });
    const res = requireCronAuth(req);
    expect(res!.status).toBe(401);
  });

  it("returns 401 when the token is wrong", async () => {
    const req = makeRequest({ authorization: "Bearer wrong-token" });
    const res = requireCronAuth(req);
    expect(res!.status).toBe(401);
  });

  it("returns 401 when the token has the wrong length (constant-time path)", async () => {
    // Length mismatch must NOT short-circuit the comparison in a way
    // that's observably faster than a same-length wrong token —
    // requireCronAuth handles this by exiting at the length check
    // (after building the buffers). Either way, the response is 401
    // and the secret never appears in the body.
    const req = makeRequest({ authorization: "Bearer x" });
    const res = requireCronAuth(req);
    expect(res!.status).toBe(401);
  });

  it("returns 401 for an empty token after Bearer", async () => {
    const req = makeRequest({ authorization: "Bearer    " });
    const res = requireCronAuth(req);
    // Whitespace-only token: the regex requires at least one char
    // after \s+, so empty trailing whitespace fails the regex →
    // missing-bearer 401.
    expect(res!.status).toBe(401);
  });

  it("does not echo the expected or provided secret in the response body", async () => {
    const req = makeRequest({ authorization: `Bearer wrong-${VALID_SECRET}` });
    const res = requireCronAuth(req);
    const body = await res!.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(VALID_SECRET);
    expect(serialized).not.toContain(`wrong-${VALID_SECRET}`);
  });

  it("throws when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    const req = makeRequest({ authorization: `Bearer ${VALID_SECRET}` });
    // requireEnv throws synchronously on missing env. Cron routes
    // hand the throw to Next.js → 500 + Sentry; the test verifies
    // the throw rather than a silent 200 path, which would be the
    // dangerous regression.
    expect(() => requireCronAuth(req)).toThrow();
  });

  it("throws when CRON_SECRET is empty string", () => {
    process.env.CRON_SECRET = "";
    const req = makeRequest({ authorization: `Bearer ${VALID_SECRET}` });
    expect(() => requireCronAuth(req)).toThrow();
  });
});
