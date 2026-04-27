/**
 * Pure-function tests for team-invitations.
 *
 * DB-touching helpers (createInvitation, acceptInvitation, etc.) are
 * exercised by the route + integration tests in their respective
 * places; this file pins the deterministic primitives that those
 * routes lean on.
 */

import { describe, expect, it } from "vitest";
import {
  buildInvitationExpiresAt,
  generateInviteToken,
  isExpired,
  normalizeEmail,
  resolveTeamId,
} from "./team-invitations";

describe("generateInviteToken", () => {
  it("returns a 64-char hex string", () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces distinct tokens on repeat calls", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i += 1) tokens.add(generateInviteToken());
    expect(tokens.size).toBe(100);
  });
});

describe("buildInvitationExpiresAt", () => {
  it("defaults to 7 days from `from`", () => {
    const from = new Date("2026-04-27T00:00:00.000Z");
    const out = buildInvitationExpiresAt(from);
    expect(out.toISOString()).toBe("2026-05-04T00:00:00.000Z");
  });

  it("respects a custom day count", () => {
    const from = new Date("2026-04-27T00:00:00.000Z");
    const out = buildInvitationExpiresAt(from, 1);
    expect(out.toISOString()).toBe("2026-04-28T00:00:00.000Z");
  });

  it("does not mutate the `from` date", () => {
    const from = new Date("2026-04-27T00:00:00.000Z");
    const original = from.toISOString();
    buildInvitationExpiresAt(from);
    expect(from.toISOString()).toBe(original);
  });
});

describe("isExpired", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");

  it("is true for past timestamps", () => {
    expect(isExpired(new Date("2026-04-27T11:59:59.000Z"), now)).toBe(true);
  });

  it("is true at the exact boundary", () => {
    expect(isExpired(now, now)).toBe(true);
  });

  it("is false for future timestamps", () => {
    expect(isExpired(new Date("2026-04-27T12:00:01.000Z"), now)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Robo@Example.com  ")).toBe("robo@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail("ROBO@EXAMPLE.COM");
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("resolveTeamId", () => {
  it("returns the user's own id when they're the owner", () => {
    expect(resolveTeamId({ id: "user_a", teamOwnerUserId: null })).toBe(
      "user_a",
    );
  });

  it("returns the team owner id when they're a member", () => {
    expect(
      resolveTeamId({ id: "user_b", teamOwnerUserId: "user_a" }),
    ).toBe("user_a");
  });
});
