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
  canAcceptInvitationSeat,
  generateInviteToken,
  isExpired,
  normalizeEmail,
  resolveMemberRemoval,
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

describe("canAcceptInvitationSeat", () => {
  it("allows the first member into a 2-seat team (owner + 1)", () => {
    expect(
      canAcceptInvitationSeat({ capacity: 2, memberCount: 0 }),
    ).toBe(true);
  });

  it("allows filling exactly to capacity", () => {
    // 3-seat: owner + Alice already in, Bob accepting -> 3 == 3.
    expect(
      canAcceptInvitationSeat({ capacity: 3, memberCount: 1 }),
    ).toBe(true);
  });

  it("blocks the accept that would exceed capacity", () => {
    // 2-seat, owner + 1 member already -> a 3rd person can't join.
    expect(
      canAcceptInvitationSeat({ capacity: 2, memberCount: 1 }),
    ).toBe(false);
  });

  it("blocks any accept on a 1-seat team (owner occupies seat 1)", () => {
    // Consistent with the dining-table model: seat 1 is the owner;
    // inviting a teammate requires adding seat 2 first.
    expect(
      canAcceptInvitationSeat({ capacity: 1, memberCount: 0 }),
    ).toBe(false);
  });

  it("blocks when capacity is 0 (no active Team subscription)", () => {
    expect(
      canAcceptInvitationSeat({ capacity: 0, memberCount: 0 }),
    ).toBe(false);
  });

  it("treats negative/garbage capacity as no capacity", () => {
    expect(
      canAcceptInvitationSeat({ capacity: -3, memberCount: 0 }),
    ).toBe(false);
  });

  it("downgrade edge: an unrelated pending invite no longer blocks a legitimate accept", () => {
    // 3-seat team invited Alice + Bob (2 pending), then downgraded to
    // 2 seats. Old code gated on used = 1+0+2 = 3 > 2 and rejected
    // BOTH. The headcount guard lets Alice in (owner + Alice = 2)…
    expect(
      canAcceptInvitationSeat({ capacity: 2, memberCount: 0 }),
    ).toBe(true);
    // …and then correctly blocks Bob (owner + Alice + Bob = 3 > 2).
    expect(
      canAcceptInvitationSeat({ capacity: 2, memberCount: 1 }),
    ).toBe(false);
  });
});

describe("resolveMemberRemoval", () => {
  it("lets the owner remove a member", () => {
    expect(
      resolveMemberRemoval({ callerIsOwner: true, callerIsSelf: false }),
    ).toEqual({ allowed: true, kind: "owner_removes_member" });
  });

  it("lets a member leave (remove self)", () => {
    expect(
      resolveMemberRemoval({ callerIsOwner: false, callerIsSelf: true }),
    ).toEqual({ allowed: true, kind: "member_leaves" });
  });

  it("blocks the owner from leaving their own team", () => {
    expect(
      resolveMemberRemoval({ callerIsOwner: true, callerIsSelf: true }),
    ).toEqual({ allowed: false, reason: "owner_cannot_leave" });
  });

  it("blocks a member from removing a different member", () => {
    expect(
      resolveMemberRemoval({ callerIsOwner: false, callerIsSelf: false }),
    ).toEqual({ allowed: false, reason: "not_authorized" });
  });
});
