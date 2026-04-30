import { describe, expect, it } from "vitest";
import {
  activityStatus,
  conversationTriggers,
  type PilotRow,
} from "./pilot-tracker";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("activityStatus()", () => {
  const now = new Date("2026-04-30T12:00:00Z");

  it("returns dormant when lastCheckAt is null", () => {
    expect(activityStatus(null, now)).toBe("dormant");
  });

  it("returns green within 48h", () => {
    expect(
      activityStatus(new Date(now.getTime() - 12 * HOUR_MS), now),
    ).toBe("green");
    expect(
      activityStatus(new Date(now.getTime() - 47 * HOUR_MS), now),
    ).toBe("green");
  });

  it("returns amber 48h–7d", () => {
    expect(
      activityStatus(new Date(now.getTime() - 49 * HOUR_MS), now),
    ).toBe("amber");
    expect(
      activityStatus(new Date(now.getTime() - 6 * DAY_MS), now),
    ).toBe("amber");
  });

  it("returns red beyond 7d", () => {
    expect(
      activityStatus(new Date(now.getTime() - 8 * DAY_MS), now),
    ).toBe("red");
  });
});

describe("conversationTriggers()", () => {
  const baseRow: Omit<PilotRow, "userId" | "email"> = {
    plan: "pro",
    costPauseActive: false,
    lastCheckAt: new Date(),
    checks7d: 0,
    checksTotal: 0,
    overrideCount: 0,
    status: "green",
  };

  it("returns no triggers for steady-state users", () => {
    const triggers = conversationTriggers([
      { ...baseRow, userId: "u1", email: "alice@test.local" },
    ]);
    expect(triggers).toEqual([]);
  });

  it("fires debrief_50_checks when checks7d ≥ 50", () => {
    const triggers = conversationTriggers([
      {
        ...baseRow,
        userId: "u1",
        email: "alice@test.local",
        checks7d: 50,
      },
    ]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toEqual({
      kind: "debrief_50_checks",
      userId: "u1",
      email: "alice@test.local",
      checks7d: 50,
    });
  });

  it("fires at_risk_idle for paying users with red status", () => {
    const stale = new Date(Date.now() - 10 * DAY_MS);
    const triggers = conversationTriggers([
      {
        ...baseRow,
        userId: "u1",
        email: "alice@test.local",
        plan: "pro",
        lastCheckAt: stale,
        status: "red",
      },
    ]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.kind).toBe("at_risk_idle");
    if (triggers[0]?.kind === "at_risk_idle") {
      expect(triggers[0].plan).toBe("pro");
      expect(triggers[0].daysIdle).toBeGreaterThanOrEqual(10);
    }
  });

  it("does not fire at_risk_idle for free-plan users", () => {
    const stale = new Date(Date.now() - 10 * DAY_MS);
    const triggers = conversationTriggers([
      {
        ...baseRow,
        userId: "u1",
        email: "alice@test.local",
        plan: "free",
        lastCheckAt: stale,
        status: "red",
      },
    ]);
    expect(triggers).toEqual([]);
  });

  it("can fire both triggers for the same user", () => {
    const stale = new Date(Date.now() - 10 * DAY_MS);
    const triggers = conversationTriggers([
      {
        ...baseRow,
        userId: "u1",
        email: "alice@test.local",
        plan: "team",
        lastCheckAt: stale,
        status: "red",
        checks7d: 80,
      },
    ]);
    expect(triggers).toHaveLength(2);
    expect(triggers.map((t) => t.kind).sort()).toEqual([
      "at_risk_idle",
      "debrief_50_checks",
    ]);
  });
});
