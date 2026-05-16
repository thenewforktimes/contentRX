/**
 * Unit tests for the CORS allowlist (audit S5).
 *
 * Pure header-shaping logic — no fetch, no network. We assert that
 * allowed origins get echoed back, denied origins yield no
 * Allow-Origin header (browser denies the response), and the
 * common method/header preflight values stay on the response.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { corsHeaders, corsJson, corsPreflight } from "./cors";

function reqWith(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://contentrx.io/api/check", {
    method: "POST",
    headers,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("corsHeaders — allowlist", () => {
  // Figma plugin retired 2026-05-16 — the static allowlist is now
  // empty. Anti-regression: figma origins must NOT be re-allowed
  // without a deliberate new browser caller + a fresh allowlist entry.
  it("rejects the former Figma plugin null origin", () => {
    const headers = corsHeaders(reqWith("null"));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Vary"]).toBeUndefined();
  });

  it("rejects https://www.figma.com", () => {
    const headers = corsHeaders(reqWith("https://www.figma.com"));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("rejects the apex https://figma.com", () => {
    const headers = corsHeaders(reqWith("https://figma.com"));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("denies an origin not on the allowlist", () => {
    const headers = corsHeaders(reqWith("https://evil.example.com"));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Vary"]).toBeUndefined();
    // Common headers still emitted for preflight consistency.
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
  });

  it("does not allow http://www.figma.com (must be HTTPS)", () => {
    const headers = corsHeaders(reqWith("http://www.figma.com"));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("denies wildcard '*' as a literal origin string", () => {
    const headers = corsHeaders(reqWith("*"));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("omits Allow-Origin when no Origin header is present", () => {
    const headers = corsHeaders(reqWith(null));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Methods"]).toContain("OPTIONS");
  });

  it("allows http://localhost:3000 when NODE_ENV=development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const headers = corsHeaders(reqWith("http://localhost:3000"));
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
  });

  it("allows http://localhost:3001 etc. when NODE_ENV=development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const headers = corsHeaders(reqWith("http://localhost:3001"));
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3001");
  });

  it("denies localhost when NODE_ENV is not development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = corsHeaders(reqWith("http://localhost:3000"));
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("corsJson — convenience helper", () => {
  it("returns a NextResponse with the body and CORS headers", async () => {
    // Figma (the former only static origin) retired 2026-05-16;
    // localhost-dev is now the only allowed origin, so the positive
    // echo path is exercised through it.
    vi.stubEnv("NODE_ENV", "development");
    const res = corsJson(reqWith("http://localhost:3000"), { ok: true }, {
      status: 201,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(await res.json()).toEqual({ ok: true });
  });

  it("omits Allow-Origin when origin is denied", () => {
    const res = corsJson(
      reqWith("https://evil.example.com"),
      { ok: false },
      { status: 200 },
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("corsPreflight — OPTIONS shortcut", () => {
  it("returns 204 with allowlist headers", () => {
    // Post-Figma, localhost-dev is the only allowed origin; it
    // exercises the 204 + echoed-origin + methods path.
    vi.stubEnv("NODE_ENV", "development");
    const res = corsPreflight(reqWith("http://localhost:3000"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns 204 with no Allow-Origin for denied origins", () => {
    const res = corsPreflight(reqWith("https://nope.example.com"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
