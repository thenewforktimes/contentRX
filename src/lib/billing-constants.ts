/**
 * Billing constants safe for both server and client bundles.
 *
 * `src/lib/stripe.ts` re-exports these. Importing from there into a
 * "use client" component would pull the Stripe SDK into the client
 * bundle (~80kb), which is the reason the subscription panel
 * historically duplicated `TEAM_MIN_SEATS = 1` locally.
 *
 * Putting the constants in their own zero-dependency module lets
 * client and server share one source of truth without paying the
 * SDK-in-bundle cost. Don't add anything here that needs Stripe SDK
 * types — keep this side strictly numeric / string literal.
 */

/**
 * Minimum billable seats on a Team plan checkout.
 *
 * Locked at 1 per the 2026-05-07 Phase 1 pricing decision (see
 * _private/pricing-analysis.md). Solo users on Team should be a
 * supported path; the seat count grows as members accept invites.
 *
 * If this value changes, the marketing copy on /pricing and the
 * dashboard's plan-picker FAQ both need updates — keep them in sync.
 */
export const TEAM_MIN_SEATS = 1;
