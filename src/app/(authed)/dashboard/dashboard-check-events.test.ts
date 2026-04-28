/**
 * Pin the cx-check-completed event contract.
 *
 * The dispatcher and listener live in different Client Components that
 * communicate via window CustomEvents. If the type guard regresses (or
 * if the detail shape drifts on either side without the other), the
 * optimistic UI silently stops working and the regression is hard to
 * spot in manual QA.
 *
 * These tests run in the node vitest environment (no DOM), so they
 * don't exercise dispatchCheckCompleted directly — they validate the
 * isCheckCompletedEvent guard against fabricated event objects that
 * mirror what the browser would deliver.
 */

import { describe, expect, it } from "vitest";
import {
  CHECK_COMPLETED_EVENT,
  isCheckCompletedEvent,
} from "./dashboard-check-events";

function fakeEvent(type: string, detail: unknown): Event {
  // Construct a minimum-viable Event-shaped object. The guard only
  // reads .type and .detail; we don't need a real CustomEvent.
  return { type, detail } as unknown as Event;
}

describe("isCheckCompletedEvent", () => {
  it("accepts a well-formed cx-check-completed event", () => {
    const e = fakeEvent(CHECK_COMPLETED_EVENT, {
      source: "dashboard",
      usage: { used: 7, quota: 25, remaining: 18 },
    });
    expect(isCheckCompletedEvent(e)).toBe(true);
  });

  it("rejects an event with the wrong type", () => {
    const e = fakeEvent("some-other-event", {
      source: "dashboard",
      usage: { used: 7, quota: 25, remaining: 18 },
    });
    expect(isCheckCompletedEvent(e)).toBe(false);
  });

  it("rejects an event missing .detail", () => {
    const e = { type: CHECK_COMPLETED_EVENT } as Event;
    expect(isCheckCompletedEvent(e)).toBe(false);
  });

  it("rejects an event with non-object detail", () => {
    const e = fakeEvent(CHECK_COMPLETED_EVENT, "definitely not an object");
    expect(isCheckCompletedEvent(e)).toBe(false);
  });

  it("rejects an event missing required source field", () => {
    const e = fakeEvent(CHECK_COMPLETED_EVENT, {
      usage: { used: 7, quota: 25, remaining: 18 },
    });
    expect(isCheckCompletedEvent(e)).toBe(false);
  });

  it("rejects an event missing required usage.used", () => {
    const e = fakeEvent(CHECK_COMPLETED_EVENT, {
      source: "dashboard",
      usage: { quota: 25 },
    });
    expect(isCheckCompletedEvent(e)).toBe(false);
  });

  it("rejects an event with non-numeric usage.used", () => {
    const e = fakeEvent(CHECK_COMPLETED_EVENT, {
      source: "dashboard",
      usage: { used: "7", quota: 25, remaining: 18 },
    });
    expect(isCheckCompletedEvent(e)).toBe(false);
  });
});
