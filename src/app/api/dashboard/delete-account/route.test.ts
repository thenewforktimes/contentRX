/**
 * Endpoint tests for /api/dashboard/delete-account.
 *
 * Mocks the heavy collaborators (Clerk auth, Clerk client, Stripe,
 * pseudonymizeUser, getDb) and exercises the orchestration logic:
 * auth → confirmation validation → Stripe cancel → pseudonymize →
 * Clerk delete. The pseudonymize helper itself is exercised
 * indirectly via the cron (production traffic) and via the simple
 * 8-Drizzle-call shape that's small enough to verify by code review.
 *
 * Mock pattern: ref objects mutated by tests, with vi.mock factories
 * closing over them. Mocks themselves are created inside the
 * factories so vi.mock's hoist-above-imports ordering doesn't trip
 * us up. Each `vi.mocked(...)` call after import returns the same
 * function so we can assert on it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authResolved: { current: { userId: string | null } } = {
  current: { userId: null },
};
const userLookup: { current: Array<{ id: string }> } = { current: [] };
const subscriptionLookup: {
  current: Array<{ stripeSubId: string | null; status: string }>;
} = { current: [] };

vi.mock("@clerk/nextjs/server", () => {
  const auth = vi.fn(async () => authResolved.current);
  const deleteUser = vi.fn();
  const clerkClient = vi.fn(async () => ({ users: { deleteUser } }));
  return { auth, clerkClient, __deleteUser: deleteUser };
});

vi.mock("@/lib/pseudonymize", () => ({
  pseudonymizeUser: vi.fn(),
}));

vi.mock("@/lib/stripe", () => {
  const cancel = vi.fn();
  return {
    getStripe: () => ({ subscriptions: { cancel } }),
    __cancel: cancel,
  };
});

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => {
      // Two `.select(...)` calls in the route: first the user lookup
      // (.from().where().limit()), then the subscription lookup
      // (.from().where()). We branch on which chain the caller uses.
      return {
        from: () => ({
          where: () => {
            // The user lookup chains a .limit() call after .where().
            // Return a thenable + .limit() so both shapes resolve.
            const subPromise = Promise.resolve(subscriptionLookup.current);
            return {
              then: (onResolve: (v: unknown) => unknown) =>
                subPromise.then(onResolve),
              limit: () => Promise.resolve(userLookup.current),
            };
          },
        }),
      };
    },
  }),
  schema: {
    users: { id: "users.id", clerkId: "users.clerk_id" },
    subscriptions: {
      userId: "subscriptions.user_id",
      stripeSubId: "subscriptions.stripe_sub_id",
      status: "subscriptions.status",
    },
  },
}));

vi.mock("@/lib/safe-error-log", () => ({
  logSafeError: vi.fn(),
}));

import * as clerkServer from "@clerk/nextjs/server";
import * as stripeLib from "@/lib/stripe";
import * as pseudonymizeLib from "@/lib/pseudonymize";
import * as safeErrorLog from "@/lib/safe-error-log";
import { POST } from "./route";

// Convenience handles for assertions. Cast through unknown because
// the modules don't export the underscore-prefixed test handles in
// their public types.
const deleteUserMock = (clerkServer as unknown as {
  __deleteUser: ReturnType<typeof vi.fn>;
}).__deleteUser;
const stripeCancelMock = (stripeLib as unknown as {
  __cancel: ReturnType<typeof vi.fn>;
}).__cancel;
const pseudonymizeMock = vi.mocked(pseudonymizeLib.pseudonymizeUser);
const safeErrorLogMock = vi.mocked(safeErrorLog.logSafeError);

function makeReq(body: unknown): Request {
  return new Request("https://test/api/dashboard/delete-account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authResolved.current = { userId: null };
  userLookup.current = [];
  subscriptionLookup.current = [];
  deleteUserMock.mockReset();
  stripeCancelMock.mockReset();
  pseudonymizeMock.mockReset();
  safeErrorLogMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/api/dashboard/delete-account — auth + validation", () => {
  it("returns 401 without a Clerk session", async () => {
    authResolved.current = { userId: null };
    const res = await POST(makeReq({ confirmation: "DELETE" }));
    expect(res.status).toBe(401);
    expect(pseudonymizeMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("returns 400 when confirmation field is missing", async () => {
    authResolved.current = { userId: "clerk_alice" };
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect(pseudonymizeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when confirmation does not match exactly", async () => {
    authResolved.current = { userId: "clerk_alice" };
    const res = await POST(makeReq({ confirmation: "delete" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Confirmation mismatch/);
    expect(pseudonymizeMock).not.toHaveBeenCalled();
  });

  it("treats an unknown user as a successful no-op", async () => {
    authResolved.current = { userId: "clerk_ghost" };
    userLookup.current = [];
    const res = await POST(makeReq({ confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    expect(pseudonymizeMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

describe("/api/dashboard/delete-account — happy path orchestration", () => {
  it("filters Stripe cancel to billable subs only, then pseudonymizes, then deletes Clerk user", async () => {
    authResolved.current = { userId: "clerk_alice" };
    userLookup.current = [{ id: "user_alice" }];
    subscriptionLookup.current = [
      { stripeSubId: "sub_active", status: "active" },
      { stripeSubId: "sub_trial", status: "trialing" },
      { stripeSubId: "sub_dead", status: "canceled" },
      { stripeSubId: null, status: "active" },
    ];

    const res = await POST(makeReq({ confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Stripe cancel called for billable subs only (active + trialing).
    expect(stripeCancelMock).toHaveBeenCalledTimes(2);
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_active");
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_trial");

    // Pseudonymize called with the resolved user id.
    expect(pseudonymizeMock).toHaveBeenCalledWith("user_alice");

    // Clerk delete called with the Clerk id.
    expect(deleteUserMock).toHaveBeenCalledWith("clerk_alice");
  });

  it("skips Stripe cancel when the user has no billable subscriptions", async () => {
    authResolved.current = { userId: "clerk_free" };
    userLookup.current = [{ id: "user_free" }];
    subscriptionLookup.current = [];

    const res = await POST(makeReq({ confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    expect(stripeCancelMock).not.toHaveBeenCalled();
    expect(pseudonymizeMock).toHaveBeenCalledWith("user_free");
    expect(deleteUserMock).toHaveBeenCalledWith("clerk_free");
  });

  it("continues pseudonymization even if Stripe cancel fails", async () => {
    authResolved.current = { userId: "clerk_bob" };
    userLookup.current = [{ id: "user_bob" }];
    subscriptionLookup.current = [
      { stripeSubId: "sub_active", status: "active" },
    ];
    stripeCancelMock.mockRejectedValue(new Error("stripe network error"));

    const res = await POST(makeReq({ confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    expect(safeErrorLogMock).toHaveBeenCalledWith(
      "delete-account.stripe-cancel",
      expect.any(Error),
    );
    // The data-side commitment runs regardless.
    expect(pseudonymizeMock).toHaveBeenCalledWith("user_bob");
    expect(deleteUserMock).toHaveBeenCalledWith("clerk_bob");
  });

  it("returns 200 even if Clerk delete fails (DB is the load-bearing commitment)", async () => {
    authResolved.current = { userId: "clerk_carol" };
    userLookup.current = [{ id: "user_carol" }];
    subscriptionLookup.current = [];
    deleteUserMock.mockRejectedValue(new Error("clerk api down"));

    const res = await POST(makeReq({ confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    expect(pseudonymizeMock).toHaveBeenCalledWith("user_carol");
    expect(safeErrorLogMock).toHaveBeenCalledWith(
      "delete-account.clerk-delete",
      expect.any(Error),
    );
  });
});
