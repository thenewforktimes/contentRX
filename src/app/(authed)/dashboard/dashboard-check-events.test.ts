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
  isSuggestionCopiedEvent,
  SUGGESTION_COPIED_EVENT,
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
      usage: { used: 7, quota: 1000, remaining: 993 },
    });
    expect(isCheckCompletedEvent(e)).toBe(true);
  });

  it("rejects an event with the wrong type", () => {
    const e = fakeEvent("some-other-event", {
      source: "dashboard",
      usage: { used: 7, quota: 1000, remaining: 993 },
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
      usage: { used: 7, quota: 1000, remaining: 993 },
    });
    expect(isCheckCompletedEvent(e)).toBe(false);
  });

  it("rejects an event missing required usage.used", () => {
    const e = fakeEvent(CHECK_COMPLETED_EVENT, {
      source: "dashboard",
      usage: { quota: 1000 },
    });
    expect(isCheckCompletedEvent(e)).toBe(false);
  });

  it("rejects an event with non-numeric usage.used", () => {
    const e = fakeEvent(CHECK_COMPLETED_EVENT, {
      source: "dashboard",
      usage: { used: "7", quota: 1000, remaining: 993 },
    });
    expect(isCheckCompletedEvent(e)).toBe(false);
  });
});

describe("isSuggestionCopiedEvent", () => {
  // The cx-suggestion-copied event ships when a customer clicks
  // Copy on a finding. Block 3a will wire a listener that records
  // the signal as a low-weight CANDIDATE; the guard pins the
  // detail-shape contract so dispatcher and listener can't drift.
  const validDetail = {
    submittedText: "Unable to complete operation. Please contact administrator.",
    suggestion:
      "Something's wrong and it's unclear what. Try again, and contact your admin if there's still trouble.",
    severity: "high",
    confidence: 0.95,
    issue: "The message is cold and robotic.",
  };

  it("accepts a well-formed cx-suggestion-copied event", () => {
    const e = fakeEvent(SUGGESTION_COPIED_EVENT, validDetail);
    expect(isSuggestionCopiedEvent(e)).toBe(true);
  });

  it("rejects an event with the wrong type", () => {
    const e = fakeEvent("some-other-event", validDetail);
    expect(isSuggestionCopiedEvent(e)).toBe(false);
  });

  it("rejects an event missing .detail", () => {
    const e = { type: SUGGESTION_COPIED_EVENT } as Event;
    expect(isSuggestionCopiedEvent(e)).toBe(false);
  });

  it("rejects an event missing submittedText", () => {
    const e = fakeEvent(SUGGESTION_COPIED_EVENT, {
      ...validDetail,
      submittedText: undefined,
    });
    expect(isSuggestionCopiedEvent(e)).toBe(false);
  });

  it("rejects an event missing suggestion", () => {
    const e = fakeEvent(SUGGESTION_COPIED_EVENT, {
      ...validDetail,
      suggestion: undefined,
    });
    expect(isSuggestionCopiedEvent(e)).toBe(false);
  });

  it("rejects an event missing severity", () => {
    const e = fakeEvent(SUGGESTION_COPIED_EVENT, {
      ...validDetail,
      severity: undefined,
    });
    expect(isSuggestionCopiedEvent(e)).toBe(false);
  });

  it("rejects an event with non-string suggestion", () => {
    const e = fakeEvent(SUGGESTION_COPIED_EVENT, {
      ...validDetail,
      suggestion: { rewrite: "..." },
    });
    expect(isSuggestionCopiedEvent(e)).toBe(false);
  });
});
