/**
 * Shared open-redirect guard for Stripe-returned URLs.
 *
 * Any `url` field returned by /api/checkout or /api/portal must
 * resolve to one of these hosts before a client sets
 * window.location.href — guards against an open-redirect vuln if a
 * future refactor changes what the API returns (audit UI-H-01,
 * 2026-04-22).
 *
 * Extracted from subscription-panel.tsx so the members panel's
 * "Add a seat" redirect shares the exact same check rather than
 * carrying a divergent copy of a security-relevant helper.
 */

const STRIPE_REDIRECT_HOSTS = new Set<string>([
  "checkout.stripe.com",
  "billing.stripe.com",
]);

export function safeStripeRedirect(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("Stripe didn't return a URL. Try again in a moment.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Got a malformed Stripe URL. Try again.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Stripe URL must be https.");
  }
  if (!STRIPE_REDIRECT_HOSTS.has(parsed.host)) {
    throw new Error(`Unexpected redirect host: ${parsed.host}`);
  }
  return parsed.toString();
}
