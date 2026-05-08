/**
 * Monthly usage tracking + Phase 4 opt-in overage.
 *
 * One row per (user_id, month). `claimQuotaSlot(s)` is the single
 * atomic operation /api/check uses on the hot path: it either
 * reserves N slots below the user's quota or returns a denial. Burst
 * concurrency is safe (the upsert + setWhere guard composes the same
 * way for n > 1).
 *
 * Three branches on the hot path:
 *   A. Under quota → grant (existing fast-path; one upsert).
 *   B. Over quota AND no opt-in → deny with overage-offer info.
 *   C. Over quota AND opt-in active AND BETA_OVERAGE=true → grant
 *      via overage; second upsert without the setWhere guard
 *      increments past the cap, and writeOverageEvent records the
 *      excess to overage_state for end-of-month metering to Stripe.
 *
 * BETA_OVERAGE gate: Phase 4 ships behind an env var so Robert can
 * test the path against his founder account before opening it to all
 * paid customers. When BETA_OVERAGE !== "true", Branch C falls back
 * to Branch B even for opted-in users — the toggle in the dashboard
 * still records intent, but the engine doesn't honor it yet.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentMonth } from "./quotas";

export const OVERAGE_RATE_CENTS = 10;
export const OVERAGE_OPT_IN_URL = "/dashboard/settings/overage";

function isBetaOverageEnabled(): boolean {
  return process.env.BETA_OVERAGE === "true";
}

export async function getCurrentUsage(userId: string): Promise<number> {
  const db = getDb();
  const month = currentMonth();

  const [row] = await db
    .select({ count: schema.usage.count })
    .from(schema.usage)
    .where(
      and(eq(schema.usage.userId, userId), eq(schema.usage.month, month)),
    )
    .limit(1);

  return row?.count ?? 0;
}

export type ClaimResult =
  | {
      granted: true;
      count: number;
      /** True iff the claim was satisfied via overage (Branch C). The
       * caller can surface this to the customer ("you're past your
       * monthly cap; this check billed at $0.10 via overage"). */
      viaOverage?: boolean;
    }
  | {
      granted: false;
      count: number;
      /** True for paid plans (Pro / Team / Scale) that aren't yet
       * opted in to overage. Free plans are never overage-eligible. */
      overageAvailable?: boolean;
      overageRateCents?: number;
      optInUrl?: string;
    };

/**
 * Atomically reserve N evaluation slots for (userId, current month).
 *
 * Returns { granted: true, count } when the user had room (Branch A)
 * or when the user opted in to overage and Branch C extends them past
 * the cap. Returns { granted: false, count } when the cap is hit
 * without an active opt-in (Branch B) — the caller surfaces the
 * overage info to the customer via the 402 response shape.
 *
 * `n` defaults to 1 to match the original `claimQuotaSlot` contract.
 * The proportional-billing path (a single /api/check call charges
 * Math.ceil(text.length / UNIT_WINDOW) slots, see metering.ts) passes
 * n > 1 when the input text spans multiple billing units.
 */
