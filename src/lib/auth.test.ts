import { describe, it, expect } from "vitest";
import { domainGroupedEffectivePlan, parseBearerToken } from "./auth";

describe("parseBearerToken", () => {
  it("returns null for no header", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
  });

  it("returns null for non-Bearer auth schemes", () => {
    expect(parseBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearerToken("Digest foo=bar")).toBeNull();
  });

  it("returns null for Bearer tokens that don't start with cx_", () => {
    // Clerk session JWT starts with 'eyJ...' — should NOT be treated as our API key
    expect(parseBearerToken("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0")).toBeNull();
    // Other services
    expect(parseBearerToken("Bearer sk_test_abc123")).toBeNull();
    expect(parseBearerToken("Bearer Bearer cx_abc")).toBeNull(); // literal "Bearer cx_abc" after Bearer — not prefixed cx_
  });

  it("extracts a cx_... token from a Bearer header", () => {
    expect(parseBearerToken("Bearer cx_abc123def456")).toBe("cx_abc123def456");
  });

  it("accepts case-insensitive scheme", () => {
    expect(parseBearerToken("bearer cx_abc123def456")).toBe("cx_abc123def456");
    expect(parseBearerToken("BEARER cx_abc123def456")).toBe("cx_abc123def456");
  });

  it("trims leading/trailing whitespace inside the token", () => {
    expect(parseBearerToken("Bearer   cx_abc123def456   ")).toBe("cx_abc123def456");
  });

  it("tolerates multiple spaces between scheme and token", () => {
    expect(parseBearerToken("Bearer   cx_abc123def456")).toBe("cx_abc123def456");
  });
});

describe("domainGroupedEffectivePlan", () => {
  it("maps an entitled grouped Pro sub to the pro quota (un-pooled)", () => {
    expect(domainGroupedEffectivePlan("pro", "active")).toBe("pro");
    expect(domainGroupedEffectivePlan("pro", "trialing")).toBe("pro");
  });

  it("maps an entitled grouped Scale sub to the scale quota", () => {
    expect(domainGroupedEffectivePlan("scale", "active")).toBe("scale");
  });

  it("drops an unentitled grouped sub to free", () => {
    expect(domainGroupedEffectivePlan("pro", "canceled")).toBe("free");
    expect(domainGroupedEffectivePlan("scale", "past_due")).toBe("free");
    expect(domainGroupedEffectivePlan("pro", null)).toBe("free");
  });

  it("is conservative for tiers that shouldn't reach here", () => {
    // A real Team is handled before this is called; 'team'/'free'/
    // unknown tiers fall back to free rather than granting a bucket.
    expect(domainGroupedEffectivePlan("team", "active")).toBe("free");
    expect(domainGroupedEffectivePlan("free", "active")).toBe("free");
    expect(domainGroupedEffectivePlan(undefined, "active")).toBe("free");
  });
});