export async function claimQuotaSlots(
  userId: string,
  n: number,
  quota: number,
): Promise<ClaimResult> {
  // Defensive: a callsite that computed n=0 (e.g., empty text post-trim)
  // should never reach the API gate, but if it does, treat as a free
  // pass that doesn't increment.
  if (n <= 0) {
    const current = await getCurrentUsage(userId);
    return { granted: true, count: current };
  }

  const db = getDb();
  const month = currentMonth();

  // Branch A: atomic upsert with a setWhere guard. Only commits the
  // +n increment when the user has room for the full claim.
  const branchA = await db
    .insert(schema.usage)
    .values({ userId, month, count: n })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.month],
      set: {
        count: sql`${schema.usage.count} + ${n}`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${schema.usage.count} + ${n} <= ${quota}`,
    })
    .returning({ count: schema.usage.count });

  if (branchA.length === 1) {
    return { granted: true, count: branchA[0].count };
  }

  // Guard rejected — Branch A path didn't grant. Look up plan + opt-in.
  const [user] = await db
    .select({
      plan: schema.users.plan,
      overageOptInActive: schema.users.overageOptInActive,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const current = await getCurrentUsage(userId);

  // Free plans are never overage-eligible.
  if (!user || user.plan === "free") {
    return {
      granted: false,
      count: current,
      overageAvailable: false,
    };
  }

  // Paid plans: Branch C if opted in AND beta gate is open, otherwise
  // Branch B (deny + offer).
  if (!user.overageOptInActive || !isBetaOverageEnabled()) {
    return {
      granted: false,
      count: current,
      overageAvailable: true,
      overageRateCents: OVERAGE_RATE_CENTS,
      optInUrl: OVERAGE_OPT_IN_URL,
    };
  }

  // Branch C: opted in + gate open. Increment usage past the cap (no
  // setWhere) and record the excess to overage_state.
  const branchC = await db
    .insert(schema.usage)
    .values({ userId, month, count: n })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.month],
      set: {
        count: sql`${schema.usage.count} + ${n}`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ count: schema.usage.count });

  if (branchC.length !== 1) {
    // Should never happen — the upsert without setWhere always commits.
    // Fall through to deny so the caller surfaces a sane 402 instead
    // of a 500.
    return {
      granted: false,
      count: current,
      overageAvailable: true,
      overageRateCents: OVERAGE_RATE_CENTS,
      optInUrl: OVERAGE_OPT_IN_URL,
    };
  }

  await writeOverageEvent({ userId, units: n, month });

  return { granted: true, count: branchC[0].count, viaOverage: true };
}

/**
 * Backward-compat single-slot wrapper. Same semantics as the original
 * `claimQuotaSlot` for the rest of the codebase that hasn't migrated
 * to the multi-slot form.
 */
export async function claimQuotaSlot(
  userId: string,
  quota: number,
): Promise<ClaimResult> {
  return claimQuotaSlots(userId, 1, quota);
}

/**
 * Increment a user's overage tally for the current month. Idempotent
 * upsert — concurrent calls accumulate correctly via Postgres atomic
 * +n on the conflict path. Stripe Metered Billing is the source of
 * truth for billing; this row is a fast local cache so the hot path
 * doesn't have to round-trip Stripe on every call. The end-of-month
 * cron at /api/cron/stripe-overage-meter reads from here and posts
 * the totals to Stripe.
 */
async function writeOverageEvent(args: {
  userId: string;
  units: number;
  month: string;
}): Promise<void> {
  if (args.units <= 0) return;
  const db = getDb();
  const cents = args.units * OVERAGE_RATE_CENTS;
  await db
    .insert(schema.overageState)
    .values({
      userId: args.userId,
      month: args.month,
      overageChecks: args.units,
      overageUsdCents: cents,
    })
    .onConflictDoUpdate({
      target: [schema.overageState.userId, schema.overageState.month],
      set: {
        overageChecks: sql`${schema.overageState.overageChecks} + ${args.units}`,
        overageUsdCents: sql`${schema.overageState.overageUsdCents} + ${cents}`,
        updatedAt: sql`now()`,
      },
    });
}

export type TokenIncrement = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

/**
 * Add the token counts from a single /api/check evaluation to the
 * user's current-month usage row. Closes audit M-24 (token-cost
 * telemetry per customer).
 *
 * Idempotency: this is intentionally NOT idempotent — every successful
 * eval should add to the running total. /api/check's quota check
 * (claimQuotaSlot) already gates the per-month call count at 1
 * increment per request, so calling this once after a granted slot
 * matches the same lifecycle.
 *
 * The row is guaranteed to exist by the time this is called: the
 * caller's flow is (claimQuotaSlot which inserts/upserts) → engine
 * call → recordTokenUsage. If the row somehow doesn't exist (manual
 * delete?), the upsert here still creates it with count=0 + the new
 * tokens, so we never lose telemetry.
 */
export async function recordTokenUsage(
  userId: string,
  tokens: TokenIncrement,
): Promise<void> {
  const db = getDb();
  const month = currentMonth();
  const inputT = Math.max(0, Math.floor(tokens.inputTokens));
  const outputT = Math.max(0, Math.floor(tokens.outputTokens));
  const cacheReadT = Math.max(0, Math.floor(tokens.cacheReadInputTokens ?? 0));
  const cacheCreateT = Math.max(0, Math.floor(tokens.cacheCreationInputTokens ?? 0));

  await db
    .insert(schema.usage)
    .values({
      userId,
      month,
      // count stays at 0 here — claimQuotaSlot is the call counter.
      // recordTokenUsage only adds to the token aggregates.
      count: 0,
      inputTokens: inputT,
      outputTokens: outputT,
      cacheReadInputTokens: cacheReadT,
      cacheCreationInputTokens: cacheCreateT,
    })
    .onConflictDoUpdate({
      target: [schema.usage.userId, schema.usage.month],
      set: {
        inputTokens: sql`${schema.usage.inputTokens} + ${inputT}`,
        outputTokens: sql`${schema.usage.outputTokens} + ${outputT}`,
        cacheReadInputTokens: sql`${schema.usage.cacheReadInputTokens} + ${cacheReadT}`,
        cacheCreationInputTokens: sql`${schema.usage.cacheCreationInputTokens} + ${cacheCreateT}`,
        updatedAt: sql`now()`,
      },
    });
}
